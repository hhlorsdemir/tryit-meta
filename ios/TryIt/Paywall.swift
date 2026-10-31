import StoreKit
import SwiftUI

/// Abonelik ekranı.
///
/// Fiyatlar ve indirim oranı elle yazılmıyor, StoreKit'ten okunuyor. Apple
/// her ülkede fiyatı kendi basamağına yuvarlıyor: ABD'de yıllık plan yüzde
/// 25 avantajlıyken Türkiye'de ₺2.499,99 ile ₺249,99 arasındaki fark yüzde
/// 17'ye düşüyor. Sabit bir "%25" yazsaydık Türkiye'de yanlış olurdu.
struct PaywallView: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var selected: String = Purchases.yearlyID
    @State private var busy = false
    @State private var message: String?
    @State private var managing = false

    private var purchases: Purchases { model.purchases }

    /// Abone mi. Apple'ın işlem kaydı da sayılıyor: satın almadan sonra
    /// sunucudan hak tazelenemese bile aboneye planları yeniden satmayalım.
    private var subscribed: Bool {
        model.credits?.isSubscribed == true || purchases.entitlement != nil
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                topBar
                hero
                Text("Her kombini önce üstünde gör")
                    .font(Typo.headlineLg(26))
                    .foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                benefits

                if subscribed {
                    activeCard
                } else {
                    plans
                    // Kullanıcının neye para verdiği: rakiplerin çoğu parça
                    // başına hak düşüyor, bizde üç parça tek hak.
                    Text("1 kombin = üst, alt ve ayakkabı birlikte, tek hak. Haklar her ay yenilenir.")
                        .font(Typo.bodySm)
                        .foregroundStyle(Palette.inkSoft)
                        .fixedSize(horizontal: false, vertical: true)
                    if let message {
                        Text(message)
                            .font(Typo.bodySm)
                            .foregroundStyle(Palette.errorInk)
                    }
                    Button {
                        Task { await buy() }
                    } label: {
                        if busy {
                            ProgressView().tint(Palette.white)
                        } else {
                            // Genel "Devam Et" yerine sonucu söyleyen metin.
                            Text(trUpper(String(localized: "Kombinlemeye Başla", comment: "Abonelik satın alma düğmesi: kombin (outfit) oluşturmaya başla")))
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy || product(selected) == nil)

                    // Abonelik kaygısını en çok azaltan cümle; yasal metnin
                    // içinde kaybolmasın diye düğmenin hemen altında, tek başına.
                    Label("İstediğin zaman iptal et", systemImage: "checkmark.circle")
                        .font(Typo.labelMd)
                        .foregroundStyle(Palette.inkSoft)
                        .frame(maxWidth: .infinity)

                    Text(renewalNote)
                        .font(Typo.bodySm)
                        .foregroundStyle(Palette.inkFaint)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }

                footer
            }
            .padding(.horizontal, 22)
            .padding(.top, SafeArea.top + 6)
            .padding(.bottom, SafeArea.bottom + 16)
        }
        .ignoresSafeArea()
        .background(Palette.canvas.ignoresSafeArea())
        .manageSubscriptionsSheet(isPresented: $managing)
        .task {
            if !purchases.loaded || purchases.monthly == nil || purchases.yearly == nil {
                await purchases.loadProducts()
            }
        }
    }

    // MARK: - Parçalar

    private var topBar: some View {
        HStack {
            Text(statusText)
                .font(Typo.labelMd)
                .foregroundStyle(Palette.inkSoft)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 12)
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Palette.inkSoft)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(Palette.surface))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Kapat")
        }
    }

    /// Ekranın neden açıldığını söylüyor. Ücretsiz haklar bittiyse bunu bir
    /// eksiklik gibi değil, tamamlanmış bir adım gibi anlatıyor.
    private var statusText: String {
        guard let credits = model.credits else { return "" }
        if credits.isSubscribed {
            return String(localized: "Bu ay \(credits.remaining) kombin kaldı", comment: "Kalan kombin (outfit) hakkı")
        }
        if credits.remaining == 0 {
            return credits.total > 0
                ? String(localized: "\(credits.total) ücretsiz kombinini kullandın. Devam etmek için bir plan seç.")
                : String(localized: "Devam etmek için bir plan seç.")
        }
        return String(localized: "Ücretsiz: \(credits.remaining) kombin kaldı", comment: "Kalan ücretsiz kombin (outfit) hakkı")
    }

    /// Önce ve sonra. Kullanıcının kendi fotoğrafı ve bir kombini varsa
    /// onlar gösteriliyor: ekran bir reklam değil, kendi sonucunun devamı
    /// gibi duruyor. Yoksa onboarding'deki örnek.
    @ViewBuilder
    private var hero: some View {
        HStack(spacing: 10) {
            if let own = personal {
                heroImage(Image(uiImage: own.before), label: String(localized: "Sen", comment: "Rozet: kullanıcının kendi fotoğrafı"), highlighted: false)
                arrow
                heroImage(Image(uiImage: own.after), label: String(localized: "Senin kombinin"), highlighted: true)
            } else {
                heroImage(Image("OnboardingBefore"), label: String(localized: "Önce", comment: "Rozet: önce ve sonra görsellerinden önceki"), highlighted: false)
                arrow
                heroImage(Image("OnboardingAfter"), label: String(localized: "Kombinle", comment: "Düğme, fiil: seçili parçaları avatara giydirip kombin (outfit) oluştur"), highlighted: true)
            }
        }
    }

    private var arrow: some View {
        Image(systemName: "arrow.forward")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(Palette.gold)
    }

    /// Avatar ve ekrandaki sonuç; ekranda sonuç yoksa en son kaydedilen kombin.
    private var personal: (before: UIImage, after: UIImage)? {
        guard let avatarURL = model.avatarLocalURL,
              let before = UIImage(contentsOfFile: avatarURL.path) else { return nil }
        let latest = model.store.outfits.max { $0.createdAt < $1.createdAt }
        let afterURL = model.resultLocalURL ?? latest.map { model.store.imageURL(for: $0) }
        guard let afterURL, let after = UIImage(contentsOfFile: afterURL.path) else { return nil }
        return (before, after)
    }

    /// Görseller kendi oranında (2:3) duruyor. Sabit yükseklikli bir kutuya
    /// doldurulunca baş ve ayaklar kesiliyordu; kombin baştan ayağa
    /// görünmeli.
    private func heroImage(_ image: Image, label: String, highlighted: Bool) -> some View {
        AspectFrame(ratio: 2.0 / 3.0) {
            image.resizable().scaledToFill()
        }
            .frame(maxWidth: .infinity)
            .overlay {
                RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                    .strokeBorder(highlighted ? Palette.gold : .clear, lineWidth: 2)
            }
            .overlay(alignment: .bottomLeading) {
                GoldBadge(text: label).padding(8)
            }
    }

    private var benefits: some View {
        VStack(alignment: .leading, spacing: 11) {
            // Özellik değil sonuç. Beden ya da kalıp vaadi yok, çünkü
            // uygulama bunu ölçmüyor.
            benefit("eye", String(localized: "Almadan önce üstünde nasıl durduğunu gör"))
            benefit("shippingbox", String(localized: "İade kargosuyla daha az uğraş"))
            benefit("storefront", String(localized: "Farklı mağazalardan parçaları tek kombinde dene"))
            benefit("hanger", String(localized: "Her ay 30 kombin"))
        }
    }

    private func benefit(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Palette.gold)
                .frame(width: 22)
            Text(text)
                .font(Typo.bodyMd)
                .foregroundStyle(Palette.ink)
        }
    }

    /// Mağaza bazen ürünlerden yalnızca birini döndürüyor (yeni eklenen ürün
    /// henüz yayılmamış olabiliyor). O zaman gelen gösteriliyor, diğeri
    /// beklenmiyor.
    @ViewBuilder
    private var plans: some View {
        if purchases.yearly != nil || purchases.monthly != nil {
            VStack(spacing: 10) {
                if let yearly = purchases.yearly {
                    planCard(
                        yearly,
                        title: String(localized: "Yıllık", comment: "Abonelik planı"),
                        detail: String(localized: "Ayda \(perMonth(yearly)) · her ay 30 kombin", comment: "Yıllık planın aylık karşılığı"),
                        badge: purchases.monthly
                            .flatMap { saving(yearly: yearly, monthly: $0) }
                            .map { String(localized: "\(percent($0)) avantajlı", comment: "Rozet: yıllık plan aylığa göre bu oranda ucuz") }
                    )
                }
                if let monthly = purchases.monthly {
                    planCard(
                        monthly,
                        title: String(localized: "Aylık", comment: "Abonelik planı"),
                        detail: String(localized: "Her ay 30 kombin"),
                        badge: nil
                    )
                }
            }
            .onAppear {
                // Seçili plan gelmediyse gelen plana geç.
                if product(selected) == nil {
                    selected = purchases.yearly?.id ?? purchases.monthly?.id ?? selected
                }
            }
        } else if purchases.loadFailed {
            VStack(spacing: 10) {
                Text("Abonelik seçenekleri yüklenemedi.")
                    .font(Typo.bodyMd)
                    .foregroundStyle(Palette.inkSoft)
                Button(trUpper(String(localized: "Tekrar Dene"))) {
                    Task { await purchases.loadProducts() }
                }
                .buttonStyle(SecondaryButtonStyle())
            }
            .frame(maxWidth: .infinity)
        } else {
            ProgressView().frame(maxWidth: .infinity, minHeight: 120)
        }
    }

    private func planCard(_ product: Product, title: String, detail: String, badge: String?) -> some View {
        let active = selected == product.id
        return Button {
            selected = product.id
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(title)
                        .font(Typo.headlineSm(16))
                    Spacer()
                    Text(product.displayPrice)
                        .font(Typo.headlineSm(16))
                }
                .foregroundStyle(Palette.ink)
                Text(detail)
                    .font(Typo.bodySm)
                    .foregroundStyle(Palette.inkSoft)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(active ? Palette.white : Palette.canvas)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(active ? Palette.gold : Palette.line, lineWidth: active ? 2 : 1)
            }
            .overlay(alignment: .topTrailing) {
                if let badge {
                    GoldBadge(text: badge).offset(x: -12, y: -10)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    private var activeCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Aboneliğin etkin", systemImage: "checkmark.seal")
                .font(Typo.headlineSm(16))
                .foregroundStyle(Palette.ink)
            if let credits = model.credits {
                Text(activeDetail(credits))
                    .font(Typo.bodyMd)
                    .foregroundStyle(Palette.inkSoft)
            }
            Button(trUpper(String(localized: "Aboneliği Yönet"))) { managing = true }
                .buttonStyle(SecondaryButtonStyle())
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.white))
    }

    private func activeDetail(_ credits: Credits) -> String {
        guard let raw = credits.resetsAt,
              let date = ISO8601DateFormatter.withFraction.date(from: raw) else {
            return String(localized: "Bu dönem \(credits.remaining) / \(credits.total) kombin hakkın var.")
        }
        let day = date.formatted(.dateTime.day().month(.wide).locale(.app))
        return String(
            localized: "Bu dönem \(credits.remaining) / \(credits.total) kombin hakkın var. \(day) tarihinde yenilenir.",
            comment: "Kalan hak, toplam hak ve yenilenme tarihi (gün ve ay, örneğin 12 Ekim)"
        )
    }

    /// Apple abonelik ekranında fiyatın, dönemin ve otomatik yenilemenin
    /// açıkça yazmasını istiyor.
    private var renewalNote: String {
        guard let product = product(selected) else { return String(localized: "İstediğin zaman iptal et") }
        let price = product.displayPrice
        // Apple'ın ayar yolunu her dil kendi menü adlarıyla yazsın diye
        // cümle bölünmüyor.
        return product.id == Purchases.yearlyID
            ? String(
                localized: "\(price) / yıl. İptal edilmezse dönem sonunda otomatik yenilenir. İptal için Ayarlar > Apple Hesabı > Abonelikler.",
                comment: "Yıllık abonelik fiyatı ve yenileme notu"
            )
            : String(
                localized: "\(price) / ay. İptal edilmezse dönem sonunda otomatik yenilenir. İptal için Ayarlar > Apple Hesabı > Abonelikler.",
                comment: "Aylık abonelik fiyatı ve yenileme notu"
            )
    }

    private var footer: some View {
        HStack(spacing: 6) {
            Button("Satın alımları geri yükle") { Task { await restore() } }
                .disabled(busy)
            Text(verbatim: "·")
            Link("Koşullar", destination: URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!)
            Text(verbatim: "·")
            Link("Gizlilik", destination: URL(string: "https://tryit.lafdev.com/gizlilik")!)
        }
        .font(Typo.bodySm)
        .foregroundStyle(Palette.inkFaint)
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
    }

    // MARK: - Hesap

    private func product(_ id: String) -> Product? {
        id == Purchases.yearlyID ? purchases.yearly : purchases.monthly
    }

    /// Yüzde, dilin yazımıyla: Türkçede "%17", İngilizcede "17%".
    private func percent(_ value: Int) -> String {
        (Double(value) / 100).formatted(.percent.locale(.app))
    }

    private func perMonth(_ yearly: Product) -> String {
        (yearly.price / 12).formatted(yearly.priceFormatStyle)
    }

    /// Yıllık planın aylığa göre yüzde kaç avantajlı olduğu, o ülkenin
    /// gerçek fiyatlarıyla. Anlamlı bir fark yoksa rozet çıkmıyor.
    private func saving(yearly: Product, monthly: Product) -> Int? {
        let full = monthly.price * 12
        guard full > 0 else { return nil }
        let ratio = NSDecimalNumber(decimal: 1 - yearly.price / full).doubleValue
        let percent = Int((ratio * 100).rounded())
        return percent >= 5 ? percent : nil
    }

    // MARK: - İşlemler

    private func buy() async {
        guard let product = product(selected) else { return }
        busy = true
        message = nil
        defer { busy = false }
        do {
            switch try await purchases.purchase(product) {
            case .purchased:
                await model.refreshCredits()
                dismiss()
            case .pending:
                message = String(localized: "Satın alma onay bekliyor. Onaylanınca hakların açılır.")
            case .cancelled:
                break
            }
        } catch {
            message = String(localized: "Satın alma tamamlanamadı. Tekrar dene.")
        }
    }

    private func restore() async {
        busy = true
        message = nil
        defer { busy = false }
        do {
            try await purchases.restore()
            await model.refreshCredits()
            if subscribed {
                dismiss()
            } else {
                message = String(localized: "Bu Apple hesabında etkin bir abonelik bulunamadı.")
            }
        } catch {
            message = String(localized: "Geri yükleme tamamlanamadı. Tekrar dene.")
        }
    }
}

extension ISO8601DateFormatter {
    /// Sunucunun `toISOString()` çıktısı milisaniyeli geliyor.
    static let withFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
