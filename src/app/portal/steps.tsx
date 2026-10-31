"use client";

import { useRef, useState, type FormEvent, type RefObject } from "react";
import type { ResolvedProduct } from "@/lib/resolve";
import type { Slot } from "@/lib/slots";
import { slotKey, t, type Lang, type TextKey } from "../i18n";
import { Alert, CheckIcon, ChevronIcon, CloseIcon, PhotoIcon, Spinner } from "./ui";

export const SLOT_ORDER: Slot[] = ["top", "bottom", "shoes", "full"];

/** Çözülmüş ürün, artı kullanıcının seçtiği görsel. */
export type Item = ResolvedProduct & { image: string };

/**
 * Avatarın ölçüsünü de saklıyoruz. Çıktının en boy oranı buna göre
 * sabitleniyor, yoksa model bazen kare üretip kadrajı genişletiyor.
 */
export type Avatar = { url: string; width: number; height: number };

/** Site adı: marka yoksa linkin alan adı. */
export function siteName(item: ResolvedProduct): string {
  if (item.brand) return item.brand;
  try {
    return new URL(item.url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

type PhotoProps = {
  lang: Lang;
  avatar: Avatar | null;
  uploading: boolean;
  error: TextKey | null;
  uploadRef: RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
};

export function PhotoStep({ lang, avatar, uploading, error, uploadRef, onFile }: PhotoProps) {
  const captureRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function pick(input: HTMLInputElement) {
    const file = input.files?.[0];
    // Aynı dosya tekrar seçilebilsin diye değer sıfırlanıyor.
    input.value = "";
    if (file) onFile(file);
  }

  const openUpload = () => uploadRef.current?.click();

  return (
    <section className="step" aria-labelledby="step1-label" id="step-photo">
      <h2 className="label-md" id="step1-label">
        {t(lang, "step1")}
      </h2>

      <input ref={uploadRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.currentTarget)} />
      <input
        ref={captureRef}
        type="file"
        accept="image/*"
        capture="user"
        hidden
        onChange={(e) => pick(e.currentTarget)}
      />

      {avatar && !uploading && !error ? (
        <div className="photo-ready">
          <img className="photo-thumb" src={avatar.url} alt="" />
          <p className="photo-ready-text">
            <span className="gold-icon">
              <CheckIcon />
            </span>
            {t(lang, "photoReady")}
          </p>
          <button type="button" className="btn-text" onClick={openUpload}>
            {t(lang, "change")}
          </button>
        </div>
      ) : (
        <div
          className={`dropzone${dragging ? " is-dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file && !uploading) onFile(file);
          }}
        >
          <span className="dropzone-icon">
            <PhotoIcon />
          </span>
          {uploading ? (
            <div className="progress-wrap" role="status" aria-live="polite">
              <div className="progress" aria-hidden="true">
                <span />
              </div>
              <p className="body-md">{t(lang, "preparing")}</p>
            </div>
          ) : (
            <p className="body-md">{t(lang, "photoHint")}</p>
          )}
          <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={openUpload} disabled={uploading}>
              {t(lang, "upload")}
            </button>
            <button
              type="button"
              className="btn btn-secondary only-touch"
              onClick={() => captureRef.current?.click()}
              disabled={uploading}
            >
              {t(lang, "takePhoto")}
            </button>
          </div>
        </div>
      )}

      {error && (
        <Alert
          message={t(lang, error)}
          action={
            <button type="button" className="btn btn-secondary btn-sm" onClick={openUpload}>
              {t(lang, "tryAgain")}
            </button>
          }
        />
      )}
    </section>
  );
}

type LinksProps = {
  lang: Lang;
  items: Item[];
  link: string;
  resolving: boolean;
  error: TextKey | null;
  notice: TextKey | null;
  inputRef: RefObject<HTMLInputElement | null>;
  onLink: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onMove: (from: Slot, to: Slot) => void;
  onPick: (slot: Slot, image: string) => void;
  onRemove: (slot: Slot) => void;
};

export const MAX_PIECES = 3;

export function LinksStep(props: LinksProps) {
  const { lang, items, link, resolving, error, notice, inputRef, onLink, onSubmit } = props;
  const full = items.length >= MAX_PIECES;

  return (
    <section className="step" aria-labelledby="step2-label" id="step-links">
      <h2 className="label-md" id="step2-label">
        {t(lang, "step2")}
      </h2>
      <p className="body-md soft">{t(lang, "step2Hint")}</p>

      <form className="link-row" onSubmit={onSubmit}>
        <label htmlFor="link-input" className="sr-only">
          {t(lang, "linkLabel")}
        </label>
        <input
          ref={inputRef}
          id="link-input"
          className="field"
          type="url"
          inputMode="url"
          autoComplete="off"
          value={link}
          onChange={(e) => onLink(e.target.value)}
          placeholder={t(lang, "linkPlaceholder")}
          disabled={full || resolving}
        />
        <button type="submit" className="btn btn-primary" disabled={full || resolving || !link.trim()}>
          {resolving && <Spinner />}
          {resolving ? t(lang, "reading") : t(lang, "add")}
        </button>
      </form>

      <div aria-live="polite" className="live">
        {full && <p className="body-sm soft">{t(lang, "outfitFull")}</p>}
        {notice && <p className="body-sm info">{t(lang, notice)}</p>}
        {resolving && <span className="sr-only">{t(lang, "reading")}</span>}
      </div>

      {error && <Alert message={t(lang, error)} />}

      <ul className="pieces">
        {items.map((item) => (
          <PieceCard key={item.slot} item={item} {...props} />
        ))}
        {resolving && (
          <li className="piece skeleton" aria-hidden="true">
            <span className="piece-img shimmer" />
            <span className="skeleton-lines">
              <span className="shimmer" />
              <span className="shimmer short" />
            </span>
          </li>
        )}
      </ul>
    </section>
  );
}

function PieceCard({ item, lang, onMove, onPick, onRemove }: LinksProps & { item: Item }) {
  const images = item.images.slice(0, 8);
  return (
    <li className="piece-wrap">
      <div className="piece">
        <img className="piece-img" src={item.image} alt="" />
        <div className="piece-body">
          <p className="piece-name">{item.name}</p>
          <p className="body-sm soft">{siteName(item)}</p>
          <div className="piece-tags">
            <span className="slot-select">
              <span className="pill">
                {t(lang, slotKey(item.slot))}
                <ChevronIcon />
              </span>
              <select
                value={item.slot}
                aria-label={t(lang, "slotLabel")}
                onChange={(e) => onMove(item.slot, e.target.value as Slot)}
              >
                {SLOT_ORDER.map((slot) => (
                  <option key={slot} value={slot}>
                    {t(lang, slotKey(slot))}
                  </option>
                ))}
              </select>
            </span>
            {!item.slotConfident && <span className="pill pill-quiet">{t(lang, "slotGuessed")}</span>}
          </div>
        </div>
        <button
          type="button"
          className="icon-btn piece-remove"
          aria-label={t(lang, "remove", { name: item.name })}
          onClick={() => onRemove(item.slot)}
        >
          <CloseIcon />
        </button>
      </div>

      {images.length > 1 && (
        <div className="thumbs">
          {images.map((image, index) => (
            <button
              key={image}
              type="button"
              className={image === item.image ? "is-active" : ""}
              aria-pressed={image === item.image}
              aria-label={t(lang, "useImage", { n: index + 1 })}
              onClick={() => onPick(item.slot, image)}
            >
              <img src={image} alt="" />
            </button>
          ))}
        </div>
      )}
    </li>
  );
}
