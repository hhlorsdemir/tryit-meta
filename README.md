# TryIt

Try on clothes from any online store, on your own photo.
Built with **Muse Spark 1.3** and **Muse Image** for the Meta Global AI
Developer Hackathon 2026 (Startup Track).

- Web: https://tryit.lafdev.com (no account needed)
- iOS (TestFlight): https://testflight.apple.com/join/Hx5hdEjU
- Demo video: https://youtu.be/l6mrazkdFDs

You add one full-length photo of yourself once. Then, on any product page,
you tap Share and send the link to TryIt (or paste it on the web). Add a top,
a bottom and shoes, even from different stores, and TryIt shows the whole
outfit on your own photo in about 20 seconds.

## How it uses Meta models

| Step | Model | Code |
|---|---|---|
| Read a product page that has no structured data: classify the page, name the product, pick its slot, choose product photos **by index** from images our code extracted | Muse Spark 1.3 (`/responses`, json_schema) | `src/lib/sparkresolve.ts`, `src/lib/pagecandidates.ts` |
| Product card: which garment it is, its cut, length and details, so the right piece is copied even when the store model wears a full outfit; cached per product | Muse Spark 1.3 | `src/lib/productcard.ts`, `src/lib/productcache.ts` |
| Dress the person in up to three garments in **one** multi-reference edit | Muse Image (`muse-image-1.0`, `/images/edits`) | `src/lib/tryon.ts` (`generateTryOn`), `src/lib/meta.ts` |

Rule passed to Muse Image with every card: if the card and the photo disagree,
follow the photo. Colour is left out of the card on purpose (colour words
shifted the generated colour in our tests).

We also evaluated SAM 3.1 for masking and garment cut-out; it did not improve
results in our A/B tests, so the shipped pipeline uses Muse Spark and Muse
Image only. Experiment scripts are in `scripts/`.

Compared with our previous engine, cost per image dropped 8x ($0.08 to
$0.01) and the Spark product card cut invented garment details from 4 of 12
images to 1 of 12 in our tests.

## Architecture

- `src/app/api/resolve`: product link to product. Share-sheet short links
  are unwrapped (`src/lib/sharelink.ts`), then schema.org JSON-LD, a dedicated
  Amazon reader (`src/lib/amazon.ts`), OpenGraph, then Muse Spark. Pages
  behind bot protection open in Chromium under Xvfb (`src/lib/browser.ts`).
  Every server-side fetch passes an SSRF guard.
- `src/app/api/tryon`: outfit generation with Muse Image; dedicated
  `content-filtered` error with a clear user message when the image model's
  safety filter refuses a request.
- `src/app/api/web/session`, `src/app/portal`: web portal with an
  HMAC-signed, HttpOnly session cookie, same-origin checks and per-session,
  per-IP and global limits (`src/lib/guard.ts`).
- `src/lib/media.ts`, `src/app/api/media`: user photos and results are
  stored on our own server under unguessable names and deleted after 30 days.
- `ios/`: SwiftUI app and share extension (`ios/TryItShare`), App Attest.
- `deploy/`: Docker image and compose file (single server behind Caddy).

## Run locally

```bash
npm install
cp .env.example .env.local   # add META_API_KEY
npm run dev
```

```bash
npm test          # 64 unit tests: resolver, Amazon reader, image candidates, Spark parser, media storage
npm run typecheck
```

Most code comments and internal notes are in Turkish; the team is based in
Istanbul.

## Team

- Hasan Lütfü Örsdemir: product, iOS and full-stack engineering
- Osman Fatih Kılıç: AI pipeline optimisation
