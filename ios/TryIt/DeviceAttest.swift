import CryptoKit
import DeviceCheck
import Foundation

/// Cihazı App Attest ile doğrular.
///
/// Ücretsiz haklar cihaz kimliğine bağlı. Kimliği uygulama kendisi
/// gönderdiği için, uygulama anahtarını ele geçiren biri her istekte yeni
/// bir kimlik uydurabilirdi. App Attest ile Apple, kimliğin App Store'dan
/// gelen gerçek TryIt'e ve gerçek bir cihaza ait olduğunu imzalıyor;
/// sunucu ücretsiz hakkı ancak bundan sonra veriyor. Kurulum başına bir
/// kez çalışıyor.
enum DeviceAttest {
    /// Simülatörde ve Secure Enclave'i olmayan cihazda App Attest yok.
    static var isSupported: Bool { DCAppAttestService.shared.isSupported }

    static func run() async throws {
        let service = DCAppAttestService.shared
        guard service.isSupported else {
            throw APIError(message: String(localized: "Bu cihaz doğrulanamıyor."))
        }
        let device = DeviceIdentity.current
        let challenge = try await API.attestChallenge()
        // Sunucu imzalanan veriyi aynı şekilde kuruyor: soru ve cihaz kimliği.
        let clientData = Data("\(challenge):\(device)".utf8)
        let hash = Data(SHA256.hash(data: clientData))

        let keyId = try await service.generateKey()
        let attestation = try await service.attestKey(keyId, clientDataHash: hash)
        try await API.attest(keyId: keyId, attestation: attestation.base64EncodedString())
    }
}
