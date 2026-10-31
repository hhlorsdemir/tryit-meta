import Foundation
import Security

/// Bu kurulumun sunucudaki kimligi.
///
/// Sunucu kotayi cihaz basina tutuyor. Kimligi UserDefaults'ta saklasaydik
/// uygulamayi silip kurmak sayaci sifirlardi; Anahtar Zinciri silinmeye
/// dayaniyor, o yuzden burada duruyor.
///
/// Icinde kisisel hicbir sey yok, yalnizca rastgele bir UUID. Reklam kimligi
/// veya cihaz seri numarasi gibi izlenebilir bir deger kullanmiyoruz.
enum DeviceIdentity {
    private static let service = "com.lafagency.tryit"
    private static let account = "device-id"

    static let current: String = {
        if let existing = read() { return existing }
        let fresh = UUID().uuidString
        write(fresh)
        return fresh
    }()

    private static func read() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8),
              !value.isEmpty else {
            return nil
        }
        return value
    }

    private static func write(_ value: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)

        var insert = query
        insert[kSecValueData as String] = Data(value.utf8)
        // Yedekle baska bir cihaza tasinmasin; kota bu kuruluma ait.
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(insert as CFDictionary, nil)
    }
}
