import SwiftUI

struct SavedOutfitsView: View {
    @Bindable var model: AppModel
    @State private var showing: SavedOutfit?

    private var store: OutfitStore { model.store }
    @State private var filter: Occasion?

    private let columns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12),
    ]

    private var visible: [SavedOutfit] {
        guard let filter else { return store.outfits }
        return store.outfits.filter { $0.occasion == filter }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                heading
                if !store.outfits.isEmpty { filters }

                if visible.isEmpty {
                    empty
                } else {
                    LazyVGrid(columns: columns, spacing: 18) {
                        ForEach(visible) { outfit in
                            Button { showing = outfit } label: {
                                OutfitCell(outfit: outfit, imageURL: store.imageURL(for: outfit))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 28)
        }
        .sheet(item: $showing) { outfit in
            OutfitDetail(outfit: outfit, model: model)
        }
        .onAppear {
            guard Shot.has("-shotDetail"), showing == nil else { return }
            // Videoda önce liste görünsün, sonra detay açılsın.
            let delay = Shot.has("-shotSlow") ? 2.2 : 0
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { showing = visible.first }
        }
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: 5) {
            SectionLabel(text: String(localized: "Atölye arşivi"))
            HStack(alignment: .firstTextBaseline) {
                Text("Kişisel Gardırop")
                    .font(Typo.headlineLg(26))
                    .foregroundStyle(Palette.ink)
                Spacer()
                Text("\(store.outfits.count) kombin", comment: "Kaydedilmiş kombin (outfit) sayısı")
                    .font(Typo.bodySm)
                    .foregroundStyle(Palette.inkFaint)
            }
        }
    }

    private var filters: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Button { filter = nil } label: {
                    Chip(text: String(localized: "Tümü (\(store.outfits.count))", comment: "Filtre: bütün kombinler, parantezde sayı"), active: filter == nil)
                }
                .buttonStyle(.plain)

                ForEach(Occasion.allCases) { occasion in
                    let count = store.outfits.filter { $0.occasion == occasion }.count
                    if count > 0 {
                        Button { filter = occasion } label: {
                            Chip(text: occasion.label, active: filter == occasion)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.vertical, 2)
        }
    }

    private var empty: some View {
        VStack(spacing: 14) {
            Image(systemName: "hanger")
                .font(.system(size: 24, weight: .ultraLight))
                .foregroundStyle(Palette.ink)
                .frame(width: 62, height: 62)
                .overlay(Circle().strokeBorder(Palette.line, lineWidth: 1))

            Text(filter == nil ? "Henüz kombinin yok mu?" : "Bu etikette kombin yok")
                .font(Typo.headlineMd(20))
                .foregroundStyle(Palette.ink)

            Text(filter == nil
                 ? "Bir kombin hazırladıktan sonra kaydet, burada birikir."
                 : "Başka bir etiket seç ya da yeni bir kombin kaydet.")
                .font(Typo.bodyMd)
                .foregroundStyle(Palette.inkFaint)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 50)
        .padding(.horizontal, 24)
    }
}

private struct OutfitCell: View {
    let outfit: SavedOutfit
    let imageURL: URL

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            AspectFrame(ratio: 2.0 / 3.0) {
                ZStack {
                    LocalImage(url: imageURL)
                    Vignette()
                }
            }
                .overlay(alignment: .topLeading) {
                    Text(outfit.createdAt.formatted(.dateTime.day().month(.abbreviated)))
                        .font(Typo.labelSm)
                        .foregroundStyle(Palette.ink)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 4)
                        .background(Palette.white.opacity(0.9))
                        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                        .padding(9)
                }
                .overlay(alignment: .bottomLeading) {
                    if let occasion = outfit.occasion {
                        GoldBadge(text: occasion.label).padding(9)
                    }
                }

            Text(outfit.items.map(\.name).joined(separator: " + "))
                .font(Typo.bodySm)
                .foregroundStyle(Palette.ink)
                // Sabit yer ayirmazsak tek ve iki satirlik basliklar
                // fiyatlari farkli hizalara dusuruyor.
                .lineLimit(2, reservesSpace: true)
                .multilineTextAlignment(.leading)

            if let total = outfit.totalPrice {
                Text(total)
                    .font(Typo.labelMd)
                    .foregroundStyle(Palette.ink)
            }
        }
    }
}

private struct OutfitDetail: View {
    let outfit: SavedOutfit
    @Bindable var model: AppModel

    private var store: OutfitStore { model.store }

    @Environment(\.dismiss) private var dismiss
    @State private var zoomed: ZoomedImage?
    // Bu ekran ayri bir yaprak olarak aciliyor, RootView'daki kutu
    // buranin ustune cikamiyor. Kendi kutusunu tasiyor.
    @State private var dialogs = DialogCenter()
    /// Paylasima hazir, damgalanmis kopya.
    @State private var shareable: Image?

    /// Etiket degisebildigi icin magazadaki guncel hali okunuyor.
    private var current: SavedOutfit {
        store.outfits.first { $0.id == outfit.id } ?? outfit
    }

    var body: some View {
        ZStack {
            Palette.canvas.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Button { zoomed = ZoomedImage(source: .local(store.imageURL(for: outfit))) } label: {
                        AspectFrame(ratio: 2.0 / 3.0) {
                            LocalImage(url: store.imageURL(for: outfit))
                        }
                        .overlay(alignment: .topTrailing) {
                            Image(systemName: "arrow.up.left.and.arrow.down.right")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(Palette.ink)
                                .padding(9)
                                .background(Palette.white.opacity(0.9))
                                .clipShape(Circle())
                                .padding(12)
                        }
                    }
                    .buttonStyle(.plain)

                    SectionLabel(text: current.createdAt.formatted(date: .long, time: .shortened))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)

                    occasionPicker
                    pieceList
                    if let total = current.totalPrice { totalRow(total) }
                    refreshButton
                    shareButton
                    deleteButton
                }
                .padding(20)
            }

            DialogHost(center: dialogs)
        }
        .task(id: outfit.id) { prepareShare() }
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(Radius.sheet)
        .fullScreenCover(item: $zoomed) { item in
            ImageViewerView(source: item.source)
        }
    }

    private var occasionPicker: some View {
        VStack(alignment: .leading, spacing: 11) {
            SectionLabel(text: String(localized: "Ne için", comment: "Kombinin kullanım etiketi başlığı (ofis, gece...)"))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Occasion.allCases) { occasion in
                        let active = current.occasion == occasion
                        Button {
                            store.setOccasion(active ? nil : occasion, for: outfit)
                        } label: {
                            Chip(text: occasion.label, active: active)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private var pieceList: some View {
        VStack(alignment: .leading, spacing: 11) {
            SectionLabel(text: String(localized: "Kombindeki parçalar"))
            VStack(spacing: 0) {
                ForEach(Array(current.items.enumerated()), id: \.element.id) { index, item in
                    if index > 0 {
                        Rectangle().fill(Palette.hairline).frame(height: 1)
                    }
                    row(item)
                }
            }
            .background(Palette.white)
            .clipShape(RoundedRectangle(cornerRadius: Radius.base, style: .continuous))
        }
    }

    private func row(_ item: SavedItem) -> some View {
        HStack(spacing: 13) {
            AspectFrame(ratio: 48.0 / 62.0, radius: 6) {
                RemoteImage(url: item.imageURL, contentMode: .fill)
            }
            .frame(width: 48, height: 62)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                Text(trUpper(item.slot.label))
                    .font(Typo.labelSm)
                    .kerning(1)
                    .foregroundStyle(Palette.inkFaint)
                Text(item.name)
                    .font(Typo.bodyMd)
                    .foregroundStyle(Palette.ink)
                    .lineLimit(2)
                if let price = item.priceText {
                    Text(price)
                        .font(Typo.labelMd)
                        .foregroundStyle(Palette.ink)
                }
            }

            Spacer(minLength: 0)

            if let url = URL(string: item.productURL) {
                Link(destination: url) {
                    Image(systemName: "arrow.up.forward")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Palette.ink)
                        .padding(9)
                        .background(Palette.pearl)
                        .clipShape(Circle())
                }
            }
        }
        .padding(12)
    }

    private func totalRow(_ total: String) -> some View {
        HStack {
            Text("Kombin toplam değeri")
                .font(Typo.bodyMd)
                .foregroundStyle(Palette.inkSoft)
            Spacer()
            Text(total)
                .font(Typo.headlineSm(17))
                .foregroundStyle(Palette.ink)
        }
        .padding(14)
        .background(Palette.pearl)
        .clipShape(RoundedRectangle(cornerRadius: Radius.base, style: .continuous))
    }

    /// Kaydedilmis kombini calisma ekranina geri koyar.
    ///
    /// Bir seyi degistirmek isteyen kisi butun linkleri bastan eklemek
    /// zorunda kalmasin diye.
    private var refreshDialog: DialogContent {
        DialogContent(
            title: String(localized: "Kombini yenile"),
            message: String(localized: "Bu kombindeki parçalar çalışma ekranına alınacak. Ekranda duran kombine mi eklensin, yoksa sıfırdan mı başlansın?"),
            actions: [
                DialogAction(String(localized: "Kombine ekle", comment: "Düğme: parçaları mevcut kombine (outfit) ekle"), icon: "plus", kind: .primary) {
                    model.loadOutfit(current, startingOver: false)
                    dismiss()
                },
                DialogAction(String(localized: "Yeni kombin başlat", comment: "Düğme: sıfırdan yeni kombin (outfit)"), icon: "sparkles") {
                    model.loadOutfit(current, startingOver: true)
                    dismiss()
                },
            ]
        )
    }

    private var refreshButton: some View {
        Button { dialogs.show(refreshDialog) } label: {
            Label(trUpper(String(localized: "Kombini Yenile")), systemImage: "arrow.triangle.2.circlepath")
                .labelStyle(.titleAndIcon)
        }
        .buttonStyle(PrimaryButtonStyle())
    }

    /// Kombin gorselini paylasir.
    ///
    /// Dosya adresi yerine goruntunun kendisini veriyoruz: WhatsApp ve
    /// Mesajlar boyle fotograf olarak gonderiyor, dosya adresinde ise
    /// ek dosya gibi gidiyor.
    /// Damgali kopya bir kez hazirlanip bekletiliyor: gorsel buyuk,
    /// her cizimde yeniden damgalamak ekrani takiyor.
    private func prepareShare() {
        guard shareable == nil,
              let raw = UIImage(contentsOfFile: store.imageURL(for: outfit).path) else { return }
        let stamped = Watermark.stamp(raw)
        shareable = Image(uiImage: stamped)
    }

    @ViewBuilder
    private var shareButton: some View {
        if let image = shareable {
            ShareLink(
                item: image,
                preview: SharePreview(String(localized: "TryIt kombin", comment: "Paylaşım önizleme başlığı: TryIt markası ve kombin (outfit)"), image: image)
            ) {
                Label(trUpper(String(localized: "Kombini Paylaş")), systemImage: "square.and.arrow.up")
                    .labelStyle(.titleAndIcon)
            }
            .buttonStyle(SecondaryButtonStyle())
        }
    }

    private var deleteDialog: DialogContent {
        DialogContent(
            title: String(localized: "Bu kombin silinsin mi?"),
            message: String(localized: "Kombinlerim'den kalıcı olarak kaldırılacak, geri getirilemez."),
            actions: [
                DialogAction(String(localized: "Sil", comment: "Düğme: sil"), icon: "trash", kind: .destructive) {
                    store.delete(outfit)
                    dismiss()
                },
            ]
        )
    }

    private var deleteButton: some View {
        Button { dialogs.show(deleteDialog) } label: {
            Text(trUpper(String(localized: "Kombini Sil")))
                .font(Typo.labelMd)
                .foregroundStyle(Palette.errorInk)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
        }
        .buttonStyle(.plain)
    }
}
