import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * App Attest doğrulaması.
 *
 * Ücretsiz haklar cihaz kimliğine bağlı ve o kimliği istemci kendisi
 * gönderiyor. Uygulama anahtarını ele geçiren biri her istekte yeni bir
 * kimlik uydurup sınırsız "5 ücretsiz" alabilirdi. App Attest ile Apple,
 * isteğin App Store'dan gelen gerçek TryIt'ten ve gerçek bir cihazdan
 * geldiğini imzalıyor; ücretsiz hak yalnızca böyle doğrulanmış kimliğe
 * veriliyor.
 *
 * Doğrulama Apple'ın belgelediği adımlarla birebir:
 * https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server
 */

const TEAM_ID = "5X592SK4E8";
const BUNDLE_ID = "com.lafagency.tryit";
/** Sertifikadaki nonce uzantısı. */
const NONCE_OID = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02]);
const AAGUID_PRODUCTION = Buffer.concat([Buffer.from("appattest"), Buffer.alloc(7)]);
const AAGUID_DEVELOPMENT = Buffer.from("appattestdevelop");

export class AttestError extends Error {}

// MARK: - Sorular

type Pending = { challenge: string; expires: number };
const store = globalThis as typeof globalThis & { __tryitChallenges?: Map<string, Pending> };
function pending(): Map<string, Pending> {
  store.__tryitChallenges ??= new Map();
  return store.__tryitChallenges;
}

/** Cihaz için tek kullanımlık, beş dakikalık bir soru üretir. */
export function issueChallenge(device: string): string {
  const now = Date.now();
  for (const [key, value] of pending()) if (value.expires < now) pending().delete(key);
  const challenge = randomBytes(24).toString("base64url");
  pending().set(device, { challenge, expires: now + 5 * 60 * 1000 });
  return challenge;
}

/**
 * Uygulamanın imzaya kattığı veri: soru ve cihaz kimliği. Kimlik de
 * katıldığı için bir cihazın doğrulaması başka bir kimlik için kullanılamıyor.
 */
function clientDataHash(challenge: string, device: string): Buffer {
  return createHash("sha256").update(`${challenge}:${device}`).digest();
}

// MARK: - Doğrulama

export type Attested = { keyId: string; environment: "production" | "development" };

export function verifyAttestation(device: string, keyId: string, attestationB64: string): Attested {
  const entry = pending().get(device);
  pending().delete(device);
  if (!entry || entry.expires < Date.now()) throw new AttestError("Soru süresi dolmuş.");

  const decoded = decodeCbor(Buffer.from(attestationB64, "base64")) as {
    fmt?: string;
    attStmt?: { x5c?: Buffer[] };
    authData?: Buffer;
  };
  if (decoded?.fmt !== "apple-appattest") throw new AttestError("Biçim tanınmadı.");
  const x5c = decoded.attStmt?.x5c;
  const authData = decoded.authData;
  if (!Array.isArray(x5c) || x5c.length < 2 || !Buffer.isBuffer(authData)) {
    throw new AttestError("Eksik alan.");
  }

  // 1. Zincir Apple App Attestation kökünde bitmeli.
  const cred = new X509Certificate(x5c[0]);
  const intermediate = new X509Certificate(x5c[1]);
  const root = appAttestRoot();
  const now = new Date();
  for (const cert of [cred, intermediate]) {
    if (new Date(cert.validFrom) > now || new Date(cert.validTo) < now) {
      throw new AttestError("Sertifika süresi geçersiz.");
    }
  }
  if (!cred.checkIssued(intermediate) || !cred.verify(intermediate.publicKey)) {
    throw new AttestError("Sertifika zinciri geçersiz.");
  }
  if (!intermediate.checkIssued(root) || !intermediate.verify(root.publicKey)) {
    throw new AttestError("Kök sertifika tutmuyor.");
  }

  // 2-4. nonce = SHA256(authData || clientDataHash), sertifikadaki değerle aynı olmalı.
  const nonce = createHash("sha256")
    .update(Buffer.concat([authData, clientDataHash(entry.challenge, device)]))
    .digest();
  if (!nonceFromCert(Buffer.from(cred.raw)).equals(nonce)) {
    throw new AttestError("Nonce tutmuyor.");
  }

  // 5. Anahtar kimliği, sertifikadaki açık anahtarın özeti olmalı.
  const spki = cred.publicKey.export({ format: "der", type: "spki" });
  const point = spki.subarray(spki.length - 65);
  const expectedKeyId = createHash("sha256").update(point).digest();
  if (!expectedKeyId.equals(Buffer.from(keyId, "base64"))) {
    throw new AttestError("Anahtar kimliği tutmuyor.");
  }

  // 6-9. authData: uygulama kimliği, sayaç, ortam, kimlik bilgisi.
  const rpIdHash = authData.subarray(0, 32);
  const appIdHash = createHash("sha256").update(`${TEAM_ID}.${BUNDLE_ID}`).digest();
  if (!rpIdHash.equals(appIdHash)) throw new AttestError("Uygulama kimliği tutmuyor.");
  if (authData.readUInt32BE(33) !== 0) throw new AttestError("Sayaç sıfır değil.");
  const aaguid = authData.subarray(37, 53);
  let environment: Attested["environment"];
  if (aaguid.equals(AAGUID_PRODUCTION)) environment = "production";
  else if (aaguid.equals(AAGUID_DEVELOPMENT)) environment = "development";
  else throw new AttestError("Ortam tanınmadı.");
  const idLength = authData.readUInt16BE(53);
  const credentialId = authData.subarray(55, 55 + idLength);
  if (!credentialId.equals(expectedKeyId)) throw new AttestError("Kimlik bilgisi tutmuyor.");

  return { keyId, environment };
}

let root: X509Certificate | null = null;
function appAttestRoot(): X509Certificate {
  root ??= new X509Certificate(
    readFileSync(join(process.cwd(), "certs", "Apple_App_Attestation_Root_CA.pem")),
  );
  return root;
}

/**
 * Nonce uzantısını sertifikanın ham DER'inden çıkarır. Yapı:
 * OID, OCTET STRING { SEQUENCE { [1] { OCTET STRING (32 bayt) } } }.
 * Node'un X509Certificate'i uzantıları ham vermiyor; OID'den sonraki ilk
 * 32 baytlık OCTET STRING aradığımız değer.
 */
function nonceFromCert(der: Buffer): Buffer {
  const at = der.indexOf(NONCE_OID);
  if (at < 0) throw new AttestError("Nonce uzantısı yok.");
  const window = der.subarray(at + NONCE_OID.length, at + NONCE_OID.length + 24);
  const marker = window.indexOf(Buffer.from([0x04, 0x20]));
  if (marker < 0) throw new AttestError("Nonce okunamadı.");
  const start = at + NONCE_OID.length + marker + 2;
  return der.subarray(start, start + 32);
}

// MARK: - CBOR

/**
 * Yalnızca App Attest nesnesinin kullandığı CBOR türleri: tamsayı, bayt
 * dizisi, metin, dizi, sözlük. Bunun için bağımlılık eklemeye değmez.
 */
function decodeCbor(input: Buffer): unknown {
  let offset = 0;

  function length(info: number): number {
    if (info < 24) return info;
    if (info === 24) return input.readUInt8(offset++);
    if (info === 25) { const v = input.readUInt16BE(offset); offset += 2; return v; }
    if (info === 26) { const v = input.readUInt32BE(offset); offset += 4; return v; }
    if (info === 27) { const v = Number(input.readBigUInt64BE(offset)); offset += 8; return v; }
    throw new AttestError("CBOR uzunluğu desteklenmiyor.");
  }

  function item(): unknown {
    if (offset >= input.length) throw new AttestError("CBOR eksik.");
    const head = input.readUInt8(offset++);
    const major = head >> 5;
    const info = head & 0x1f;
    switch (major) {
      case 0:
        return length(info);
      case 1:
        return -1 - length(info);
      case 2: {
        const n = length(info);
        const value = input.subarray(offset, offset + n);
        offset += n;
        return Buffer.from(value);
      }
      case 3: {
        const n = length(info);
        const value = input.subarray(offset, offset + n).toString("utf8");
        offset += n;
        return value;
      }
      case 4: {
        const n = length(info);
        return Array.from({ length: n }, () => item());
      }
      case 5: {
        const n = length(info);
        const map: Record<string, unknown> = {};
        for (let i = 0; i < n; i++) {
          const key = item();
          map[String(key)] = item();
        }
        return map;
      }
      default:
        throw new AttestError("CBOR türü desteklenmiyor.");
    }
  }

  return item();
}
