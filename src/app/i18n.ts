import type { Slot } from "@/lib/slots";

export type Lang = "en" | "tr";

export const LANG_KEY = "tryit.lang";

const en = {
  heroTitle: "Try the whole look on you",
  heroSub: "Add one photo and product links. See the outfit on you.",

  step1: "1 · YOUR PHOTO",
  photoHint: "Full-length, in everyday clothes, good light",
  upload: "Upload photo",
  takePhoto: "Take photo",
  preparing: "Preparing your photo…",
  photoReady: "Photo ready",
  change: "Change",
  errNotPhoto: "That file isn't a photo. Try a JPG or PNG.",
  errTooLarge: "Photo is too large (max 10 MB).",
  errUpload: "Upload failed. Try again.",
  tryAgain: "Try again",

  step2: "2 · PRODUCT LINKS",
  step2Hint: "Paste up to 3 product links: top, bottom, shoes.",
  linkLabel: "Product link",
  linkPlaceholder: "Paste a product link",
  add: "Add",
  reading: "Reading link…",
  outfitFull: "Outfit is full. Remove a piece to add another.",
  slotLabel: "Slot",
  slotGuessed: "Slot guessed",
  remove: "Remove {name}",
  useImage: "Use image {n}",
  slot_top: "TOP",
  slot_bottom: "BOTTOM",
  slot_shoes: "SHOES",
  slot_full: "FULL OUTFIT",
  replaced_top: "Replaced your top.",
  replaced_bottom: "Replaced your bottom.",
  replaced_shoes: "Replaced your shoes.",
  replaced_full: "Replaced your full outfit.",
  replaced_both: "Replaced your top and bottom.",
  errLink: "We couldn't read that link. Check it and try again.",
  errStore: "This store isn't supported yet.",
  errNotLink: "That doesn't look like a link.",

  create: "Create my look",
  cancel: "Cancel",
  createReason: "Add a photo and at least one piece.",
  stage1: "Reading your photo",
  stage2: "Dressing the look",
  stage3: "Finishing details",
  seconds: "{n} s",
  usually: "Usually 20-30 seconds.",
  longer: "Taking longer than usual…",
  errGeneric: "Something went wrong. Please try again.",
  errFiltered: "We couldn't create this look with this photo. Try a photo in everyday clothes, or add a bottom piece too.",
  errHour: "You've reached the hourly limit. Try again in a while.",
  errDay: "You've used today's tries. Come back tomorrow.",
  errCapacity: "We're at capacity for today. Please come back tomorrow.",

  resultEmpty: "Your look appears here",
  resultAlt: "Your outfit on your photo",
  download: "Download",
  share: "Share",
  copyLink: "Copy link",
  copied: "Copied",
  tryAnother: "Try another look",
  changePhoto: "Change photo",
  changePieces: "Change pieces",
  close: "Close",
  piecesTitle: "Pieces in this look",
  viewStore: "View in store",

  privacy: "Privacy",
  footerNote: "Photos are used only to create your look.",
};

export type TextKey = keyof typeof en;

const tr: Record<TextKey, string> = {
  heroTitle: "Tüm kombini üzerinde dene",
  heroSub: "Bir fotoğraf ve ürün linkleri ekle. Kombini üzerinde gör.",

  step1: "1 · FOTOĞRAFIN",
  photoHint: "Boydan, günlük kıyafetlerle, iyi ışıkta",
  upload: "Fotoğraf yükle",
  takePhoto: "Fotoğraf çek",
  preparing: "Fotoğraf hazırlanıyor…",
  photoReady: "Fotoğraf hazır",
  change: "Değiştir",
  errNotPhoto: "Bu dosya fotoğraf değil. JPG veya PNG dene.",
  errTooLarge: "Fotoğraf çok büyük (en fazla 10 MB).",
  errUpload: "Yükleme başarısız. Tekrar dene.",
  tryAgain: "Tekrar dene",

  step2: "2 · ÜRÜN LİNKLERİ",
  step2Hint: "En fazla 3 ürün linki yapıştır: üst, alt, ayakkabı.",
  linkLabel: "Ürün linki",
  linkPlaceholder: "Ürün linkini yapıştır",
  add: "Ekle",
  reading: "Link okunuyor…",
  outfitFull: "Kombin dolu. Yeni parça için birini kaldır.",
  slotLabel: "Parçanın yeri",
  slotGuessed: "Yer tahmin edildi",
  remove: "{name} parçasını kaldır",
  useImage: "{n}. görseli kullan",
  slot_top: "ÜST",
  slot_bottom: "ALT",
  slot_shoes: "AYAKKABI",
  slot_full: "TEK PARÇA",
  replaced_top: "Üst parçan değiştirildi.",
  replaced_bottom: "Alt parçan değiştirildi.",
  replaced_shoes: "Ayakkabın değiştirildi.",
  replaced_full: "Tek parçan değiştirildi.",
  replaced_both: "Üst ve alt parçan değiştirildi.",
  errLink: "Bu link okunamadı. Kontrol edip tekrar dene.",
  errStore: "Bu mağaza henüz desteklenmiyor.",
  errNotLink: "Bu bir link gibi görünmüyor.",

  create: "Kombinimi oluştur",
  cancel: "İptal",
  createReason: "Bir fotoğraf ve en az bir parça ekle.",
  stage1: "Fotoğrafın okunuyor",
  stage2: "Kombin giydiriliyor",
  stage3: "Detaylar tamamlanıyor",
  seconds: "{n} sn",
  usually: "Genelde 20-30 saniye sürer.",
  longer: "Beklenenden uzun sürüyor…",
  errGeneric: "Bir şeyler ters gitti. Tekrar dene.",
  errFiltered: "Bu fotoğrafla bu kombin oluşturulamadı. Günlük kıyafetlerle çekilmiş bir fotoğraf dene ya da kombine bir alt parça da ekle.",
  errHour: "Saatlik sınıra ulaştın. Bir süre sonra tekrar dene.",
  errDay: "Bugünkü haklarını kullandın. Yarın tekrar gel.",
  errCapacity: "Bugünkü kapasitemiz doldu. Yarın tekrar gel.",

  resultEmpty: "Kombinin burada görünecek",
  resultAlt: "Kombinin, senin fotoğrafın üzerinde",
  download: "İndir",
  share: "Paylaş",
  copyLink: "Linki kopyala",
  copied: "Kopyalandı",
  tryAnother: "Başka kombin dene",
  changePhoto: "Fotoğrafı değiştir",
  changePieces: "Parçaları değiştir",
  close: "Kapat",
  piecesTitle: "Kombindeki parçalar",
  viewStore: "Mağazada gör",

  privacy: "Gizlilik",
  footerNote: "Fotoğraflar yalnızca kombini oluşturmak için kullanılır.",
};

const DICT: Record<Lang, Record<TextKey, string>> = { en, tr };

export function t(lang: Lang, key: TextKey, vars?: Record<string, string | number>): string {
  let text = DICT[lang][key];
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.replace(`{${name}}`, String(value));
  }
  return text;
}

export function slotKey(slot: Slot): TextKey {
  return `slot_${slot}`;
}

/** Sunucunun hata kodunu kullanıcı cümlesine çevirir; bilinmeyen kod genel metne düşer. */
export function errorKey(code: string | undefined, fallback: TextKey): TextKey {
  switch (code) {
    case "rate-hour":
      return "errHour";
    case "rate-day":
      return "errDay";
    case "global-day":
      return "errCapacity";
    case "content-filtered":
      return "errFiltered";
    default:
      return fallback;
  }
}

/** Bu kodlarda tekrar denemek işe yaramaz; buton pasif kalır. */
export function isLimitCode(code: string | undefined): boolean {
  return code === "rate-hour" || code === "rate-day" || code === "global-day";
}
