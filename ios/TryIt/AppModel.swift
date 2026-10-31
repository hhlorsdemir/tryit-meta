import Foundation
import SwiftUI

@MainActor
@Observable
final class AppModel {
    var avatar: Avatar?
    var items: [Slot: Item] = [:]
    var resultURL: String?
    var errorText: String?
    /// Hata değil, ama kullanıcının görmesi gereken bir şey oldu.
    var noticeText: String?

    var uploading = false
    var resolving = false
    /// Paylaşımdan gelen link çözülüyor, ekranda bekleme perdesi var.
    var preparing = false
    var generating = false
    var saving = false
    /// Ekrandaki sonuç kaydedildi mi. Aynı kombin iki kez kaydedilmesin diye.
    var resultSaved = false
    /// Ekrandaki kombinin cihazdaki kopyası.
    ///
    /// Sunucudaki adres zamanla geçersizleşiyor. Uygulama kapanıp
    /// açıldığında kombin hâlâ görünsün diye görseli diske de yazıyoruz;
    /// ekran bu kopyadan çiziliyor.
    var resultFile: String?
    /// Ekrandaki kombin, seçili parçalarla artık uyuşmuyor.
    ///
    /// Parça değişince görseli silmiyoruz. Üretmek para ve yarım dakika
    /// tutuyor; kullanıcı bir kartın fotoğrafına dokundu diye elindekini
    /// kaybetmemeli. Görsel duruyor, yalnızca "güncel değil" diye
    /// işaretleniyor ve kullanıcı isterse yeniden üretiyor.
    var resultStale = false

    /// Ekrandaki sonuç küçük sürüm, büyütülmüşü bekleniyor.
    var sharpening: Bool { sharpenToken != nil }
    /// Hangi beklemenin güncel olduğunu tutar. Eski bir bekleme geç
    /// biterse yenisinin işaretini silmesin diye kimlikli.
    private var sharpenToken: UUID?

    let store = OutfitStore()

    private let avatarKey = "tryit.avatar"

    private var documents: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    /// Kombinin cihazdaki kopyası.
    var resultLocalURL: URL? {
        guard let resultFile else { return nil }
        let path = documents.appendingPathComponent(resultFile)
        return FileManager.default.fileExists(atPath: path.path) ? path : nil
    }

    /// Büyüteçte açılacak kaynak. Yerel kopya varsa o, yoksa sunucudaki.
    var resultSource: ImageSource? {
        if let resultLocalURL { return .local(resultLocalURL) }
        if let resultURL { return .remote(resultURL) }
        return nil
    }

    /// Avatarın cihazdaki kopyası. Arayüz bunu kullanıyor, böylece ağ
    /// beklemeden çiziliyor ve sunucudaki adres bayatlasa bile fotoğraf
    /// ekranda kalıyor.
    var avatarLocalURL: URL? {
        guard let file = avatar?.file else { return nil }
        let path = documents.appendingPathComponent(file)
        return FileManager.default.fileExists(atPath: path.path) ? path : nil
    }

    init() {
        if let data = UserDefaults.standard.data(forKey: avatarKey),
           let saved = try? JSONDecoder().decode(Avatar.self, from: data) {
            avatar = saved
        }
        restoreSession()
        purchases.onChange = { [weak self] in await self?.refreshCredits() }
    }

    // MARK: - Haklar

    let purchases = Purchases()
    /// Kalan kombin hakkı. Sunucudan gelmeden nil; gösterge o sırada gizli.
    var credits: Credits?
    /// Abonelik ekranı açılsın.
    var wantsPaywall = false

    /// Açılışta bir kez: ürünler, abonelik durumu ve kalan hak.
    func startPurchases() async {
        await purchases.refreshEntitlement()
        await refreshCredits()
        await purchases.loadProducts()
    }

    func refreshCredits() async {
        guard let fresh = try? await API.credits(entitlement: purchases.entitlement) else { return }
        // Doğrulanmamış cihaz 0 ücretsiz hak görür; önce doğrulayıp
        // tekrar soruyoruz. Göstergede o arada yanlış "0" görünmesin diye
        // sonuç gelene kadar eski değer duruyor.
        if fresh.needsAttestation == true, !attesting, DeviceAttest.isSupported {
            attesting = true
            defer { attesting = false }
            if (try? await DeviceAttest.run()) != nil,
               let verified = try? await API.credits(entitlement: purchases.entitlement) {
                credits = verified
                return
            }
        }
        credits = fresh
    }

    /// Doğrulama sürüyor; açılış ve öne gelme aynı anda tetiklemesin.
    private var attesting = false

    /// Kombinle'ye basınca: hak yoksa üretmek yerine abonelik ekranı.
    ///
    /// Abone ise yereldeki sayıya güvenmiyoruz: satın almadan sonra hak
    /// tazelenemediyse gösterge eski "0" değerinde kalmış olabilir. Kararı
    /// sunucu veriyor, hak gerçekten yoksa 402 dönüyor.
    func generateOrAskToSubscribe() async {
        // Cihaz henüz doğrulanmadıysa "0 hak" gerçek değil: doğrulama
        // denendiği halde geçmediyse kararı sunucuya bırakıyoruz.
        if credits?.needsAttestation == true { await refreshCredits() }
        if purchases.entitlement == nil, let credits, credits.needsAttestation != true,
           !credits.isUnlimited, credits.remaining <= 0 {
            wantsPaywall = true
            return
        }
        await generate()
    }

    /// Kombindeki parçalar, üstten aşağı sabit sırada.
    var chosen: [Item] {
        Slot.allCases.compactMap { items[$0] }
    }

    /// Kombindeki parcalarin toplam tutari.
    var totalPrice: String? {
        Money.total(chosen.map { ($0.product.price, $0.product.currency) })
    }

    var canGenerate: Bool {
        avatar != nil && !chosen.isEmpty && !generating
    }


    // MARK: - Avatar

    /// Ham goruntu verisinden avatar kurar. Hem kameradan hem galeriden
    /// ayni yol kullaniliyor. Yeniden kodlayinca EXIF donukugu duzlesiyor,
    /// yani yuklenen gorselin olcusu burada hesapladigimizla ayni oluyor.
    func setAvatar(imageData: Data) async {
        guard let image = UIImage(data: imageData) else {
            errorText = String(localized: "Fotoğraf okunamadı.")
            return
        }
        await setAvatar(
            jpeg: image.jpegData(compressionQuality: 0.9) ?? imageData,
            width: Int(image.size.width * image.scale),
            height: Int(image.size.height * image.scale)
        )
    }

    func setAvatar(jpeg: Data, width: Int, height: Int) async {
        errorText = nil
        uploading = true
        defer { uploading = false }

        do {
            let url = try await API.uploadAvatar(jpeg: jpeg)
            // Her fotograf kendi dosya adiyla yaziliyor. Ad sabit kalinca
            // yeni fotograf diske gidiyor ama ekranda eskisi duruyordu:
            // gorunume verdigimiz adres degismedigi icin dosya yeniden
            // okunmuyor.
            let file = "avatar-\(UUID().uuidString).jpg"
            let previous = avatar?.file
            try? jpeg.write(to: documents.appendingPathComponent(file), options: .atomic)
            persist(Avatar(url: url, width: width, height: height, file: file))
            if let previous, previous != file {
                try? FileManager.default.removeItem(at: documents.appendingPathComponent(previous))
            }
            // Parcalar ve kombin duruyor, yalnizca bayat isaretleniyor.
            // Fotograf degistirmek secimleri bastan yapmayi gerektirmemeli.
            invalidateResult()
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func persist(_ next: Avatar) {
        avatar = next
        if let data = try? JSONEncoder().encode(next) {
            UserDefaults.standard.set(data, forKey: avatarKey)
        }
    }

    /// Yerel kopyayı sunucuya yeniden yükleyip adresi tazeler.
    private func refreshedAvatar() async -> Avatar? {
        guard let current = avatar,
              let file = current.file,
              let jpeg = try? Data(contentsOf: documents.appendingPathComponent(file)),
              let url = try? await API.uploadAvatar(jpeg: jpeg) else {
            return nil
        }
        let next = Avatar(url: url, width: current.width, height: current.height, file: file)
        persist(next)
        return next
    }

    // MARK: - Parçalar

    /// Paylaşımdan gelip kullanıcının kararını bekleyen linkler.
    ///
    /// Boş değilse arayüz soruyor: bunlar yeni bir kombin mi, yoksa
    /// ekrandakine ek mi. Ortada bir şey yokken soru sorulmuyor.
    var sharedPending: [String] = []
    /// Soru kutusu açık mı.
    ///
    /// Ayrı bir bayrak tutuyoruz. Kutunun açıklığını doğrudan listeye
    /// bağlamıştık; kutu kapanırken listeyi temizleyince düğmenin kendi
    /// işi sıra elde hiçbir link kalmıyordu.
    var askingShared = false

    /// Uygulama öne geldiğinde kuyruğa bakar.
    func checkSharedLinks() async {
        let links = SharedInbox.pending()
        guard !links.isEmpty else { return }

        // Kombin de parça da yoksa soracak bir şey yok, doğrudan ekliyoruz.
        if items.isEmpty && resultURL == nil {
            await accept(links, startingOver: false)
        } else {
            sharedPending = links
            askingShared = true
        }
    }

    /// Bekleyen linkleri kabul eder.
    func acceptShared(startingOver: Bool) async {
        let links = sharedPending
        sharedPending = []
        askingShared = false
        guard !links.isEmpty else { return }
        await accept(links, startingOver: startingOver)
    }

    /// Bekleyen linkleri atar.
    func dismissShared() {
        for link in sharedPending { SharedInbox.remove(link) }
        sharedPending = []
        askingShared = false
    }

    private func accept(_ links: [String], startingOver: Bool) async {
        if startingOver { startOver() }
        queue = links
        await drainQueue()
    }

    /// Çözülmeyi bekleyen paylaşım linkleri.
    ///
    /// Tek tek işleniyor: bir ürün yer değiştirme sorusu açarsa sıradaki
    /// linkler o cevaplanana kadar bekliyor, yoksa üst üste kutu açılırdı.
    private var queue: [String] = []

    private func drainQueue() async {
        while !queue.isEmpty {
            let link = queue.removeFirst()
            preparing = true
            await addLink(link)
            preparing = false
            // Denendikten sonra kuyruktan çıkıyor. Çözülemeyen linki
            // bırakırsak her açılışta aynı soruyu sorar dururuz.
            SharedInbox.remove(link)
            if pendingItem != nil { return }
        }
        preparing = false
    }

    func addLink(_ raw: String) async {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !resolving else { return }

        errorText = nil
        noticeText = nil
        resolving = true
        defer { resolving = false }

        do {
            let product = try await API.resolve(link: trimmed)
            guard let first = product.images.first else {
                errorText = String(localized: "Üründe kullanılabilir görsel yok.")
                return
            }
            add(Item(product: product, slot: product.slot, image: first))
        } catch {
            errorText = error.localizedDescription
        }
    }

    /// Ürünü kombine yerleştirir, yer yoksa kullanıcıya sorar.
    private func add(_ item: Item) {
        var item = item

        // Yuva tahminse ve orası doluysa boş bir yuvaya kaydırıyoruz.
        //
        // Sunucu ürünün ne olduğunu adından çıkaramadığında "üst" diyor.
        // Marka ve model adından ibaret isimlerde (mesela "Nike Court
        // Vision Low") bu sık oluyordu ve üçüncü ürün, ilk eklenen
        // tişörtün yerine geçip onu sessizce siliyordu. Boş yuvaya
        // koymak tahminden daha iyi bir tahmin: kombin kurarken insanlar
        // zaten farklı parçalar ekliyor.
        if !item.product.slotConfident, items[item.slot] != nil, let free = freeSlot() {
            item.slot = free
            noticeText = String(
                localized: "\(item.product.name) neresi anlaşılmadı, \(free.label) olarak eklendi. Yanlışsa parçaya dokunup düzeltebilirsin.",
                comment: "İlki ürün adı, ikincisi yuva adı (Üst, Alt, Ayakkabı)"
            )
        }

        // Gidecegi yuva doluysa karar kullanicinin: hangi parcanin yerine
        // gececegini o secsin. Sessizce ustune yazmak, kullanicinin
        // eklediği bir parçayı haberi olmadan siliyordu.
        if items[item.slot] != nil {
            pendingItem = item
            askingReplace = true
            return
        }

        put(item)
    }

    /// Yerleştirmeyi yapar. Tek parça ile üst ve alt aynı anda duramaz.
    private func put(_ item: Item) {
        if item.slot == .full {
            items[.top] = nil
            items[.bottom] = nil
        } else if item.slot == .top || item.slot == .bottom {
            items[.full] = nil
        }
        items[item.slot] = item
        invalidateResult()
    }

    /// Doldurulabilecek ilk boş yuva.
    private func freeSlot() -> Slot? {
        if items[.full] != nil {
            return items[.shoes] == nil ? .shoes : nil
        }
        return [Slot.top, .bottom, .shoes].first { items[$0] == nil }
    }

    // MARK: - Yer degistirme sorusu

    /// Yerleşecek yer bulamamış, kullanıcının kararını bekleyen ürün.
    var pendingItem: Item?
    /// Soru kutusu açık mı.
    var askingReplace = false

    /// Bekleyen ürünü seçilen parçanın yerine koyar.
    ///
    /// Seçilen yuva, ürünün sunucudan gelen yuvasından farklı olabilir.
    /// Bu bir hata değil, düzeltme: sunucu yanlış sınıflandırdıysa
    /// kullanıcı burada doğrusunu söylemiş oluyor.
    func replace(with slot: Slot) async {
        guard var item = pendingItem else { return }
        pendingItem = nil
        askingReplace = false

        items[slot] = nil
        item.slot = slot
        put(item)

        await drainQueue()
    }

    /// Bekleyen ürünü atar.
    func cancelReplace() async {
        pendingItem = nil
        askingReplace = false
        await drainQueue()
    }

    func move(from: Slot, to: Slot) {
        guard from != to, var item = items[from] else { return }
        items[from] = nil
        item.slot = to
        add(item)
    }

    func pickImage(slot: Slot, image: String) {
        // Seçili fotoğrafa yeniden dokunmak bir değişiklik değil. Kontrol
        // olmayınca kombin boşuna geçersizleşiyordu.
        guard var item = items[slot], item.image != image else { return }
        item.image = image
        items[slot] = item
        invalidateResult()
    }

    func remove(slot: Slot) {
        guard items[slot] != nil else { return }
        items[slot] = nil
        invalidateResult()
    }

    /// Kombinlerim sekmesinin calisma ekranina gecme istegi.
    ///
    /// Kaydedilmis bir kombin geri yuklendiginde kullaniciyi elinin
    /// altindaki ekrana goturmek gerekiyor; RootView bunu izliyor.
    var wantsTryOnTab = false

    /// Onboarding'in son düğmesi fotoğraf seçimini açmak istiyor.
    var wantsPhotoPicker = false

    /// Kaydedilmis bir kombini calisma ekranina geri koyar.
    ///
    /// Urunleri sunucuya yeniden sormuyoruz: kayitta giydirme icin gereken
    /// her sey duruyor (yuva, gorsel, ad, fiyat) ve aninda donmek, bir
    /// seyi degistirmek isteyen kisiyi bekletmekten iyi. Eksik kalan tek
    /// sey urunun diger fotograflari; referans kareyi degistirmek isteyen
    /// linki yeniden ekleyebilir.
    func loadOutfit(_ outfit: SavedOutfit, startingOver: Bool) {
        if startingOver { startOver() }

        for saved in outfit.items {
            let product = ResolvedProduct(
                url: saved.productURL,
                name: saved.name,
                brand: nil,
                price: saved.price,
                currency: saved.currency,
                images: [saved.imageURL],
                slot: saved.slot,
                // Yuva kaydedilirken dogrulanmisti, tahmin degil.
                slotConfident: true
            )
            add(Item(product: product, slot: saved.slot, image: saved.imageURL))
        }

        wantsTryOnTab = true
    }

    /// Parçaları ve sonucu temizler, avatarı bırakır. Aynı kişiyle arka
    /// arkaya kombin denemenin yolu bu.
    func startOver() {
        items = [:]
        clearResult()
        errorText = nil
        noticeText = nil
        pendingItem = nil
        askingReplace = false
    }

    // MARK: - Oturum

    /// Uygulama kapanınca kaybolmaması gereken çalışma durumu.
    ///
    /// Avatar ayrı tutuluyor; burası kombinin kendisi ve o anda seçili
    /// parçalar. Kullanıcı uygulamadan çıkıp döndüğünde kaldığı yerden
    /// devam edebilmeli, ürettiği görseli yeniden üretmek zorunda kalmamalı.
    private struct Session: Codable {
        var items: [Item]
        var resultURL: String?
        var resultFile: String?
        var resultStale: Bool
        var resultSaved: Bool
    }

    private var sessionURL: URL {
        documents.appendingPathComponent("session.json")
    }

    private func persistSession() {
        let session = Session(
            items: Array(items.values),
            resultURL: resultURL,
            resultFile: resultFile,
            resultStale: resultStale,
            resultSaved: resultSaved
        )
        guard let data = try? JSONEncoder().encode(session) else { return }
        try? data.write(to: sessionURL, options: .atomic)
    }

    private func restoreSession() {
        guard let data = try? Data(contentsOf: sessionURL),
              let session = try? JSONDecoder().decode(Session.self, from: data) else {
            return
        }

        items = Dictionary(uniqueKeysWithValues: session.items.map { ($0.slot, $0) })
        resultURL = session.resultURL
        resultFile = session.resultFile
        resultStale = session.resultStale
        resultSaved = session.resultSaved

        // Yerel kopya silinmişse ve elde yalnızca bayat bir adres kaldıysa
        // kırık görsel göstermektense sonucu düşürüyoruz.
        if resultFile != nil && resultLocalURL == nil {
            resultFile = nil
        }
    }

    private func clearResult() {
        if let resultFile {
            try? FileManager.default.removeItem(at: documents.appendingPathComponent(resultFile))
        }
        resultURL = nil
        resultFile = nil
        resultSaved = false
        resultStale = false
        sharpenToken = nil
        persistSession()
    }

    /// Sonucu ekranda bırakır, yalnızca bayatladığını işaretler.
    private func invalidateResult() {
        if resultURL != nil { resultStale = true }
        persistSession()
    }

    // MARK: - Kombin

    func generate() async {
        guard let avatar, !chosen.isEmpty, !generating else { return }

        errorText = nil
        generating = true
        // Ekrandaki sonuç yeni sonuç gelene kadar duruyor. Önceden
        // silseydik, hak bittiğinde ya da üretim bozulduğunda kullanıcı
        // elindeki kombini boşuna kaybederdi.
        defer { generating = false }

        let entitlement = purchases.entitlement
        do {
            await accept(try await API.tryOn(avatar: avatar, items: chosen, entitlement: entitlement))
        } catch let error as APIError where error.code == "no-credits" {
            await outOfCredits()
        } catch {
            // Yüklenmiş avatarın adresi zamanla geçersizleşebiliyor; o zaman
            // model görseli alamıyor ve sunucu "model-failed" diyor. Yalnızca
            // bu durumda yerel kopyadan yeniden yükleyip bir kez daha
            // deniyoruz. Bağlantı koptuysa denemiyoruz: sunucu üretmiş ve
            // hakkı düşmüş olabilir, ikinci deneme ikinci bir hak yakardı.
            guard (error as? APIError)?.code == "model-failed",
                  let refreshed = await refreshedAvatar() else {
                errorText = error.localizedDescription
                return
            }
            do {
                await accept(try await API.tryOn(avatar: refreshed, items: chosen, entitlement: entitlement))
            } catch let error as APIError where error.code == "no-credits" {
                await outOfCredits()
            } catch {
                errorText = error.localizedDescription
            }
        }
    }

    /// Sunucu hak kalmadı dedi: göstergeyi düzeltip abonelik ekranını aç.
    private func outOfCredits() async {
        await refreshCredits()
        // Sunucu sınırsız modda 402 dönmez; yine de paywall açılmasın.
        if credits?.isUnlimited == true { return }
        wantsPaywall = true
    }

    /// Sonucu ekrana alır. Görsel küçük sürümse büyüğünü arka planda bekler.
    private func accept(_ response: API.TryOnResponse) async {
        if let credits = response.credits { self.credits = credits }
        await adopt(response.imageUrl)
        guard let id = response.upscaleId else { return }
        let small = response.imageUrl
        let token = UUID()
        sharpenToken = token
        Task {
            await sharpen(small: small, upscaleId: id)
            if sharpenToken == token { sharpenToken = nil }
        }
    }

    /// Küçük görseli, büyütülmüşü gelince onunla değiştirir.
    ///
    /// Bu arada kullanıcı yeni bir kombin üretmiş ya da sonucu silmiş
    /// olabilir; o zaman gelen görsel artık ekrandakine ait değil, atılıyor.
    /// Büyütme başarısız olursa küçük görsel kalıyor, hata gösterilmiyor:
    /// kullanıcının elinde zaten bir sonuç var.
    private func sharpen(small: String, upscaleId: String) async {
        guard let large = try? await API.upscale(id: upscaleId),
              let remote = URL(string: large),
              let (data, _) = try? await URLSession.shared.data(from: remote),
              resultURL == small else { return }

        let file = "result-\(UUID().uuidString).jpg"
        guard (try? data.write(to: documents.appendingPathComponent(file), options: .atomic)) != nil else { return }
        if let old = resultFile {
            try? FileManager.default.removeItem(at: documents.appendingPathComponent(old))
        }
        resultURL = large
        resultFile = file
        persistSession()
    }

    /// Yeni kombini benimser: adresi tutar, görseli diske kopyalar.
    ///
    /// İndirme başarısız olursa yalnızca adres kalıyor; kombin bu oturumda
    /// görünür ama uygulama kapanınca kaybolur. Üretimi boşa çıkarmaktansa
    /// bu kabul edilebilir.
    private func adopt(_ url: String) async {
        // Önce indiriyoruz, sonra adres ve dosya birlikte değişiyor. Önceki
        // kombinin dosyası ancak yenisi yerine geçince siliniyor.
        var file: String?
        if let remote = URL(string: url),
           let (data, _) = try? await URLSession.shared.data(from: remote) {
            let name = "result-\(UUID().uuidString).jpg"
            if (try? data.write(to: documents.appendingPathComponent(name), options: .atomic)) != nil {
                file = name
            }
        }

        if let old = resultFile {
            try? FileManager.default.removeItem(at: documents.appendingPathComponent(old))
        }
        resultFile = file
        resultURL = url
        resultStale = false
        resultSaved = false
        persistSession()
    }

    func saveResult() async {
        guard resultURL != nil, !resultSaved, !saving else { return }

        errorText = nil
        saving = true
        defer { saving = false }

        // Büyük görsel geliyorsa onu kaydediyoruz; Kombinlerim'e ve oradan
        // paylaşıma bulanık sürüm gitmesin. Bekleme en geç sunucunun
        // zaman aşımında bitiyor.
        while sharpening {
            try? await Task.sleep(for: .milliseconds(200))
        }
        // Beklerken kullanıcı sonucu silmiş olabilir.
        guard let resultURL else { return }

        do {
            // Yerel kopya varsa oradan kaydediyoruz; sunucudaki adres
            // bayatlamış olabilir ve kullanıcı elindekini kaybetmemeli.
            try await store.save(resultURL: resultURL, localImage: resultLocalURL, items: chosen)
            resultSaved = true
            persistSession()
        } catch {
            errorText = error.localizedDescription
        }
    }
}
