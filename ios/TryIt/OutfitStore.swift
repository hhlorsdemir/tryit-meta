import Foundation
import SwiftUI

/// Kaydedilmiş kombindeki tek parça. Ürünün kendisini değil, o anki
/// bilgilerini saklıyoruz; ürün sayfası sonradan değişse de kombin kaydı
/// bozulmasın diye.
struct SavedItem: Codable, Identifiable, Sendable {
    let slot: Slot
    let name: String
    let productURL: String
    let imageURL: String
    let price: String?
    let currency: String?

    var id: String { slot.rawValue + productURL }

    var priceText: String? {
        Money.format(price: price, currency: currency)
    }
}

struct SavedOutfit: Codable, Identifiable, Sendable {
    let id: UUID
    let createdAt: Date
    /// Documents/outfits içindeki dosya adı.
    let imageFile: String
    let items: [SavedItem]
    /// Kullanicinin elle verdigi kullanim etiketi. Kombinlerim ekraninda
    /// filtre olarak calisiyor.
    var occasion: Occasion?

    /// Kombindeki parcalarin toplam tutari.
    var totalPrice: String? {
        Money.total(items.map { ($0.price, $0.currency) })
    }
}

/// Kaydedilmiş kombinler. Dizin JSON olarak, görseller ayrı dosyalar
/// halinde uygulamanın Documents klasöründe duruyor.
@MainActor
@Observable
final class OutfitStore {
    private(set) var outfits: [SavedOutfit] = []

    private let fileManager = FileManager.default

    private var documents: URL {
        fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    private var indexURL: URL {
        documents.appendingPathComponent("outfits.json")
    }

    private var imagesDirectory: URL {
        documents.appendingPathComponent("outfits", isDirectory: true)
    }

    init() {
        load()
    }

    func imageURL(for outfit: SavedOutfit) -> URL {
        imagesDirectory.appendingPathComponent(outfit.imageFile)
    }

    private func load() {
        guard let data = try? Data(contentsOf: indexURL) else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        outfits = (try? decoder.decode([SavedOutfit].self, from: data)) ?? []
    }

    private func persist() throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(outfits).write(to: indexURL, options: .atomic)
    }

    /// Sonuç görselini diske yazar ve kombini kaydeder.
    ///
    /// `localImage` verilmişse görsel oradan okunuyor, ağa çıkılmıyor.
    func save(
        resultURL: String,
        localImage: URL? = nil,
        items: [Item],
        occasion: Occasion? = nil
    ) async throws {
        let data: Data
        if let localImage, let local = try? Data(contentsOf: localImage) {
            data = local
        } else {
            guard let url = URL(string: resultURL) else {
                throw APIError(message: String(localized: "Kombin görseli bulunamadı."))
            }
            do {
                (data, _) = try await URLSession.shared.data(from: url)
            } catch {
                throw APIError(message: String(localized: "Kombin görseli indirilemedi."))
            }
        }

        try fileManager.createDirectory(at: imagesDirectory, withIntermediateDirectories: true)

        let id = UUID()
        let file = "\(id.uuidString).jpg"
        try data.write(to: imagesDirectory.appendingPathComponent(file), options: .atomic)

        let outfit = SavedOutfit(
            id: id,
            createdAt: Date(),
            imageFile: file,
            items: items.map { item in
                SavedItem(
                    slot: item.slot,
                    name: item.product.name,
                    productURL: item.product.url,
                    imageURL: item.image,
                    price: item.product.price,
                    currency: item.product.currency
                )
            },
            occasion: occasion
        )

        outfits.insert(outfit, at: 0)
        try persist()
    }

    /// Kayitli bir kombinin etiketini degistirir.
    func setOccasion(_ occasion: Occasion?, for outfit: SavedOutfit) {
        guard let index = outfits.firstIndex(where: { $0.id == outfit.id }) else { return }
        outfits[index].occasion = occasion
        try? persist()
    }

    func delete(_ outfit: SavedOutfit) {
        outfits.removeAll { $0.id == outfit.id }
        try? fileManager.removeItem(at: imageURL(for: outfit))
        try? persist()
    }
}
