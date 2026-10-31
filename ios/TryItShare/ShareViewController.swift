import UIKit
import UniformTypeIdentifiers

/// Paylaş menüsünden gelen ürün linkini kuyruğa bırakır.
///
/// Burada ağa çıkmıyoruz. Paylaş menüsü kullanıcının bir sitenin
/// üzerindeyken açtığı geçici bir pencere; orada sunucu beklemek akışı
/// tıkar. Link bırakılıyor, uygulama açıldığında çözülüyor.
final class ShareViewController: UIViewController {
    private let card = UIView()
    private let label = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        buildCard()
        Task { await handleInput() }
    }

    // MARK: - Görünüm

    private func buildCard() {
        view.backgroundColor = UIColor.black.withAlphaComponent(0.2)

        card.backgroundColor = UIColor(red: 0xFB / 255, green: 0xF9 / 255, blue: 0xF6 / 255, alpha: 1)
        card.layer.cornerRadius = 18
        card.layer.cornerCurve = .continuous
        card.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)

        let icon = UIImageView(image: UIImage(systemName: "hanger"))
        icon.tintColor = UIColor(red: 0x12 / 255, green: 0x12 / 255, blue: 0x14 / 255, alpha: 1)
        icon.contentMode = .scaleAspectFit

        label.text = String(localized: "Ekleniyor", comment: "Link TryIt kuyruğuna ekleniyor")
        label.font = .systemFont(ofSize: 15, weight: .medium)
        label.textColor = UIColor(red: 0x12 / 255, green: 0x12 / 255, blue: 0x14 / 255, alpha: 1)

        let row = UIStackView(arrangedSubviews: [icon, label])
        row.spacing = 10
        row.alignment = .center
        row.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(row)

        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 20),
            icon.heightAnchor.constraint(equalToConstant: 20),
            row.topAnchor.constraint(equalTo: card.topAnchor, constant: 18),
            row.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -18),
            row.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 22),
            row.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -22),
        ])
    }

    // MARK: - Girdi

    private func handleInput() async {
        guard let link = await firstURL() else {
            await finish(text: String(localized: "Bu paylaşımda link yok"), ok: false)
            return
        }

        SharedInbox.add(link.absoluteString)
        await finish(text: String(localized: "TryIt'e eklendi"), ok: true)
    }

    /// Paylaşımdaki ilk web adresini bulur.
    ///
    /// Bazı uygulamalar adresi düz metin olarak veriyor, o yüzden metin
    /// tipine de bakıyoruz.
    private func firstURL() async -> URL? {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []

        for item in items {
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                   let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL,
                   url.scheme?.hasPrefix("http") == true {
                    return url
                }
                if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                   let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String,
                   let found = Self.url(in: text) {
                    return found
                }
            }
        }
        return nil
    }

    private static func url(in text: String) -> URL? {
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        let range = NSRange(text.startIndex..., in: text)
        let match = detector?.firstMatch(in: text, range: range)
        guard let url = match?.url, url.scheme?.hasPrefix("http") == true else { return nil }
        return url
    }

    // MARK: - Kapanış

    @MainActor
    private func finish(text: String, ok: Bool) async {
        label.text = text
        // Kullanıcı ne olduğunu okuyabilsin diye kısa bir bekleme. Hata
        // durumunda biraz daha uzun duruyor.
        try? await Task.sleep(for: .milliseconds(ok ? 700 : 1400))
        extensionContext?.completeRequest(returningItems: nil)
    }
}
