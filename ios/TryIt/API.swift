import Foundation

struct APIError: LocalizedError {
    /// Kullanıcıya gösterilecek, uygulamanın dilinde metin.
    let message: String
    /// Sunucunun makine için verdiği neden, örneğin "no-credits".
    var code: String? = nil
    var errorDescription: String? { message }

    /// Sunucudan gelen hata.
    ///
    /// Sunucunun metni Türkçe; kodu varsa metni uygulama kendi dilinde
    /// yazıyor. Kod yoksa sunucu metni yalnızca uygulama Türkçeyken
    /// gösteriliyor, başka dilde genel bir cümle çıkıyor.
    static func server(text: String, code: String?) -> APIError {
        if let code {
            return APIError(message: userMessage(for: code), code: code)
        }
        return APIError(message: Locale.appIsTurkish ? text : generic)
    }

    static var generic: String {
        String(localized: "Bir şeyler ters gitti. Tekrar dene.")
    }

    // Kodlar sunucudaki `code` alanıyla aynı.
    private static func userMessage(for code: String) -> String {
        switch code {
        case "no-key", "no-device", "attest-failed":
            return String(localized: "Uygulama doğrulanamadı. Uygulamayı güncelleyip tekrar dene.")
        case "rate-hour":
            return String(localized: "Çok fazla deneme yaptın. Bir saat sonra tekrar dene.")
        case "rate-day":
            return String(localized: "Bugünlük deneme sınırına ulaştın. Yarın tekrar dene.")
        case "global-day":
            return String(localized: "Bugün çok yoğunuz. Yarın tekrar dene.")
        case "bad-body", "bad-garment":
            return String(localized: "İstek eksik ya da hatalı gitti. Tekrar dene.")
        case "crash", "server-config":
            return String(localized: "Sunucuda bir sorun çıktı. Birazdan tekrar dene.")
        case "no-url":
            return String(localized: "Bir ürün linki yapıştır.")
        case "bad-url", "not-http":
            return String(localized: "Bu geçerli bir link değil.")
        case "private-host":
            return String(localized: "Bu adres açılamaz. Bir mağazanın ürün linkini dene.")
        case "not-product":
            return String(localized: "Bu link bir ürün sayfası değil.")
        case "page-blocked":
            return String(localized: "Bu mağaza şu an açılamadı. Birazdan tekrar dene.")
        case "no-data":
            return String(localized: "Ürün bilgileri okunamadı. Başka bir link dene.")
        case "no-garments":
            return String(localized: "Önce kombine bir parça ekle.")
        case "too-many":
            return String(localized: "Kombinde çok fazla parça var. Birini çıkarıp tekrar dene.")
        case "no-avatar":
            return String(localized: "Önce fotoğrafını ekle.")
        case "model-failed":
            return String(localized: "Kombin hazırlanamadı. Tekrar dene.")
        case "content-filtered":
            return String(localized: "Bu fotoğrafla bu kombin oluşturulamadı. Günlük kıyafetlerle çekilmiş bir fotoğraf dene ya da kombine bir alt parça da ekle.")
        case "no-image":
            return String(localized: "Kombin görseli oluşmadı. Tekrar dene.")
        case "no-credits":
            return String(localized: "Kombin hakkın bitti.")
        case "timeout":
            return String(localized: "İşlem çok uzun sürdü. Tekrar dene.")
        case "bad-file":
            return String(localized: "Fotoğraf okunamadı. Başka bir fotoğraf seç.")
        case "bad-type":
            return String(localized: "Bu fotoğraf biçimi desteklenmiyor. JPEG, PNG ya da WebP seç.")
        case "no-file":
            return String(localized: "Fotoğraf gönderilemedi. Tekrar dene.")
        case "too-large":
            return String(localized: "Fotoğraf çok büyük. 12 MB'tan küçük bir fotoğraf seç.")
        case "upload-failed":
            return String(localized: "Fotoğraf yüklenemedi. Tekrar dene.")
        default:
            return generic
        }
    }
}

/// Kalan kombin hakkı. Sayım sunucuda.
struct Credits: Codable, Equatable {
    /// "free", "monthly" ya da "yearly".
    let plan: String
    let remaining: Int
    let total: Int
    let resetsAt: String?
    /// Cihaz henüz App Attest ile doğrulanmadı.
    let needsAttestation: Bool?
    /// Jüri/demo modu, sunucu bayrağı. Açıkken paywall ve hak sayacı gizli.
    let unlimited: Bool?

    var isSubscribed: Bool { plan != "free" }
    var isUnlimited: Bool { unlimited == true }
}

/// Sunucuyla konuşan katman. Link çözme, yuva tahmini ve giydirme telefonda
/// değil sunucuda yapılıyor; böylece bir mağazanın sayfa yapısı değiştiğinde
/// düzeltme App Store incelemesi beklemeden yayına çıkabiliyor.
enum API {
    /// Yayındaki sunucu. Link çözme, giydirme ve avatar yükleme burada.
    private static let production = "https://tryit.lafdev.com"

    /// Sunucu adresi. Geliştirirken Mac'teki dev sunucusuna bağlanmak için
    /// şemadaki ortam değişkenine `TRYIT_API` verilir, örneğin
    /// `http://localhost:3100`. Verilmezse yayındaki sunucu kullanılıyor.
    static let baseURL: URL = {
        if let raw = ProcessInfo.processInfo.environment["TRYIT_API"],
           let url = URL(string: raw) {
            return url
        }
        return URL(string: production)!
    }()

    /// Uygulama anahtari. Gucu sinirli: uygulamayi acan biri bunu ikiliden
    /// cikarabilir. Amaci adresi tesadufen bulan tarayicilari ve merakli
    /// birini kesmek. Asil koruma sunucudaki cihaz basina ve gun basina
    /// kota. Info.plist'ten okunuyor, degistirmek icin kod derlemek gerekmesin.
    private static let appKey: String = {
        Bundle.main.object(forInfoDictionaryKey: "TryItAppKey") as? String ?? ""
    }()

    /// Her istege eklenen ortak basliklar.
    private static func stamp(_ request: inout URLRequest) {
        if !appKey.isEmpty {
            request.setValue(appKey, forHTTPHeaderField: "X-TryIt-Key")
        }
        request.setValue(DeviceIdentity.current, forHTTPHeaderField: "X-TryIt-Device")
    }

    private struct ErrorBody: Decodable {
        let error: String
        let code: String?
    }
    private struct AvatarBody: Decodable { let url: String }
    private struct ImageBody: Decodable { let imageUrl: String }

    /// Giydirme sonucu. `upscaleId` varsa görsel küçük sürüm; büyüğü
    /// `upscale(id:)` ile bekleniyor.
    struct TryOnResponse: Decodable {
        let imageUrl: String
        let upscaleId: String?
        /// Hak düştükten sonraki durum.
        let credits: Credits?
    }

    // MARK: - Uçlar

    static func resolve(link: String) async throws -> ResolvedProduct {
        let request = try jsonRequest(path: "api/resolve", body: ["url": link])
        return try await send(request, as: ResolvedProduct.self)
    }

    static func uploadAvatar(jpeg: Data) async throws -> String {
        let boundary = "tryit-\(UUID().uuidString)"
        var request = URLRequest(url: baseURL.appendingPathComponent("api/avatar"))
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)",
                         forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 120

        var body = Data()
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"avatar.jpg\"\r\n")
        body.append("Content-Type: image/jpeg\r\n\r\n")
        body.append(jpeg)
        body.append("\r\n--\(boundary)--\r\n")
        request.httpBody = body
        stamp(&request)

        return try await send(request, as: AvatarBody.self).url
    }

    static func tryOn(avatar: Avatar, items: [Item], entitlement: String?) async throws -> TryOnResponse {
        let garments: [[String: String]] = items.map { item in
            ["slot": item.slot.rawValue, "name": item.product.name, "image": item.image]
        }
        var body: [String: Any] = [
            "avatarUrl": avatar.url,
            "avatarWidth": avatar.width,
            "avatarHeight": avatar.height,
            "garments": garments,
        ]
        if let entitlement { body["entitlement"] = entitlement }
        let request = try jsonRequest(path: "api/tryon", body: body)
        return try await send(request, as: TryOnResponse.self)
    }

    private struct ChallengeBody: Decodable { let challenge: String }
    private struct OkBody: Decodable { let ok: Bool }

    static func attestChallenge() async throws -> String {
        var request = try jsonRequest(path: "api/attest/challenge", body: [:])
        request.timeoutInterval = 30
        return try await send(request, as: ChallengeBody.self).challenge
    }

    static func attest(keyId: String, attestation: String) async throws {
        var request = try jsonRequest(path: "api/attest", body: ["keyId": keyId, "attestation": attestation])
        request.timeoutInterval = 30
        _ = try await send(request, as: OkBody.self)
    }

    static func credits(entitlement: String?) async throws -> Credits {
        var body: [String: Any] = [:]
        if let entitlement { body["entitlement"] = entitlement }
        var request = try jsonRequest(path: "api/credits", body: body)
        request.timeoutInterval = 30
        return try await send(request, as: Credits.self)
    }

    /// Büyütülmüş görseli bekler. Sunucu hazır olunca yanıt veriyor,
    /// genelde 5-8 saniye.
    static func upscale(id: String) async throws -> String {
        var request = try jsonRequest(path: "api/upscale", body: ["id": id])
        request.timeoutInterval = 120
        return try await send(request, as: ImageBody.self).imageUrl
    }

    // MARK: - Ortak

    private static func jsonRequest(path: String, body: [String: Any]) throws -> URLRequest {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        // Giydirme yaklaşık 20 saniye sürüyor, varsayılan 60 saniye dar kalabilir.
        request.timeoutInterval = 300
        stamp(&request)
        return request
    }

    private static func send<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw APIError(message: String(localized: "Sunucuya ulaşılamadı. İnternet bağlantını kontrol et."))
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError(message: String(localized: "Sunucudan beklenmeyen bir yanıt geldi."))
        }
        guard (200..<300).contains(http.statusCode) else {
            if let body = try? JSONDecoder().decode(ErrorBody.self, from: data) {
                throw APIError.server(text: body.error, code: body.code)
            }
            throw APIError(message: String(localized: "Sunucu \(http.statusCode) döndü.", comment: "Sayı HTTP durum kodu"))
        }

        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError(message: String(localized: "Sunucu yanıtı okunamadı."))
        }
    }
}

private extension Data {
    mutating func append(_ string: String) {
        if let data = string.data(using: .utf8) { append(data) }
    }
}
