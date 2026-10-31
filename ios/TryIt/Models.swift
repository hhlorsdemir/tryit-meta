import Foundation

/// Kıyafetin vücutta kapladığı yer. Sunucudaki karşılığıyla aynı adları
/// kullanıyor, çünkü JSON'da bu değerler gidip geliyor.
enum Slot: String, Codable, CaseIterable, Identifiable {
    case top
    case bottom
    case shoes
    case full

    var id: String { rawValue }

    var label: String {
        switch self {
        case .top: return String(localized: "Üst", comment: "Kıyafet yuvası: üst giyim")
        case .bottom: return String(localized: "Alt", comment: "Kıyafet yuvası: alt giyim")
        case .shoes: return String(localized: "Ayakkabı", comment: "Kıyafet yuvası")
        case .full: return String(localized: "Tek parça", comment: "Kıyafet yuvası: elbise, tulum gibi tek parça giysi")
        }
    }
}

/// Sunucunun /api/resolve ucundan dönen ürün.
struct ResolvedProduct: Codable, Sendable {
    let url: String
    let name: String
    let brand: String?
    let price: String?
    let currency: String?
    let images: [String]
    let slot: Slot
    let slotConfident: Bool
}

/// Kombine eklenmiş ürün: çözülmüş ürün, artı kullanıcının seçtiği görsel
/// ve gerekiyorsa elle düzeltilmiş yuva.
struct Item: Codable, Identifiable, Sendable {
    let product: ResolvedProduct
    var slot: Slot
    var image: String

    var id: Slot { slot }

    var priceText: String? {
        Money.format(price: product.price, currency: product.currency)
    }
}

/// Avatar bir kez yüklenip saklanıyor. Ölçüsünü de tutuyoruz: çıktının en
/// boy oranı buna göre sabitleniyor.
///
/// `url` sunucuya yüklenmiş kopyanın adresi, `file` ise cihazdaki yerel
/// kopya. İkisini birden tutuyoruz: arayüz yerelden anında çiziliyor ve
/// yüklenen adres geçersizleşirse yerel kopyadan yeniden yükleyip
/// kullanıcıyı fotoğrafını baştan seçmek zorunda bırakmıyoruz.
struct Avatar: Codable, Sendable {
    let url: String
    let width: Int
    let height: Int
    var file: String?
}

/// Kombine elle verilen kullanim etiketi. Tasarimda bu etiketler
/// Kombinlerim ekraninin filtre cipleri olarak duruyor.
enum Occasion: String, Codable, CaseIterable, Identifiable, Sendable {
    case ofis
    case haftaSonu
    case gece
    case ozelDavet

    var id: String { rawValue }

    var label: String {
        switch self {
        case .ofis: return String(localized: "Ofis", comment: "Kombin etiketi")
        case .haftaSonu: return String(localized: "Hafta Sonu", comment: "Kombin etiketi")
        case .gece: return String(localized: "Gece", comment: "Kombin etiketi: gece dışarı çıkmak için")
        case .ozelDavet: return String(localized: "Özel Davet", comment: "Kombin etiketi")
        }
    }
}

/// Fiyat metinlerini toplayip tek bir tutara cevirir. Fiyatlar sunucudan
/// "1396.50" gibi geliyor; para birimi karisirsa toplam vermiyoruz, cunku
/// farkli birimleri toplamak yanlis olur.
enum Money {
    /// Tek bir fiyati kullanicinin dilinin bicimiyle yazar.
    static func format(price: String?, currency: String?) -> String? {
        guard let raw = price, let value = Double(raw) else { return nil }
        return render(value, currency: currency ?? "")
    }

    private static func render(_ value: Double, currency: String) -> String {
        let formatter = NumberFormatter()
        formatter.locale = .app
        // Para birimi varsa simgenin yeri ve ayiraclar dile gore:
        // Turkcede "₺1.499", Almancada "1.499 ₺".
        if currency.isEmpty {
            formatter.numberStyle = .decimal
        } else {
            formatter.numberStyle = .currency
            formatter.currencyCode = currency
            // Bazi dillerde lira "TRY" diye yaziliyor; urun Turk
            // magazasindan geldigi icin simgesi daha tanidik.
            if currency == "TRY" { formatter.currencySymbol = "₺" }
        }
        // Kurus hanesi ya tam gosteriliyor ya hic: "1.396,5" gibi yarim
        // bir tutar perakende fiyati gibi durmuyor.
        let hasFraction = abs(value.truncatingRemainder(dividingBy: 1)) > 0.001
        formatter.minimumFractionDigits = hasFraction ? 2 : 0
        formatter.maximumFractionDigits = hasFraction ? 2 : 0
        return formatter.string(from: NSNumber(value: value)) ?? "\(value) \(currency)"
    }

    static func total(_ entries: [(price: String?, currency: String?)]) -> String? {
        let priced = entries.compactMap { entry -> (Double, String)? in
            guard let raw = entry.price, let value = Double(raw) else { return nil }
            return (value, entry.currency ?? "")
        }
        guard !priced.isEmpty else { return nil }
        let currencies = Set(priced.map(\.1))
        guard currencies.count == 1, let unit = currencies.first else { return nil }

        return render(priced.reduce(0) { $0 + $1.0 }, currency: unit)
    }
}
