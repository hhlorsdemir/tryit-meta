import SwiftUI

/// İlk açılıştaki üç sayfa.
///
/// Düz metin yok: her sayfanın üst yarısı uygulamanın kendi parçalarından
/// kurulmuş küçük bir sahne ve sahne kendini oynatıyor. Sayfa her
/// görünüşte baştan başlıyor; "Hareketi azalt" açıksa sahneler son
/// hallerinde duruyor.
///
/// Görseller üretilmiş bir modele ait, gerçek bir kişi değil. "Sonra"
/// görseli uygulamanın gerçek giydirme hattından geçti; yani burada
/// gösterdiğimiz sonuç ürünün gerçekten verdiği sonuç.
struct OnboardingView: View {
    /// Kullanıcının zaten bir avatarı var mı. Varsa son düğme fotoğraf
    /// istemiyor, doğrudan uygulamaya geçiyor.
    let hasAvatar: Bool
    /// Bitince çağrılıyor. `true` gelirse fotoğraf seçimi açılmalı.
    let onFinish: (_ wantsPhoto: Bool) -> Void

    @State private var page = Shot.int("-shotPage") ?? 0

    var body: some View {
        ZStack {
            Palette.canvas.ignoresSafeArea()

            VStack(spacing: 0) {
                topBar

                TabView(selection: $page) {
                    OnboardingPage(
                        title: "Almadan önce üzerinde gör",
                        text: "Beğendiğin kıyafetin linkini ver, TryIt onu senin fotoğrafına giydirsin."
                    ) {
                        TryOnScene(active: page == 0)
                    }
                    .tag(0)

                    OnboardingPage(
                        title: "Tek parça değil, kombinin tamamı",
                        text: "Üste bir bluz, alta bir etek, ayağa bir ayakkabı. Farklı mağazalardan olsa bile üçünü birlikte gör."
                    ) {
                        OutfitScene(active: page == 1)
                    }
                    .tag(1)

                    OnboardingPage(
                        title: "Alışverişin ortasında paylaş",
                        text: "Ürün sayfasında Paylaş'a bas, TryIt'i seç. Uygulamayı açtığında parça hazır bekler.",
                        hint: "TryIt listede yoksa menüyü sona kaydırıp Daha Fazla'dan aç."
                    ) {
                        ShareScene(active: page == 2)
                    }
                    .tag(2)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))

                bottomBar
            }
        }
        .preferredColorScheme(.light)
    }

    // MARK: - Üst ve alt şerit

    private var topBar: some View {
        HStack {
            Spacer()
            // Son sayfada "Geç" yok: orada zaten iki çıkış var.
            if page < 2 {
                Button { onFinish(false) } label: {
                    Text(trUpper(String(localized: "Geç", comment: "Düğme: tanıtımı atla")))
                        .font(Typo.labelMd)
                        .kerning(1.2)
                        .foregroundStyle(Palette.inkFaint)
                        .padding(.vertical, 10)
                        .padding(.horizontal, 4)
                }
                .buttonStyle(.plain)
                .transition(.opacity)
            }
        }
        .frame(height: 44)
        .padding(.horizontal, 20)
        .animation(.easeOut(duration: 0.2), value: page)
    }

    private var bottomBar: some View {
        VStack(spacing: 14) {
            PageDots(count: 3, current: page)

            if page < 2 {
                Button(trUpper(String(localized: "Devam", comment: "Düğme: sonraki sayfa"))) {
                    withAnimation(.easeInOut(duration: 0.35)) { page += 1 }
                }
                .buttonStyle(PrimaryButtonStyle())
            } else if hasAvatar {
                Button(trUpper(String(localized: "Başla", comment: "Düğme: uygulamaya başla"))) { onFinish(false) }
                    .buttonStyle(PrimaryButtonStyle())
            } else {
                Button {
                    onFinish(true)
                } label: {
                    Label(trUpper(String(localized: "Fotoğrafını ekle")), systemImage: "camera")
                        .labelStyle(.titleAndIcon)
                }
                .buttonStyle(PrimaryButtonStyle())
            }

            // Düğmenin altındaki alan her sayfada aynı yükseklikte kalsın,
            // yoksa son sayfaya gelince her şey yukarı zıplıyor.
            Button { onFinish(false) } label: {
                Text("Önce göz at")
                    .font(Typo.bodyMd)
                    .foregroundStyle(Palette.inkSoft)
                    .frame(maxWidth: .infinity, minHeight: 28)
            }
            .buttonStyle(.plain)
            .opacity(page == 2 && !hasAvatar ? 1 : 0)
            .disabled(!(page == 2 && !hasAvatar))
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 8)
    }
}

// MARK: - Sayfa iskeleti

private struct OnboardingPage<Scene: View>: View {
    let title: LocalizedStringKey
    let text: LocalizedStringKey
    var hint: LocalizedStringKey?
    @ViewBuilder var scene: Scene

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            scene
                .frame(maxWidth: .infinity)
                .frame(maxHeight: .infinity)

            VStack(alignment: .leading, spacing: 10) {
                Text(title)
                    .font(Typo.headlineLg(26))
                    .foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(text)
                    .font(Typo.bodyLg)
                    .foregroundStyle(Palette.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
                if let hint {
                    Text(hint)
                        .font(Typo.bodySm)
                        .foregroundStyle(Palette.inkFaint)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 2)
                }
            }
            .padding(.top, 24)
            .padding(.bottom, 12)
        }
        .padding(.horizontal, 20)
    }
}

private struct PageDots: View {
    let count: Int
    let current: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<count, id: \.self) { index in
                Capsule()
                    .fill(index == current ? Palette.ink : Palette.line)
                    .frame(width: index == current ? 20 : 6, height: 6)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: current)
        .accessibilityElement()
        .accessibilityLabel("Sayfa \(current + 1) / \(count)")
    }
}

// MARK: - Örnek ürünler

/// Sahnelerdeki örnek ürünler. Ad ve fiyat da çeviriye giriyor: her dil
/// kendi mağazalarına benzeyen bir ad ve para birimi yazabilsin.
private enum Sample {
    static var shirt: String { String(localized: "Saten bluz", comment: "Tanıtımdaki örnek ürün adı") }
    static var skirt: String { String(localized: "Pileli midi etek", comment: "Tanıtımdaki örnek ürün adı") }
    static var shoes: String { String(localized: "Deri loafer", comment: "Tanıtımdaki örnek ürün adı") }

    static var shirtPrice: String { String(localized: "₺1.499", comment: "Örnek fiyat: yerel para birimi ve yazımıyla uydurma bir fiyat") }
    static var skirtPrice: String { String(localized: "₺1.299", comment: "Örnek fiyat: yerel para birimi ve yazımıyla uydurma bir fiyat") }
    static var shoesPrice: String { String(localized: "₺2.499", comment: "Örnek fiyat: yerel para birimi ve yazımıyla uydurma bir fiyat") }
    static var total: String { String(localized: "₺5.297", comment: "Örnek fiyat: üç örnek fiyatın toplamı") }
}

// MARK: - Sahne oynatıcı

/// Sahneleri döngüde oynatmanın ortak kısmı.
///
/// Sayfa görünür olunca döngü başlıyor, kaydırıp gidince görev iptal
/// ediliyor ve sahne başa sarıyor. Bekleme iptal edilince `false`
/// dönüyor, döngü de orada bırakıyor.
private func pause(_ milliseconds: Int) async -> Bool {
    do {
        try await Task.sleep(for: .milliseconds(milliseconds))
        return true
    } catch {
        return false
    }
}

// MARK: - 1. Üzerinde gör

private struct TryOnScene: View {
    let active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var cardsIn = 0
    @State private var absorbed = false
    @State private var working = false
    @State private var dressed = false
    @State private var badge = false

    var body: some View {
        AspectFrame(ratio: 2.0 / 3.0) {
            ZStack {
                Image("OnboardingBefore").resizable().scaledToFill()
                Image("OnboardingAfter").resizable().scaledToFill()
                    .opacity(dressed ? 1 : 0)

                if working {
                    Color.black.opacity(0.25)
                    PulsingHalo()
                }
            }
        }
        .overlay(alignment: .trailing) { productCards }
        .overlay(alignment: .bottomLeading) {
            if badge {
                GoldBadge(text: String(localized: "Kombin hazır", comment: "Rozet: kombin (outfit) hazır"))
                    .padding(14)
                    .transition(.scale(scale: 0.6).combined(with: .opacity))
            }
        }
        .padding(.top, 4)
        .task(id: active) { await play() }
        .accessibilityElement()
        .accessibilityLabel("Üst, alt ve ayakkabı kişinin fotoğrafına giydiriliyor.")
    }

    /// Mağazalardan gelen üç ürün kartı: üst, alt, ayakkabı. Sırayla
    /// sahneye kayıyor, sonra birlikte kişinin üzerine doğru küçülüp
    /// kayboluyor. Sonra görselinde üç parça birden değiştiği için kart da
    /// üç tane; tek kart gelip bütün kıyafet değişince tutarsız duruyordu.
    private var productCards: some View {
        VStack(alignment: .trailing, spacing: 8) {
            ForEach(Array(Self.pieces.enumerated()), id: \.offset) { index, piece in
                productCard(piece)
                    .offset(x: cardsIn > index ? (absorbed ? -120 : -12) : 220)
                    .opacity(cardsIn > index && !absorbed ? 1 : 0)
            }
        }
        .scaleEffect(absorbed ? 0.2 : 1, anchor: .center)
        .offset(y: absorbed ? 10 : 0)
    }

    private static var pieces: [(image: String, name: String, price: String)] {
        [
            ("OnboardingShirt", Sample.shirt, Sample.shirtPrice),
            ("OnboardingPants", Sample.skirt, Sample.skirtPrice),
            ("OnboardingShoes", Sample.shoes, Sample.shoesPrice),
        ]
    }

    private func productCard(_ piece: (image: String, name: String, price: String)) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Image(piece.image)
                .resizable()
                .scaledToFill()
                .frame(width: 72, height: 80)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            Text(piece.name)
                .font(Typo.labelSm)
                .foregroundStyle(Palette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            Text(piece.price)
                .font(Typo.bodySm)
                .foregroundStyle(Palette.inkSoft)
        }
        .frame(width: 72)
        .padding(7)
        .background(Palette.white)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Palette.hairline, lineWidth: 1)
        )
    }

    private func reset() {
        cardsIn = 0
        absorbed = false
        working = false
        dressed = false
        badge = false
    }

    private func play() async {
        reset()
        guard active else { return }

        if reduceMotion {
            dressed = true
            badge = true
            return
        }

        while !Task.isCancelled {
            reset()
            guard await pause(500) else { return }
            for count in 1...Self.pieces.count {
                withAnimation(.spring(duration: 0.55, bounce: 0.2)) { cardsIn = count }
                guard await pause(380) else { return }
            }
            guard await pause(900) else { return }
            withAnimation(.easeIn(duration: 0.4)) { absorbed = true }
            guard await pause(300) else { return }
            withAnimation(.easeOut(duration: 0.25)) { working = true }
            guard await pause(1100) else { return }
            withAnimation(.easeInOut(duration: 0.7)) {
                working = false
                dressed = true
            }
            guard await pause(500) else { return }
            withAnimation(.spring(duration: 0.45, bounce: 0.35)) { badge = true }
            guard await pause(2600) else { return }
        }
    }
}

// MARK: - 2. Kombinin tamamı

private struct OutfitScene: View {
    let active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var shown = 0
    @State private var totalIn = false
    @State private var buttonIn = false

    private var pieces: [(image: String, slot: String, name: String, price: String)] {
        [
            ("OnboardingShirt", Slot.top.label, Sample.shirt, Sample.shirtPrice),
            ("OnboardingPants", Slot.bottom.label, Sample.skirt, Sample.skirtPrice),
            ("OnboardingShoes", Slot.shoes.label, Sample.shoes, Sample.shoesPrice),
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text("Kombindeki Parçalar")
                    .font(Typo.headlineSm(17))
                    .foregroundStyle(Palette.ink)
                Spacer()
                Text("\(shown) parça", comment: "Kombindeki parça sayısı")
                    .font(Typo.bodySm)
                    .foregroundStyle(Palette.inkFaint)
                    .contentTransition(.numericText())
                    // Döngü başında "0 parça" yazması boş bir kombin gibi
                    // duruyordu; ilk parça gelene kadar sayaç görünmüyor.
                    .opacity(shown == 0 ? 0 : 1)
            }

            HStack(alignment: .top, spacing: 10) {
                ForEach(Array(pieces.enumerated()), id: \.offset) { index, piece in
                    MiniPiece(image: piece.image, slot: piece.slot, name: piece.name, price: piece.price)
                        .opacity(index < shown ? 1 : 0)
                        .offset(y: index < shown ? 0 : -28)
                }
            }

            HStack {
                Text("Kombin toplam değeri")
                    .font(Typo.bodyMd)
                    .foregroundStyle(Palette.inkSoft)
                Spacer()
                Text(Sample.total)
                    .font(Typo.headlineSm(17))
                    .foregroundStyle(Palette.ink)
            }
            .padding(14)
            .background(Palette.pearl)
            .clipShape(RoundedRectangle(cornerRadius: Radius.base, style: .continuous))
            .opacity(totalIn ? 1 : 0)
            .offset(y: totalIn ? 0 : 10)

            Text(trUpper(String(localized: "Kombinle", comment: "Düğme, fiil: seçili parçaları avatara giydirip kombin (outfit) oluştur")))
                .font(Typo.labelLg)
                .foregroundStyle(Palette.white)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(Palette.ink)
                .clipShape(RoundedRectangle(cornerRadius: Radius.base, style: .continuous))
                .opacity(buttonIn ? 1 : 0)
                .scaleEffect(buttonIn ? 1 : 0.94)
        }
        .padding(16)
        .background(Palette.surfaceLow)
        .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .frame(maxHeight: .infinity)
        .task(id: active) { await play() }
        .accessibilityElement()
        .accessibilityLabel("Üst, alt ve ayakkabı kombine ekleniyor.")
    }

    private func reset() {
        shown = 0
        totalIn = false
        buttonIn = false
    }

    private func play() async {
        reset()
        guard active else { return }

        if reduceMotion {
            shown = pieces.count
            totalIn = true
            buttonIn = true
            return
        }

        while !Task.isCancelled {
            reset()
            guard await pause(450) else { return }
            for _ in pieces {
                withAnimation(.spring(duration: 0.5, bounce: 0.3)) { shown += 1 }
                guard await pause(650) else { return }
            }
            withAnimation(.easeOut(duration: 0.35)) { totalIn = true }
            guard await pause(450) else { return }
            withAnimation(.spring(duration: 0.4, bounce: 0.3)) { buttonIn = true }
            guard await pause(2800) else { return }
        }
    }
}

/// Parça kartının küçültülmüş hali. Uygulamadaki kartla aynı düzen.
private struct MiniPiece: View {
    let image: String
    let slot: String
    let name: String
    let price: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Color.clear
                .aspectRatio(3.0 / 4.0, contentMode: .fit)
                .overlay {
                    Image(image).resizable().scaledToFill()
                }
                .clipShape(RoundedRectangle(cornerRadius: Radius.base, style: .continuous))
            Text(trUpper(slot))
                .font(Typo.labelSm)
                .kerning(1)
                .foregroundStyle(Palette.inkFaint)
            Text(name)
                .font(Typo.bodySm)
                .foregroundStyle(Palette.ink)
                .lineLimit(1)
            Text(price)
                .font(Typo.labelMd)
                .foregroundStyle(Palette.ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - 3. Paylaş

private struct ShareScene: View {
    let active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var sheetUp = false
    @State private var highlight = false
    @State private var tapped = false
    @State private var toast = false

    var body: some View {
        ZStack(alignment: .bottom) {
            // Arkada bir mağazanın ürün sayfası.
            VStack(alignment: .leading, spacing: 12) {
                Image("OnboardingShirt")
                    .resizable()
                    .scaledToFill()
                    .frame(maxWidth: .infinity)
                    .frame(height: 210)
                    .clipped()
                    .clipShape(RoundedRectangle(cornerRadius: Radius.base, style: .continuous))
                VStack(alignment: .leading, spacing: 4) {
                    Text(Sample.shirt)
                        .font(Typo.headlineSm(17))
                        .foregroundStyle(Palette.ink)
                    Text(Sample.shirtPrice)
                        .font(Typo.bodyMd)
                        .foregroundStyle(Palette.inkSoft)
                }
                Spacer(minLength: 0)
            }
            .padding(14)

            sheet
                .offset(y: sheetUp ? 0 : 320)

            if toast {
                HStack(spacing: 10) {
                    Image(systemName: "hanger")
                        .font(.system(size: 17, weight: .medium))
                    Text("TryIt'e eklendi")
                        .font(Typo.labelLg)
                }
                .foregroundStyle(Palette.ink)
                .padding(.vertical, 16)
                .padding(.horizontal, 22)
                .background(Palette.canvas)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(Palette.hairline, lineWidth: 1)
                )
                // Ürün adının üstüne binmesin diye sahnenin alt yarısında.
                .frame(maxHeight: .infinity, alignment: .center)
                .offset(y: 70)
                .transition(.scale(scale: 0.85).combined(with: .opacity))
            }
        }
        .background(Palette.surface)
        .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .frame(maxHeight: .infinity)
        .task(id: active) { await play() }
        .accessibilityElement()
        .accessibilityLabel("Bir ürün sayfasından paylaş menüsü açılıyor ve TryIt seçiliyor.")
    }

    /// Paylaş menüsünün kaba bir taklidi. Gerçeğinin aynısı değil, ama
    /// kullanıcı telefonunda görünce "bunu görmüştüm" diyebilmeli.
    private var sheet: some View {
        VStack(alignment: .leading, spacing: 14) {
            Capsule()
                .fill(Palette.line)
                .frame(width: 36, height: 5)
                .frame(maxWidth: .infinity)

            HStack(spacing: 10) {
                Image("OnboardingShirt")
                    .resizable()
                    .scaledToFill()
                    .frame(width: 38, height: 38)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(Sample.shirt)
                        .font(Typo.labelMd)
                        .foregroundStyle(Palette.ink)
                    Text("Online mağaza", comment: "Onboarding: sahte paylaş menüsünde ürünün geldiği yer; belirli bir marka değil")
                        .font(Typo.bodySm)
                        .foregroundStyle(Palette.inkFaint)
                }
            }

            Rectangle().fill(Palette.hairline).frame(height: 1)

            HStack(alignment: .top, spacing: 0) {
                shareTarget(color: Color(red: 0.23, green: 0.52, blue: 0.95), symbol: "dot.radiowaves.left.and.right", label: "AirDrop")
                shareTarget(color: Color(red: 0.25, green: 0.78, blue: 0.35), symbol: "message.fill", label: String(localized: "Mesajlar", comment: "Apple Mesajlar uygulamasının adı, paylaş menüsündeki gibi"))
                shareTarget(color: Color(red: 0.2, green: 0.55, blue: 0.98), symbol: "envelope.fill", label: String(localized: "Mail", comment: "Apple Mail uygulamasının adı, paylaş menüsündeki gibi"))
                tryItTarget
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 18)
        .background(Palette.white)
        .clipShape(
            UnevenRoundedRectangle(topLeadingRadius: 20, topTrailingRadius: 20, style: .continuous)
        )
    }

    private func shareTarget(color: Color, symbol: String, label: String) -> some View {
        VStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .fill(color)
                .frame(width: 56, height: 56)
                .overlay {
                    Image(systemName: symbol)
                        .font(.system(size: 22, weight: .medium))
                        .foregroundStyle(.white)
                }
            Text(label)
                .font(Typo.bodySm)
                .foregroundStyle(Palette.inkSoft)
        }
        .frame(maxWidth: .infinity)
    }

    private var tryItTarget: some View {
        VStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .fill(Palette.canvas)
                .frame(width: 56, height: 56)
                .overlay {
                    Image(systemName: "hanger")
                        .font(.system(size: 24, weight: .regular))
                        .foregroundStyle(Palette.ink)
                }
                .overlay(
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .strokeBorder(highlight ? Palette.gold : Palette.hairline, lineWidth: highlight ? 2.5 : 1)
                )
                .scaleEffect(tapped ? 0.88 : (highlight ? 1.08 : 1))
            Text(verbatim: Brand.name)
                .font(Typo.labelSm)
                .foregroundStyle(Palette.ink)
        }
        .frame(maxWidth: .infinity)
    }

    private func reset() {
        sheetUp = false
        highlight = false
        tapped = false
        toast = false
    }

    private func play() async {
        reset()
        guard active else { return }

        if reduceMotion {
            sheetUp = true
            highlight = true
            return
        }

        while !Task.isCancelled {
            reset()
            guard await pause(600) else { return }
            withAnimation(.spring(duration: 0.55, bounce: 0.15)) { sheetUp = true }
            guard await pause(800) else { return }
            withAnimation(.spring(duration: 0.4, bounce: 0.4)) { highlight = true }
            guard await pause(900) else { return }
            withAnimation(.easeIn(duration: 0.12)) { tapped = true }
            guard await pause(140) else { return }
            withAnimation(.easeOut(duration: 0.15)) { tapped = false }
            guard await pause(250) else { return }
            withAnimation(.easeIn(duration: 0.35)) { sheetUp = false }
            guard await pause(200) else { return }
            withAnimation(.spring(duration: 0.45, bounce: 0.3)) { toast = true }
            guard await pause(1800) else { return }
            withAnimation(.easeOut(duration: 0.3)) { toast = false }
            guard await pause(700) else { return }
        }
    }
}
