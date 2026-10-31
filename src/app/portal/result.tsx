"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { slotKey, t, type Lang, type TextKey } from "../i18n";
import { siteName, type Avatar, type Item } from "./steps";
import { Alert, PhotoIcon } from "./ui";

export type Look = { url: string; pieces: Item[] };
export type GenerateError = { key: TextKey; limit: boolean };

/** Sunucu çıktısı çoğunlukla JPEG geliyor; uzantı blob türünden seçiliyor. */
function fileName(type: string): string {
  return type === "image/jpeg" ? "tryit-look.jpg" : "tryit-look.png";
}
const STAGES: TextKey[] = ["stage1", "stage2", "stage3"];
const STAGE_SECONDS = 8;
const SLOW_SECONDS = 45;

type Props = {
  lang: Lang;
  look: Look | null;
  avatar: Avatar | null;
  generating: boolean;
  elapsed: number;
  error: GenerateError | null;
  onRetry: () => void;
  onChangePhoto: () => void;
  onChangePieces: () => void;
};

export function ResultPanel(props: Props) {
  const { lang, look, avatar, generating, error } = props;
  const idle = !look && !generating && !error;
  const frameStyle =
    avatar && avatar.width > 0 && avatar.height > 0
      ? ({ "--frame-w": avatar.width, "--frame-h": avatar.height } as CSSProperties)
      : undefined;

  return (
    <section className={`result${idle ? " is-idle" : ""}`} aria-label={t(lang, "resultAlt")}>
      <div className="result-frame" style={frameStyle}>
        {look ? (
          <LookImage key={look.url} url={look.url} alt={t(lang, "resultAlt")} dim={generating} />
        ) : generating && avatar ? (
          <img className="result-img is-blurred" src={avatar.url} alt="" />
        ) : (
          !generating && (
            <div className="result-empty">
              <PhotoIcon />
              <p className="body-md soft">{t(lang, "resultEmpty")}</p>
            </div>
          )
        )}
        {generating && <Waiting lang={lang} elapsed={props.elapsed} />}
      </div>

      {error && (
        <Alert
          message={t(lang, error.key)}
          action={
            <button type="button" className="btn btn-secondary btn-sm" onClick={props.onRetry} disabled={error.limit}>
              {t(lang, "tryAgain")}
            </button>
          }
        />
      )}

      {look && !generating && <LookActions {...props} look={look} />}
    </section>
  );
}

function LookImage({ url, alt, dim }: { url: string; alt: string; dim: boolean }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      className={`result-img fade${loaded ? " is-loaded" : ""}${dim ? " is-dim" : ""}`}
      src={url}
      alt={alt}
      onLoad={() => setLoaded(true)}
    />
  );
}

function Waiting({ lang, elapsed }: { lang: Lang; elapsed: number }) {
  const stage = STAGES[Math.min(STAGES.length - 1, Math.floor(elapsed / STAGE_SECONDS))];
  return (
    <div className="waiting">
      <svg className="ring" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <circle cx="24" cy="24" r="21" />
      </svg>
      <div className="waiting-text">
        <p className="headline-sm" role="status" aria-live="polite">
          {elapsed >= SLOW_SECONDS ? t(lang, "longer") : t(lang, stage)}
        </p>
        <p className="body-sm soft">
          <span className="tabular" aria-hidden="true">
            {t(lang, "seconds", { n: elapsed })}
          </span>
          {" · "}
          {t(lang, "usually")}
        </p>
      </div>
    </div>
  );
}

/** Paylaşım dosyayla mı olur, yoksa link mi kopyalanır; açılışta bir kez bakılır. */
function canShareFiles(): boolean {
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [new File([""], "tryit-look.png", { type: "image/png" })] });
  } catch {
    return false;
  }
}

function LookActions({ lang, look, onChangePhoto, onChangePieces }: Props & { look: Look }) {
  const [fileShare, setFileShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sheet, setSheet] = useState(false);
  const blob = useRef<Promise<Blob | null> | null>(null);

  useEffect(() => setFileShare(canShareFiles()), []);

  // Görsel önceden çekiliyor: Safari paylaşımı kullanıcı dokunuşundan sonra
  // uzun bir await gelirse reddediyor. CORS kapalıysa null kalır.
  useEffect(() => {
    blob.current = fetch(look.url)
      .then((res) => (res.ok ? res.blob() : null))
      .catch(() => null);
  }, [look.url]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function download() {
    const data = await blob.current;
    if (!data) {
      window.open(look.url, "_blank", "noopener,noreferrer");
      return;
    }
    const href = URL.createObjectURL(data);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = fileName(data.type);
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  async function share() {
    const data = fileShare ? await blob.current : null;
    if (data) {
      try {
        await navigator.share({ files: [new File([data], fileName(data.type), { type: data.type || "image/png" })] });
        return;
      } catch (err) {
        // Kullanıcı paylaşım penceresini kapattıysa başka bir şey yapmıyoruz.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(look.url);
      setCopied(true);
    } catch {
      window.open(look.url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={download}>
          {t(lang, "download")}
        </button>
        <button type="button" className="btn btn-secondary" onClick={share}>
          {fileShare ? t(lang, "share") : t(lang, "copyLink")}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          aria-expanded={sheet}
          aria-controls="another-sheet"
          onClick={() => setSheet((open) => !open)}
        >
          {t(lang, "tryAnother")}
        </button>
      </div>
      <p className="body-sm soft live" aria-live="polite">
        {copied ? t(lang, "copied") : ""}
      </p>

      {sheet && (
        <div className="sheet" id="another-sheet" role="group" aria-label={t(lang, "tryAnother")}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setSheet(false);
              onChangePhoto();
            }}
          >
            {t(lang, "changePhoto")}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setSheet(false);
              onChangePieces();
            }}
          >
            {t(lang, "changePieces")}
          </button>
          <button type="button" className="btn-text" onClick={() => setSheet(false)}>
            {t(lang, "close")}
          </button>
        </div>
      )}

      <h3 className="label-md">{t(lang, "piecesTitle")}</h3>
      <ul className="look-pieces">
        {look.pieces.map((item) => (
          <li key={item.slot}>
            <img src={item.image} alt="" />
            <div>
              <p className="body-md strong clamp">{item.name}</p>
              <p className="body-sm soft">
                <span className="pill">{t(lang, slotKey(item.slot))}</span> {siteName(item)}
              </p>
            </div>
            <a className="btn-text" href={item.url} target="_blank" rel="noopener noreferrer">
              {t(lang, "viewStore")}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
