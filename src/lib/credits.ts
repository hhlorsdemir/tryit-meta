import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Environment,
  SignedDataVerifier,
  type JWSTransactionDecodedPayload,
} from "@apple/app-store-server-library";
import { dataDir } from "./events";

/**
 * Kombin hakları.
 *
 * Her giydirme bize para demek, o yüzden sayım sunucuda. Uygulamada tutulsa
 * saati geri almak ya da uygulamayı yeniden kurmak hakkı sıfırlardı.
 *
 * - Her cihaz ömür boyu 5 ücretsiz kombin alıyor.
 * - Aboneye her dönemde 30 kombin. Aylıkta dönem her yenileme, yıllıkta
 *   satın alma tarihinden itibaren her ay.
 * - Abonelik hakları Apple'ın orijinal işlem kimliğine bağlı. Aynı Apple
 *   hesabıyla iki telefonda kullanılan abonelik 30 hakkı paylaşıyor;
 *   abonelik cihaz sayısıyla çoğalmıyor.
 * - Hak yalnızca başarılı üretimde düşüyor.
 * - Ücretsiz haklar yalnızca App Attest ile doğrulanmış cihaza veriliyor
 *   (attest.ts); uydurma cihaz kimliğine hak yok.
 * - Apple iade ya da iptal bildirimi gönderince o işlem kara listeye
 *   giriyor; iadeden önce saklanan kayıt bir daha kabul edilmiyor.
 *
 * TRYIT_ENFORCE_CREDITS=1 değilse sayım sürüyor ama kimse geri
 * çevrilmiyor. Hak ekranını bilmeyen eski uygulama sürümleri varken
 * sunucu önceden yayına alınabilsin diye.
 *
 * TRYIT_UNLIMITED=1 jüri/demo modu: sayım sürüyor ama kimse geri
 * çevrilmiyor (TRYIT_ENFORCE_CREDITS açık olsa bile); cevapta
 * `unlimited: true` dönüyor. Yarışma sonrası kapatılıyor.
 */

/** Ortam değişkeniyle değişebiliyor; kampanya ya da test için. */
export const FREE_CREDITS = count("TRYIT_FREE_CREDITS", 5);
export const PERIOD_CREDITS = count("TRYIT_PERIOD_CREDITS", 30);

function count(key: string, fallback: number): number {
  const raw = Number(process.env[key]);
  return Number.isInteger(raw) && raw >= 0 ? raw : fallback;
}

export const PRODUCTS = {
  "com.lafagency.tryit.premium.monthly": "monthly",
  "com.lafagency.tryit.premium.yearly": "yearly",
} as const;

type Plan = "free" | (typeof PRODUCTS)[keyof typeof PRODUCTS];

export type CreditStatus = {
  plan: Plan;
  remaining: number;
  total: number;
  /** Aboneliğin haklarının yenileneceği an, ISO. Ücretsizde yok. */
  resetsAt?: string;
  /** Cihaz henüz App Attest ile doğrulanmadı; uygulama doğrulayıp tekrar sormalı. */
  needsAttestation?: boolean;
  /** Jüri modu: uygulama paywall'ı ve hak sayacını gizler. Kapalıyken alan hiç yazılmaz. */
  unlimited?: boolean;
};

function enforced(): boolean {
  return process.env.TRYIT_ENFORCE_CREDITS === "1";
}

function unlimited(): boolean {
  return process.env.TRYIT_UNLIMITED === "1";
}

/** Bayrak kapalıyken eski JSON çıktısı değişmesin diye alan hiç eklenmiyor. */
function unlimitedField(): { unlimited?: true } {
  return unlimited() ? { unlimited: true } : {};
}

/** Simülatörde App Attest yok; yerel geliştirmede doğrulamasız ücretsiz hak. */
function attestationRequired(): boolean {
  return process.env.TRYIT_ALLOW_UNATTESTED !== "1";
}

/** Hakkın nereden düşeceği. `consume` bunu kullanıyor. */
type Account =
  | { kind: "free"; device: string }
  | { kind: "sub"; key: string; period: string };

const BUNDLE_ID = "com.lafagency.tryit";
const APP_APPLE_ID = 6814813955;
const MONTH = 30.4375 * 24 * 60 * 60 * 1000;

// MARK: - Apple doğrulaması

let verifiers: SignedDataVerifier[] | null = null;

/**
 * Önce canlı, sonra sandbox. TestFlight ve App Review sandbox'ta satın
 * alıyor; onları reddetsek inceleme abonelik ekranını test edemez.
 *
 * Xcode'un StoreKit test dosyasıyla yapılan satın almalar imzasız geliyor.
 * Onlar yalnızca yerel geliştirmede, TRYIT_ALLOW_XCODE_STOREKIT=1 ile
 * kabul ediliyor; canlı sunucuda bu değişken yok.
 */
export function getVerifiers(): SignedDataVerifier[] {
  if (verifiers) return verifiers;
  const roots = ["AppleRootCA-G3.cer", "AppleRootCA-G2.cer"].map((name) =>
    readFileSync(join(process.cwd(), "certs", name)),
  );
  verifiers = [
    new SignedDataVerifier(roots, false, Environment.PRODUCTION, BUNDLE_ID, APP_APPLE_ID),
    new SignedDataVerifier(roots, false, Environment.SANDBOX, BUNDLE_ID),
  ];
  if (process.env.TRYIT_ALLOW_XCODE_STOREKIT === "1") {
    verifiers.push(new SignedDataVerifier(roots, false, Environment.XCODE, BUNDLE_ID));
  }
  return verifiers;
}

async function verify(jws: string): Promise<JWSTransactionDecodedPayload | null> {
  for (const verifier of getVerifiers()) {
    try {
      return await verifier.verifyAndDecodeTransaction(jws);
    } catch {
      // Sıradaki ortamı dene.
    }
  }
  return null;
}

/**
 * Geçerli, süresi dolmamış, iade edilmemiş abonelik mi.
 *
 * Yükseltilmiş kayıt (aylıktan yıllığa geçince eski aylık) reddediliyor:
 * süresi hâlâ gelecekte görünüyor, kabul etseydik istemci eski ve yeni
 * kaydı sırayla göndererek her seferinde yeni bir dönem açabilirdi.
 *
 * İade edilen işlemin iadeden önce saklanmış kaydı kendi başına hâlâ
 * geçerli görünüyor; onu Apple'ın iade bildirimiyle dolan kara liste
 * (`store.revoked`) yakalıyor.
 */
async function activeSubscription(jws: unknown, now: number, store: Store) {
  if (typeof jws !== "string" || jws.length > 20_000) return null;
  const tx = await verify(jws);
  if (!tx?.productId || !(tx.productId in PRODUCTS)) return null;
  if (tx.revocationDate || tx.isUpgraded) return null;
  if (tx.transactionId && store.revoked[tx.transactionId]) return null;
  if (!tx.expiresDate || tx.expiresDate <= now) return null;
  if (!tx.originalTransactionId || !tx.purchaseDate) return null;
  return {
    plan: PRODUCTS[tx.productId as keyof typeof PRODUCTS],
    key: tx.originalTransactionId,
    purchaseDate: tx.purchaseDate,
    originalPurchaseDate: tx.originalPurchaseDate ?? tx.purchaseDate,
    expiresDate: tx.expiresDate,
    // Sandbox'ta aylık abonelik birkaç dakikada, TestFlight'ta günde bir
    // yenileniyor. Yenilemeye göre sayılsa test kullanıcısı her yenilemede
    // 30 hak alırdı.
    fastRenewing: tx.environment !== "Production",
  };
}

type Subscription = NonNullable<Awaited<ReturnType<typeof activeSubscription>>>;

/** Aboneliğin şu anki dönemi ve hakların yenileneceği an. */
function currentPeriod(sub: Subscription, now: number): { period: string; resetsAt: number } {
  if (sub.plan === "monthly" && !sub.fastRenewing) {
    // Her yenileme yeni bir işlem, yeni bir satın alma tarihi.
    return { period: String(sub.purchaseDate), resetsAt: sub.expiresDate };
  }
  // Yıllıkta (ve test ortamında) dönem, ilk satın almadan itibaren aylık
  // dilimler. 12 x 30.44 gün 365.25 gün ediyor; artık yılda son saatlerde
  // 13. bir dilim açılmasın diye 11'de duruyor.
  const start = sub.fastRenewing ? sub.originalPurchaseDate : sub.purchaseDate;
  const index = Math.min(11, Math.max(0, Math.floor((now - start) / MONTH)));
  const resetsAt = index === 11 ? sub.expiresDate : start + (index + 1) * MONTH;
  return { period: `${start}:${index}`, resetsAt: Math.min(resetsAt, sub.expiresDate) };
}

// MARK: - Depo

type Store = {
  /** Cihaz başına kullanılan ücretsiz hak. */
  free: Record<string, number>;
  /** Orijinal işlem kimliği başına: hangi dönem ve o dönemde kaç hak. */
  subs: Record<string, { period: string; used: number }>;
  /** İade ya da iptal edilen işlem kimlikleri ve bildirim zamanı. */
  revoked: Record<string, number>;
  /** App Attest ile doğrulanmış cihazlar. */
  attested: Record<string, { keyId: string; environment: string; at: number }>;
};

function empty(): Store {
  return { free: {}, subs: {}, revoked: {}, attested: {} };
}

function storePath(): string {
  return join(dataDir(), "credits.json");
}

/**
 * Depoyu okur. Yalnızca dosya yoksa boş depo dönüyor. Bozuk dosyayı boş
 * saysaydık bir sonraki yazma herkesin geçmişini silerdi; o yüzden
 * fırlatıyor ve istek reddediliyor.
 */
async function load(): Promise<Store> {
  let raw: string;
  try {
    raw = await readFile(storePath(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw err;
  }
  return { ...empty(), ...(JSON.parse(raw) as Partial<Store>) };
}

async function save(store: Store): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  const tmp = `${storePath()}.tmp`;
  await writeFile(tmp, JSON.stringify(store), "utf8");
  // Yarım yazılmış dosya kalmasın: önce geçici dosya, sonra yer değiştirme.
  await rename(tmp, storePath());
}

/** Okuma-yazmaları sıraya koyar; eşzamanlı iki istek birbirini ezmesin. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

// MARK: - Dışa açık

/**
 * Cihazın durumunu verir. `entitlement`, uygulamanın gönderdiği StoreKit
 * işlem kaydı (JWS); yoksa ya da geçersizse ücretsiz haklara bakılıyor.
 */
/** Hangi hesaptan düşüleceği ve o hesabın dönemlik hakkı. */
async function resolveAccount(device: string, entitlement: unknown, now: number) {
  const store = await load();
  const sub = await activeSubscription(entitlement, now, store);
  if (sub) {
    const { period, resetsAt } = currentPeriod(sub, now);
    return {
      account: { kind: "sub", key: sub.key, period } as Account,
      plan: sub.plan as Plan,
      total: PERIOD_CREDITS,
      resetsAt: new Date(resetsAt).toISOString(),
      needsAttestation: undefined,
    };
  }
  // Doğrulanmamış cihaza ücretsiz hak yok; uygulama doğrulayıp tekrar soruyor.
  const unverified = attestationRequired() && !store.attested[device];
  return {
    account: { kind: "free", device } as Account,
    plan: "free" as Plan,
    total: unverified ? 0 : FREE_CREDITS,
    resetsAt: undefined,
    needsAttestation: unverified || undefined,
  };
}

function usedIn(store: Store, account: Account): number {
  if (account.kind === "free") return store.free[account.device] ?? 0;
  const entry = store.subs[account.key];
  return entry?.period === account.period ? entry.used : 0;
}

function addUse(store: Store, account: Account, delta: number): void {
  const used = Math.max(0, usedIn(store, account) + delta);
  if (account.kind === "free") store.free[account.device] = used;
  else store.subs[account.key] = { period: account.period, used };
}

/**
 * Cihazın durumunu verir. `entitlement`, uygulamanın gönderdiği StoreKit
 * işlem kaydı (JWS); yoksa ya da geçersizse ücretsiz haklara bakılıyor.
 */
export async function creditStatus(device: string, entitlement: unknown): Promise<CreditStatus> {
  const { account, plan, total, resetsAt, needsAttestation } = await resolveAccount(
    device,
    entitlement,
    Date.now(),
  );
  const used = usedIn(await load(), account);
  return {
    plan,
    remaining: Math.max(0, total - used),
    total,
    resetsAt,
    needsAttestation,
    ...unlimitedField(),
  };
}

/**
 * Üretimden önce bir hak ayırır. Hak yoksa null.
 *
 * Kontrol ve düşme aynı kuyruk adımında: ayrı olsalardı, son hakkı kalan
 * cihaz aynı anda birkaç istek atıp hepsini "1 hak var" görerek
 * geçirebilirdi. Üretim başarısız olursa `refund` ile iade ediliyor.
 */
export async function reserve(
  device: string,
  entitlement: unknown,
): Promise<{ status: CreditStatus; account: Account } | { status: CreditStatus; account: null }> {
  const { account, plan, total, resetsAt, needsAttestation } = await resolveAccount(
    device,
    entitlement,
    Date.now(),
  );
  return serial(async () => {
    const store = await load();
    const used = usedIn(store, account);
    if (used >= total && enforced() && !unlimited()) {
      return { status: { plan, remaining: 0, total, resetsAt, needsAttestation }, account: null };
    }
    addUse(store, account, 1);
    await save(store);
    const remaining = Math.max(0, total - used - 1);
    return {
      status: { plan, remaining, total, resetsAt, needsAttestation, ...unlimitedField() },
      account,
    };
  });
}

/** Ayrılan hakkı geri verir; üretim başarısız olduğunda. */
export function refund(account: Account): Promise<void> {
  return serial(async () => {
    const store = await load();
    addUse(store, account, -1);
    await save(store);
  });
}

/** App Attest doğrulaması geçen cihazı kaydeder. */
export function markAttested(device: string, keyId: string, environment: string): Promise<void> {
  return serial(async () => {
    const store = await load();
    store.attested[device] = { keyId, environment, at: Date.now() };
    await save(store);
  });
}

/**
 * Apple'ın iade/iptal bildirimi: işlem kara listeye giriyor ya da (iade
 * geri alındıysa) çıkıyor.
 */
export function setRevoked(transactionId: string, revoked: boolean): Promise<void> {
  return serial(async () => {
    const store = await load();
    if (revoked) store.revoked[transactionId] = Date.now();
    else delete store.revoked[transactionId];
    await save(store);
  });
}
