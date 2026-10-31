import SwiftUI

enum Tab: String, CaseIterable, Identifiable {
    case dene = "Dene"
    case kombinlerim = "Kombinlerim"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dene: return String(localized: "Dene", comment: "Sekme: kombin deneme ekranı")
        case .kombinlerim: return String(localized: "Kombinlerim", comment: "Sekme: kaydedilmiş kombinler (outfit)")
        }
    }

    var icon: String {
        switch self {
        case .dene: return "sparkles"
        case .kombinlerim: return "square.grid.2x2"
        }
    }
}

struct RootView: View {
    @Bindable var model: AppModel
    @State private var tab: Tab = .dene
    @State private var dialogs = DialogCenter()
    /// Onboarding bir kez gösteriliyor.
    @AppStorage("tryit.onboarded") private var onboarded = false
    @State private var showingOnboarding = false

    var body: some View {
        ZStack {
            Palette.canvas.ignoresSafeArea()

            VStack(spacing: 0) {
                header

                switch tab {
                case .dene:
                    TryOnView(model: model)
                case .kombinlerim:
                    SavedOutfitsView(model: model)
                }

                tabBar
            }

            // Paylasimdan gelen link cozulurken perde. Kutudan once
            // ciziliyor ki kutu actiginda onun altinda kalsin.
            if model.preparing {
                BusyOverlay(title: String(localized: "Ürün hazırlanıyor"), subtitle: String(localized: "Link çözülüyor"))
            }

            // Kutu en ustte: baslik seridini ve sekme cubugunu da ortmeli.
            DialogHost(center: dialogs)
        }
        .animation(.easeOut(duration: 0.2), value: model.preparing)
        .environment(dialogs)
        .tint(Palette.ink)
        // Tasarim tek temali ve acik.
        .preferredColorScheme(.light)
        // Paylasimdan gelen link sorusu burada duruyor, TryOnView'da
        // degil: kullanici Kombinlerim sekmesindeyken de sorulmali.
        .onChange(of: model.askingShared) { _, asking in
            guard asking else { return }
            dialogs.show(sharedDialog)
        }
        .onAppear {
            // "-onboarding" argumaniyla acilinca bayraga bakmadan gosteriyoruz;
            // gelistirirken ekrani tekrar tekrar gorebilmek icin.
            let forced = ProcessInfo.processInfo.arguments.contains("-onboarding")
            if !onboarded || forced { showingOnboarding = true }
            if Shot.has("-shotSaved") { tab = .kombinlerim }
        }
        .fullScreenCover(isPresented: $showingOnboarding) {
            OnboardingView(hasAvatar: model.avatar != nil) { wantsPhoto in
                onboarded = true
                showingOnboarding = false
                tab = .dene
                guard wantsPhoto else { return }
                // Perde kapanmadan kutu acilirsa perdenin altinda kaliyor.
                Task {
                    try? await Task.sleep(for: .milliseconds(450))
                    model.wantsPhotoPicker = true
                }
            }
        }
        .fullScreenCover(isPresented: $model.wantsPaywall) {
            PaywallView(model: model)
        }
        // Kaydedilmis kombin geri yuklendiginde calisma ekranina geciyoruz.
        .onChange(of: model.wantsTryOnTab) { _, wants in
            guard wants else { return }
            tab = .dene
            model.wantsTryOnTab = false
        }
        // Yeni urune yer kalmadiysa hangi parcanin cikacagini soruyoruz.
        .onChange(of: model.askingReplace) { _, asking in
            guard asking, let dialog = replaceDialog else { return }
            tab = .dene
            dialogs.show(dialog)
        }
    }

    /// Gelen urun icin hangi parcanin cikacagini soran kutu.
    ///
    /// Secenekler mevcut parcalar. Gelen urunun kendi yuvasi basta
    /// duruyor, cunku dogru cevap cogunlukla o. Ama digerleri de
    /// secilebiliyor: sunucu urunu yanlis siniflandirdiysa kullanici
    /// burada duzeltmis oluyor.
    private var replaceDialog: DialogContent? {
        guard let incoming = model.pendingItem else { return nil }

        let ordered = model.chosen.sorted { left, _ in left.slot == incoming.slot }
        let actions = ordered.map { piece in
            DialogAction(
                String(localized: "\(piece.slot.label): \(short(piece.product.name))", comment: "Yuva adı ve ürün adı"),
                icon: piece.slot == incoming.slot ? "arrow.left.arrow.right" : nil,
                kind: piece.slot == incoming.slot ? .primary : .normal
            ) {
                Task { await model.replace(with: piece.slot) }
            }
        }

        return DialogContent(
            title: String(localized: "Yerine ne geçsin?"),
            // Cakisma iki sekilde olabiliyor: yuva dolu ya da kombinde hic
            // yer kalmamis. Ikisine de dogru olan tek cumle bu.
            message: String(localized: "\(short(incoming.product.name)) eklenecek. Çıkacak parçayı seç, yeni ürün onun yerine geçsin."),
            cancelTitle: String(localized: "Ekleme", comment: "Düğme: ürünü ekleme, vazgeç"),
            onCancel: { Task { await model.cancelReplace() } },
            actions: actions
        )
    }

    /// Uzun urun adlarini kutuya sigdirir.
    private func short(_ name: String) -> String {
        name.count > 30 ? String(name.prefix(29)) + "\u{2026}" : name
    }

    private var sharedDialog: DialogContent {
        let count = model.sharedPending.count
        return DialogContent(
            title: count == 1 ? String(localized: "Paylaşılan link eklensin mi?") : String(localized: "\(count) link eklensin mi?"),
            message: String(localized: "Ekrandaki kombinin üzerine mi eklensin, yoksa sıfırdan mı başlansın?"),
            onCancel: { model.dismissShared() },
            actions: [
                DialogAction(String(localized: "Kombine ekle", comment: "Düğme: parçaları mevcut kombine (outfit) ekle"), icon: "plus", kind: .primary) {
                    tab = .dene
                    Task { await model.acceptShared(startingOver: false) }
                },
                DialogAction(String(localized: "Yeni kombin başlat", comment: "Düğme: sıfırdan yeni kombin (outfit)"), icon: "sparkles") {
                    tab = .dene
                    Task { await model.acceptShared(startingOver: true) }
                },
            ]
        )
    }

    // MARK: - Baslik

    private var header: some View {
        HStack(spacing: 9) {
            Image(systemName: "hanger")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Palette.ink)

            Text(trUpper(Brand.name))
                .font(Typo.labelLg)
                .kerning(2.2)
                .foregroundStyle(Palette.ink)

            Spacer()

            // Doğrulanmamış cihazın "0 hak" durumu gerçek değil; gösterge gizli.
            // Sınırsız (jüri) modda sayaç ve ona bağlı paywall yolu gizli.
            if let credits = model.credits, credits.needsAttestation != true, !credits.isUnlimited {
                creditsPill(credits)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 4)
        .padding(.bottom, 12)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Palette.hairline).frame(height: 1)
        }
    }

    /// Kalan kombin hakki. Dokununca abonelik ekrani aciliyor.
    private func creditsPill(_ credits: Credits) -> some View {
        let text: String
        if credits.remaining == 0 {
            text = credits.isSubscribed ? String(localized: "Bu ay hakkın bitti") : String(localized: "Ücretsiz hakkın bitti")
        } else {
            text = credits.isSubscribed
                ? String(localized: "Bu ay \(credits.remaining) kombin", comment: "Kalan kombin (outfit) hakkı")
                : String(localized: "\(credits.remaining) ücretsiz kombin", comment: "Kalan ücretsiz kombin (outfit) hakkı")
        }
        return Button {
            model.wantsPaywall = true
        } label: {
            HStack(spacing: 6) {
                Image(systemName: credits.remaining == 0 ? "sparkles" : "hanger")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Palette.gold)
                Text(text)
                    .font(Typo.labelMd)
                    .foregroundStyle(Palette.ink)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .overlay(Capsule().strokeBorder(Palette.gold, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Abonelik seçeneklerini açar")
    }

    // MARK: - Alt sekme cubugu

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(Tab.allCases) { item in
                let active = item == tab
                Button {
                    withAnimation(.easeOut(duration: 0.15)) { tab = item }
                } label: {
                    VStack(spacing: 5) {
                        Image(systemName: item.icon)
                            .font(.system(size: 17, weight: active ? .semibold : .regular))
                        Text(trUpper(item.title))
                            .font(Typo.labelSm)
                            .kerning(1.2)
                    }
                    .foregroundStyle(active ? Palette.ink : Palette.inkFaint)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 11)
                    .padding(.bottom, 4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .background(Palette.canvas)
        .overlay(alignment: .top) {
            Rectangle().fill(Palette.hairline).frame(height: 1)
        }
    }
}
