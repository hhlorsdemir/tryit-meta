import Foundation
import StoreKit

/// Abonelikler: ürünler, satın alma, geri yükleme.
///
/// Hak sayımı burada değil sunucuda. Uygulama yalnızca Apple'ın imzaladığı
/// işlem kaydını (`entitlement`) sunucuya taşıyor; sunucu imzayı doğrulayıp
/// kalan hakkı hesaplıyor. Uygulamada tutulsa saati geri almak ya da
/// yeniden kurmak hakkı sıfırlardı.
@MainActor
@Observable
final class Purchases {
    static let monthlyID = "com.lafagency.tryit.premium.monthly"
    static let yearlyID = "com.lafagency.tryit.premium.yearly"

    private(set) var monthly: Product?
    private(set) var yearly: Product?
    /// Ürün isteği en az bir kez cevaplandı.
    private(set) var loaded = false
    private(set) var loadFailed = false
    /// Etkin aboneliğin imzalı işlem kaydı. Yoksa kullanıcı ücretsiz planda.
    private(set) var entitlement: String?

    /// Satın alma ya da yenileme olunca haber verir; model kalan hakkı tazeler.
    var onChange: (() async -> Void)?

    private var updates: Task<Void, Never>?

    init() {
        // Uygulama kapalıyken gerçekleşen yenileme, iade ve Aile
        // Paylaşımı değişiklikleri burada geliyor.
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                guard let self else { return }
                if case .verified(let transaction) = result {
                    await transaction.finish()
                }
                await self.refreshEntitlement()
                await self.onChange?()
            }
        }
    }

    func loadProducts() async {
        do {
            let products = try await Product.products(for: [Self.monthlyID, Self.yearlyID])
            monthly = products.first { $0.id == Self.monthlyID }
            yearly = products.first { $0.id == Self.yearlyID }
            loadFailed = products.isEmpty
        } catch {
            loadFailed = true
        }
        loaded = true
    }

    /// Etkin aboneliğin işlem kaydını bulur.
    ///
    /// İki abonelik aynı grupta; aynı anda yalnızca biri etkin olabiliyor.
    /// Yine de ikisi görünürse süresi en geç dolanı seçiyoruz.
    func refreshEntitlement() async {
        var best: (jws: String, expires: Date)?
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result,
                  [Self.monthlyID, Self.yearlyID].contains(transaction.productID),
                  transaction.revocationDate == nil else { continue }
            let expires = transaction.expirationDate ?? .distantPast
            if best == nil || expires > best!.expires {
                best = (result.jwsRepresentation, expires)
            }
        }
        entitlement = best?.jws
    }

    enum Outcome { case purchased, cancelled, pending }

    func purchase(_ product: Product) async throws -> Outcome {
        let result = try await product.purchase()
        switch result {
        case .success(let verification):
            guard case .verified(let transaction) = verification else {
                throw APIError(message: String(localized: "Satın alma doğrulanamadı."))
            }
            await transaction.finish()
            await refreshEntitlement()
            return .purchased
        case .userCancelled:
            return .cancelled
        case .pending:
            // Aile onayı ya da ödeme onayı bekleniyor; sonuç `updates` ile gelir.
            return .pending
        @unknown default:
            return .cancelled
        }
    }

    /// App Store'daki satın alımları cihaza yeniden getirir.
    func restore() async throws {
        try await AppStore.sync()
        await refreshEntitlement()
    }
}
