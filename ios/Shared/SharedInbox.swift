import Foundation

/// Paylaş menüsünden gelen linklerin bekleme kuyruğu.
///
/// Eklenti linki çözmüyor, yalnızca buraya bırakıyor. Çözmek sunucuya
/// gidiyor ve saniyeler sürebiliyor; paylaş menüsü o kadar bekletilmemeli.
/// Uygulama açıldığında kuyruğu boşaltıp linkleri kendisi çözüyor.
///
/// Uygulama ile eklenti ayrı süreçler, ortak depoları yalnızca App Group.
enum SharedInbox {
    /// Hem uygulamanın hem eklentinin yetkilendirmesinde yazılı.
    static let appGroup = "group.com.lafagency.tryit"

    private static let key = "tryit.pendingLinks"

    /// Kombine en fazla üç parça giriyor (üst, alt, ayakkabı), o yüzden
    /// kuyruk da üçte duruyor. Fazlası yalnızca birbirini eziyor.
    private static let limit = 3

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroup)
    }

    static func add(_ link: String) {
        let trimmed = link.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let defaults else { return }

        var links = defaults.stringArray(forKey: key) ?? []
        guard !links.contains(trimmed) else { return }

        links.append(trimmed)
        defaults.set(Array(links.suffix(limit)), forKey: key)
    }

    /// Bekleyenleri verir, kuyruğa dokunmaz.
    ///
    /// Okumakla silmeyi bilerek ayırdık. Önce hepsini silip sonra çözmeye
    /// kalksaydık, çözme yarıda kalan link (ağ koptu, uygulama kapandı)
    /// bir daha geri gelmezdi.
    static func pending() -> [String] {
        defaults?.stringArray(forKey: key) ?? []
    }

    /// İşi biten linki kuyruktan çıkarır.
    static func remove(_ link: String) {
        guard let defaults else { return }
        let links = (defaults.stringArray(forKey: key) ?? []).filter { $0 != link }
        if links.isEmpty {
            defaults.removeObject(forKey: key)
        } else {
            defaults.set(links, forKey: key)
        }
    }

    static func clear() {
        defaults?.removeObject(forKey: key)
    }
}
