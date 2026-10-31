"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { POWERED_BY, APP_NAME } from "@/lib/brand";
import type { ResolvedProduct } from "@/lib/resolve";
import type { Slot } from "@/lib/slots";
import { LANG_KEY, errorKey, isLimitCode, t, type Lang, type TextKey } from "./i18n";
import { ResultPanel, type GenerateError, type Look } from "./portal/result";
import { LinksStep, MAX_PIECES, PhotoStep, SLOT_ORDER, type Avatar, type Item } from "./portal/steps";
import { SparkIcon, Spinner, StarIcon } from "./portal/ui";

const AVATAR_KEY = "tryit.avatar";

/** Saklı avatarı doğrular; bozuk veya eski biçimse yok sayılır. */
function parseAvatar(raw: string): Avatar | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const { url, width, height } = value as Record<string, unknown>;
    if (typeof url !== "string" || typeof width !== "number" || typeof height !== "number") return null;
    return { url, width, height };
  } catch {
    return null;
  }
}
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const JSON_HEADERS = { "content-type": "application/json" };

class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code?: string) {
    super(code ?? `HTTP ${status}`);
    this.status = status;
    this.code = code;
  }
}

/** İmzalı web çerezini alır; hata olursa istekler no-session ile tekrar dener. */
async function ensureSession(): Promise<void> {
  await fetch("/api/web/session", { method: "POST" }).catch(() => undefined);
}

/** Çerez düşmüşse (401 no-session) oturumu yenileyip isteği bir kez daha dener. */
async function request<T>(path: string, init: RequestInit, retried = false): Promise<T> {
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data as T;
  if (res.status === 401 && data.code === "no-session" && !retried) {
    await ensureSession();
    return request<T>(path, init, true);
  }
  throw new ApiError(res.status, typeof data.code === "string" ? data.code : undefined);
}

function codeOf(err: unknown): string | undefined {
  return err instanceof ApiError ? err.code : undefined;
}

function measure(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(objectUrl);
    };
    image.onerror = () => {
      // Ölçemezsek sunucu "auto" ile devam eder.
      resolve({ width: 0, height: 0 });
      URL.revokeObjectURL(objectUrl);
    };
    image.src = objectUrl;
  });
}

function looksLikeUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function photoErrorKey(code: string | undefined): TextKey {
  if (code === "bad-type" || code === "bad-file") return "errNotPhoto";
  if (code === "too-large") return "errTooLarge";
  return errorKey(code, "errUpload");
}

function linkErrorKey(code: string | undefined): TextKey {
  if (code === "bad-url" || code === "not-http" || code === "private-host" || code === "no-url") return "errNotLink";
  // Sayfa bizi engelliyorsa o mağazayı henüz okuyamıyoruz demektir.
  if (code === "page-blocked") return "errStore";
  return errorKey(code, "errLink");
}

type Items = Partial<Record<Slot, Item>>;

/**
 * Parçayı yuvasına koyar. Aynı yuvadaki eskisi gider; tek parça ile
 * üst/alt aynı anda duramaz. Kaldırılan yuvalar bilgi satırı için döner.
 */
function place(current: Items, item: Item, from?: Slot): { next: Items; replaced: Slot[] } {
  const next = { ...current };
  if (from) delete next[from];
  const clash: Slot[] =
    item.slot === "full" ? ["full", "top", "bottom"] : item.slot === "shoes" ? ["shoes"] : [item.slot, "full"];
  const replaced = clash.filter((slot) => next[slot]);
  for (const slot of replaced) delete next[slot];
  next[item.slot] = item;
  return { next, replaced };
}

function noticeFor(replaced: Slot[]): TextKey | null {
  if (replaced.length > 1) return "replaced_both";
  return replaced.length ? `replaced_${replaced[0]}` : null;
}

export default function DemoClient() {
  const [lang, setLang] = useState<Lang>("en");
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<TextKey | null>(null);
  const [items, setItems] = useState<Items>({});
  const [link, setLink] = useState("");
  const [resolving, setResolving] = useState(false);
  const [linkError, setLinkError] = useState<TextKey | null>(null);
  const [notice, setNotice] = useState<TextKey | null>(null);
  const [generating, setGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [look, setLook] = useState<Look | null>(null);
  const [genError, setGenError] = useState<GenerateError | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Açılışta: çerez, dil tercihi ve saklanan avatar.
  useEffect(() => {
    void ensureSession();
    try {
      const savedLang = localStorage.getItem(LANG_KEY);
      if (savedLang === "en" || savedLang === "tr") setLang(savedLang);
      const saved = localStorage.getItem(AVATAR_KEY);
      const parsed = saved ? parseAvatar(saved) : null;
      if (parsed) setAvatar(parsed);
    } catch {
      // Gizli sekmede localStorage kapalı olabilir; o oturumda tutulmaz.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    if (!generating) return;
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [generating]);

  function changeLang(next: Lang) {
    setLang(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      // Saklanamazsa yalnız bu oturum için geçerli.
    }
  }

  function saveAvatar(next: Avatar) {
    setAvatar(next);
    try {
      localStorage.setItem(AVATAR_KEY, JSON.stringify(next));
    } catch {
      // Saklanamadıysa sorun değil, bellekteki değer bu oturum için yeterli.
    }
  }

  async function handleAvatarFile(file: File) {
    if (!file.type.startsWith("image/")) return setPhotoError("errNotPhoto");
    if (file.size > MAX_PHOTO_BYTES) return setPhotoError("errTooLarge");

    setPhotoError(null);
    setUploading(true);
    try {
      const size = await measure(file);
      const form = new FormData();
      form.append("file", file);
      const data = await request<{ url: string }>("/api/avatar", { method: "POST", body: form });
      saveAvatar({ url: data.url, width: size.width, height: size.height });
    } catch (err) {
      setPhotoError(photoErrorKey(codeOf(err)));
    } finally {
      setUploading(false);
    }
  }

  function applyPlacement(item: Item, from?: Slot) {
    const { next, replaced } = place(items, item, from);
    setItems(next);
    setNotice(noticeFor(replaced));
  }

  async function handleAddLink(event: FormEvent) {
    event.preventDefault();
    const raw = link.trim();
    if (!raw || resolving || chosen.length >= MAX_PIECES) return;
    setNotice(null);
    if (!looksLikeUrl(raw)) return setLinkError("errNotLink");

    setLinkError(null);
    setResolving(true);
    try {
      const product = await request<ResolvedProduct>("/api/resolve", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ url: raw }),
      });
      applyPlacement({ ...product, image: product.images[0] });
      setLink("");
    } catch (err) {
      setLinkError(linkErrorKey(codeOf(err)));
    } finally {
      setResolving(false);
    }
  }

  function moveItem(from: Slot, to: Slot) {
    const item = items[from];
    if (!item || from === to) return;
    applyPlacement({ ...item, slot: to }, from);
  }

  function pickImage(slot: Slot, image: string) {
    const item = items[slot];
    if (item) setItems({ ...items, [slot]: { ...item, image } });
  }

  function removeItem(slot: Slot) {
    const next = { ...items };
    delete next[slot];
    setItems(next);
    setNotice(null);
  }

  const chosen = SLOT_ORDER.map((slot) => items[slot]).filter((item): item is Item => Boolean(item));
  const ready = Boolean(avatar) && chosen.length > 0 && !uploading;

  async function handleGenerate() {
    if (!avatar || !chosen.length || generating) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const pieces = chosen;
    setGenError(null);
    setElapsed(0);
    setGenerating(true);
    revealResult();
    try {
      const data = await request<{ imageUrl: string }>("/api/tryon", {
        method: "POST",
        headers: JSON_HEADERS,
        signal: controller.signal,
        body: JSON.stringify({
          avatarUrl: avatar.url,
          avatarWidth: avatar.width,
          avatarHeight: avatar.height,
          garments: pieces.map((item) => ({ slot: item.slot, name: item.name, image: item.image })),
        }),
      });
      setLook({ url: data.imageUrl, pieces });
    } catch (err) {
      if (controller.signal.aborted) return;
      const code = codeOf(err);
      setGenError({ key: errorKey(code, "errGeneric"), limit: isLimitCode(code) });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setGenerating(false);
      }
    }
  }

  // Sunucu üretime devam edebilir; kullanıcı yalnız beklemeyi bırakır.
  function cancelGenerate() {
    abortRef.current?.abort();
    abortRef.current = null;
    setGenerating(false);
  }

  function smooth(): ScrollBehavior {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  }

  function revealResult() {
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: smooth(), block: "nearest" }));
  }

  function changePieces() {
    document.getElementById("step-links")?.scrollIntoView({ behavior: smooth(), block: "start" });
    linkRef.current?.focus({ preventScroll: true });
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">{APP_NAME}</span>
        <div className="lang" role="group" aria-label="Language">
          {(["en", "tr"] as const).map((code) => (
            <button
              key={code}
              type="button"
              lang={code}
              className={lang === code ? "is-active" : ""}
              aria-pressed={lang === code}
              onClick={() => changeLang(code)}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <main className="layout">
        <div className="col-main">
          <section className="hero">
            <h1 className="hero-title">{t(lang, "heroTitle")}</h1>
            <p className="body-lg soft">{t(lang, "heroSub")}</p>
            <p className="badge">
              <span className="gold-icon">
                <StarIcon />
              </span>
              {POWERED_BY}
            </p>
          </section>

          <PhotoStep
            lang={lang}
            avatar={avatar}
            uploading={uploading}
            error={photoError}
            uploadRef={uploadRef}
            onFile={(file) => void handleAvatarFile(file)}
          />

          <LinksStep
            lang={lang}
            items={chosen}
            link={link}
            resolving={resolving}
            error={linkError}
            notice={notice}
            inputRef={linkRef}
            onLink={setLink}
            onSubmit={(event) => void handleAddLink(event)}
            onMove={moveItem}
            onPick={pickImage}
            onRemove={removeItem}
          />

          <div className={`cta${chosen.length ? " is-sticky" : ""}`}>
            {generating ? (
              <button type="button" className="btn btn-primary btn-lg" onClick={cancelGenerate}>
                <Spinner />
                {t(lang, "cancel")}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={() => void handleGenerate()}
                disabled={!ready}
                aria-describedby={ready ? undefined : "cta-reason"}
              >
                <span className="gold-icon">
                  <SparkIcon />
                </span>
                {t(lang, "create")}
              </button>
            )}
            {!ready && !generating && (
              <p className="body-sm soft" id="cta-reason">
                {t(lang, "createReason")}
              </p>
            )}
          </div>
        </div>

        <div className="col-side" ref={resultRef}>
          <ResultPanel
            lang={lang}
            look={look}
            avatar={avatar}
            generating={generating}
            elapsed={elapsed}
            error={genError}
            onRetry={() => void handleGenerate()}
            onChangePhoto={() => uploadRef.current?.click()}
            onChangePieces={changePieces}
          />
        </div>
      </main>

      <footer className="footer body-sm soft">
        <p>{POWERED_BY}</p>
        <p>
          <a href="/gizlilik.html">{t(lang, "privacy")}</a>
          {" · "}
          {t(lang, "footerNote")}
        </p>
      </footer>
    </div>
  );
}
