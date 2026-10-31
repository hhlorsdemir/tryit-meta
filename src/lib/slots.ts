export type Slot = "top" | "bottom" | "shoes" | "full";

export const SLOT_LABELS: Record<Slot, string> = {
  top: "Üst",
  bottom: "Alt",
  shoes: "Ayakkabı",
  full: "Tek parça",
};

/** Giydirme isteminde parçanın nasıl anlatılacağı. */
export const SLOT_EN: Record<Slot, string> = {
  top: "upper-body garment",
  bottom: "lower-body garment",
  shoes: "footwear",
  full: "one-piece outfit",
};

/**
 * Türkçe metni eşleştirmeye uygun hale getirir: küçük harfe indirir ve
 * Türkçe karakterleri ASCII karşılıklarına çevirir. Böylece anahtar
 * kelimeleri düz ASCII olarak yazabiliyoruz.
 */
export function norm(input: string): string {
  return input
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[âà]/g, "a")
    .replace(/[îï]/g, "i")
    .replace(/[ûù]/g, "u")
    .replace(/[éè]/g, "e");
}

/**
 * Terimi kelime başında arar. Türkçe eklemeli bir dil olduğu için sonek
 * serbest bırakılıyor: "pantolon" terimi "pantolonu" ile de eşleşir.
 * Kelime başı şartı ise "trençkot" içindeki "kot" gibi yanlış
 * eşleşmeleri engelliyor.
 */
function hasTerm(haystack: string, term: string): boolean {
  const pattern = term.replace(/[\s-]+/g, "[\\s-]*");
  // Sonek serbest, ama bazi kisa terimler marka adinin icine dusuyor:
  // "kot" terimi "Koton" markasiyla esleserek tisortu alta yaziyordu.
  // Bu terimlerde kelimenin bitmesini sart kosuyoruz.
  const strict = STRICT_TERMS.has(term);
  const tail = strict ? "(?![a-z0-9])" : "";
  return new RegExp(`(^|[^a-z0-9])${pattern}${tail}`).test(haystack);
}

/** Sonek almasina izin verilmeyen terimler. */
const STRICT_TERMS = new Set(["kot", "bot", "sort", "polo", "jean"]);

// Sıra önemli: tek parça, alt ve ayakkabı üstten önce denenir. Böylece
// "Eşofman Takımı" tek parça, "Sweat Pants" alt olarak sınıflanır.
const RULES: Array<{ slot: Slot; terms: string[] }> = [
  {
    slot: "full",
    terms: ["elbise", "tulum", "takim", "jumpsuit", "overall", "esofman takim"],
  },
  {
    slot: "bottom",
    terms: [
      "esofman",
      "pantolon",
      "sort",
      "sweat pants",
      "sweatpants",
      "jean",
      "kot",
      "tayt",
      "jogger",
      "etek",
      "capri",
      "chino",
      "pijama",
      "alt giyim",
    ],
  },
  {
    slot: "shoes",
    terms: [
      "ayakkabi",
      "sneaker",
      "bot",
      "cizme",
      "terlik",
      "sandalet",
      "loafer",
      "babet",
      "espadril",
      "postal",
      "topuklu",
      "oxford",
    ],
  },
  {
    slot: "top",
    terms: [
      "hoodie",
      "sweatshirt",
      "sweat shirt",
      "tisort",
      "tshirt",
      "t shirt",
      "gomlek",
      "hirka",
      "kazak",
      "ceket",
      "mont",
      "kaban",
      "bluz",
      "polo",
      "atlet",
      "yelek",
      "tunik",
      "bomber",
      "trenckot",
      "kapusonlu",
      "triko",
      "suveter",
      "anorak",
      "parka",
      "yagmurluk",
      "jile",
      "ust giyim",
    ],
  },
];

/**
 * Ürünün hangi yuvaya gireceğini kategori yolu, ürün adı ve URL'den tahmin
 * eder. Hiçbiri tutmazsa "top" döner, çünkü kataloglarda üst giyim
 * çoğunlukta ve kullanıcı yuvayı arayüzden düzeltebiliyor.
 */
export function detectSlot(parts: {
  name?: string;
  brand?: string;
  categoryPath?: string[];
  url?: string;
}): { slot: Slot; confident: boolean } {
  // Marka adı çıkarılıyor: kıyafet sözlüğüyle çakışan markalar var ve
  // marka ürünün ne olduğu hakkında bilgi taşımıyor.
  const withoutBrand = stripBrand(parts.name ?? "", parts.brand);

  // Kategori yolu ürün adından daha güvenilir, önce o denenir.
  const candidates = [
    (parts.categoryPath ?? []).join(" "),
    withoutBrand,
    (parts.url ?? "").replace(/[^a-zA-Z0-9]+/g, " "),
  ];

  for (const candidate of candidates) {
    if (!candidate.trim()) continue;
    const haystack = norm(candidate);
    for (const rule of RULES) {
      for (const term of rule.terms) {
        if (hasTerm(haystack, term)) {
          return { slot: rule.slot, confident: true };
        }
      }
    }
  }

  return { slot: "top", confident: false };
}

/** Ürün adının başındaki marka adını atar. */
function stripBrand(name: string, brand?: string): string {
  if (!brand?.trim()) return name;
  const needle = norm(brand.trim());
  const hay = norm(name);
  if (!needle || !hay.startsWith(needle)) return name;
  return name.slice(brand.trim().length);
}
