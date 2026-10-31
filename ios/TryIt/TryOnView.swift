import PhotosUI
import SwiftUI

struct TryOnView: View {
    @Bindable var model: AppModel
    @Environment(DialogCenter.self) private var dialogs
    @State private var addingLink = false
    @State private var editing: Slot?
    @State private var capturing = false
    @State private var pickingFromLibrary = false
    @State private var photo: PhotosPickerItem?
    /// Kirpma ekranini bekleyen fotograf.
    @State private var pending: PendingPhoto?
    /// Tam ekranda incelenecek gorsel.
    @State private var zoomed: ZoomedImage?

    var body: some View {
        ScrollViewReader { proxy in
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                stage
                avatarButton
                if model.resultURL != nil { resultActions }
                pieces.id("pieces")
                if let error = model.errorText { errorBanner(error) }
                if let notice = model.noticeText { noticeBanner(notice) }
                Button {
                    Task { await model.generateOrAskToSubscribe() }
                } label: {
                    VStack(spacing: 3) {
                        Text(trUpper(model.resultStale
                            ? String(localized: "Yeniden Kombinle", comment: "Düğme: kombini (outfit) yeniden oluştur")
                            : String(localized: "Kombinle", comment: "Düğme, fiil: seçili parçaları avatara giydirip kombin (outfit) oluştur")))
                        // Her basis para ve hak demek; kullanici bunu
                        // basmadan once gormeli.
                        if let cost = creditNote {
                            Text(cost)
                                .font(Typo.bodySm)
                                .foregroundStyle(Palette.white.opacity(0.72))
                        }
                    }
                    .padding(.vertical, creditNote == nil ? 0 : 7)
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!model.canGenerate)
                hint
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 28)
        }
        .onAppear {
            guard Shot.has("-shotPieces") else { return }
            // Videoda kaydırma görünsün diye bekleyip yavaşça kayıyor.
            let delay = Shot.has("-shotSlow") ? 1.5 : 0.4
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                withAnimation(.easeInOut(duration: Shot.has("-shotSlow") ? 1.4 : 0)) {
                    proxy.scrollTo("pieces", anchor: .center)
                }
            }
        }
        }
        .scrollDismissesKeyboard(.interactively)
        .sheet(isPresented: $addingLink) {
            AddLinkSheet(resolving: model.resolving) { link in
                Task { await model.addLink(link) }
            }
        }
        .sheet(item: $editing) { slot in
            if let item = model.items[slot] {
                ItemSheet(item: item, model: model)
            }
        }
        .fullScreenCover(isPresented: $capturing) {
            CameraCaptureView { data in
                if let image = UIImage(data: data) { pending = PendingPhoto(image: image) }
            }
        }
        .fullScreenCover(item: $pending) { photo in
            AvatarCropView(image: photo.image) { data in
                Task { await model.setAvatar(imageData: data) }
            }
        }
        .fullScreenCover(item: $zoomed) { item in
            ImageViewerView(source: item.source)
        }
        .photosPicker(isPresented: $pickingFromLibrary, selection: $photo, matching: .images)
        .onChange(of: model.wantsPhotoPicker) { _, wants in
            guard wants else { return }
            model.wantsPhotoPicker = false
            dialogs.show(photoDialog)
        }
        .onChange(of: photo) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self),
                   let image = UIImage(data: data) {
                    pending = PendingPhoto(image: image)
                }
                photo = nil
            }
        }
    }

    // MARK: - Kutular

    private var photoDialog: DialogContent {
        DialogContent(
            title: model.avatar == nil ? String(localized: "Fotoğrafını ekle") : String(localized: "Fotoğrafını değiştir"),
            message: String(localized: "Tam boy, karşıdan ve kollar yanda bir kare en iyi sonucu veriyor."),
            actions: [
                DialogAction(String(localized: "Fotoğraf çek"), icon: "camera", kind: .primary) { capturing = true },
                DialogAction(String(localized: "Galeriden seç"), icon: "photo.on.rectangle") { pickingFromLibrary = true },
            ]
        )
    }

    /// Silme geri alinamiyor ve yeniden uretmek para tutuyor, o yuzden
    /// tek dokunusla degil onayla gidiyor.
    private var deleteDialog: DialogContent {
        DialogContent(
            title: String(localized: "Kombin silinsin mi?"),
            message: model.resultSaved
                ? String(localized: "Ekrandaki kombin ve seçili parçalar kaldırılacak. Kaydettiğin kopya Kombinlerim'de duruyor.")
                : String(localized: "Ekrandaki kombin ve seçili parçalar kaldırılacak. Bu kombini kaydetmedin, geri getirilemez."),
            actions: [
                DialogAction(String(localized: "Sil", comment: "Düğme: sil"), icon: "trash", kind: .destructive) { model.startOver() },
            ]
        )
    }

    /// Avatar eylemi sahnenin hemen altinda ve yazili duruyor. Basliktaki
    /// kucuk arti isaretinin ne yaptigi anlasilmiyordu.
    private var avatarButton: some View {
        Button {
            dialogs.show(photoDialog)
        } label: {
            HStack(spacing: 8) {
                if model.uploading {
                    ProgressView().controlSize(.small).tint(Palette.ink)
                } else {
                    Image(systemName: model.avatar == nil ? "camera" : "arrow.triangle.2.circlepath")
                        .font(.system(size: 12, weight: .semibold))
                }
                Text(trUpper(model.avatar == nil ? String(localized: "Fotoğrafını Ekle") : String(localized: "Fotoğrafını Değiştir")))
            }
        }
        .buttonStyle(SecondaryButtonStyle())
        .disabled(model.uploading)
    }

    // MARK: - Sahne

    /// Kombin hazirsa sahne buyutecin kapisi, avatar yokken fotograf
    /// eklemenin kapisi.
    @ViewBuilder
    private var stage: some View {
        if let source = model.resultSource {
            Button { zoomed = ZoomedImage(source: source) } label: { stageBody }
                .buttonStyle(.plain)
        } else if model.avatar == nil {
            Button { dialogs.show(photoDialog) } label: { stageBody }
                .buttonStyle(.plain)
        } else {
            stageBody
        }
    }

    private var stageBody: some View {
        AspectFrame(ratio: 2.0 / 3.0) {
            ZStack {
                // Kombin önce cihazdaki kopyadan çiziliyor: hem anında
                // geliyor hem de sunucudaki adres bayatlasa bile duruyor.
                if let resultLocal = model.resultLocalURL {
                    LocalImage(url: resultLocal)
                } else if let result = model.resultURL {
                    RemoteImage(url: result, contentMode: .fill)
                } else if let localURL = model.avatarLocalURL {
                    LocalImage(url: localURL)
                } else if let avatar = model.avatar {
                    RemoteImage(url: avatar.url, contentMode: .fill)
                } else {
                    emptyStage
                }

                // Vinyet yalnizca uzerine yazilacak bir sey varken.
                if hasFooter { Vignette() }

                if model.generating { generatingOverlay }
            }
        }
        .overlay(alignment: .bottom) { stageFooter }
        .overlay(alignment: .topTrailing) { expandBadge }
    }

    /// Sahnenin buyutulebildigini gosteren isaret. Dokunulabilir oldugu
    /// yazmadan anlasilsin diye duruyor.
    @ViewBuilder
    private var expandBadge: some View {
        if model.resultURL != nil && !model.generating {
            Image(systemName: "arrow.up.left.and.arrow.down.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Palette.ink)
                .padding(9)
                .background(Palette.white.opacity(0.9))
                .clipShape(Circle())
                .padding(12)
        }
    }

    private var hasFooter: Bool {
        !model.generating && (model.resultURL != nil || !model.chosen.isEmpty)
    }

    @ViewBuilder
    private var stageFooter: some View {
        if hasFooter {
            HStack(alignment: .bottom) {
                if model.resultURL != nil {
                    // Bayat kombin ekranda kalıyor, rozet durumu söylüyor.
                    // Parça da değişmiş olabilir fotoğraf da, o yüzden
                    // metin ikisini birden kapsıyor.
                    // Küçük sürüm ekrandayken bulanıklık kusur sanılmasın.
                    GoldBadge(text: model.resultStale ? String(localized: "Güncel değil", comment: "Rozet: kombin seçili parçalarla uyuşmuyor")
                        : model.sharpening ? String(localized: "Netleştiriliyor", comment: "Rozet: görselin yüksek çözünürlüklü sürümü hazırlanıyor")
                        : String(localized: "Kombin hazır", comment: "Rozet: kombin (outfit) hazır"))
                } else if !model.chosen.isEmpty {
                    GoldBadge(text: String(localized: "\(model.chosen.count) parça seçili"))
                }

                Spacer()

                if let total = model.totalPrice {
                    Text(total)
                        .font(Typo.headlineSm(17))
                        .foregroundStyle(Palette.white)
                }
            }
            .padding(14)
        }
    }

    /// Bos sahnede siluetin kendisi yonerge oluyor: ne tur bir kare
    /// bekledigimizi anlatmanin en kisa yolu.
    /// Bos sahne. Buradaki maddeler suslemeden ibaret degil: giydirme
    /// modeli kiyafeti fotograftaki govdenin uzerine oturtuyor. Govde
    /// gorunmuyorsa oranlari tahmin ediyor ve cikan kisi kullaniciya
    /// benzemiyor. En sik hata bol kiyafet, o yuzden ayrica yaziyor.
    private var emptyStage: some View {
        ZStack {
            SilhouetteGuide(tint: Palette.ink.opacity(0.22), hint: nil)

            VStack(spacing: 16) {
                Text("Fotoğrafını ekle")
                    .font(Typo.headlineMd(20))
                    .foregroundStyle(Palette.ink)

                VStack(alignment: .leading, spacing: 10) {
                    PhotoRule(icon: "figure.stand", text: String(localized: "Tam boy, karşıdan, kollar yanda"))
                    PhotoRule(icon: "tshirt", text: String(localized: "Tişört ve pantolon gibi vücut hattını gösteren kıyafet"))
                    PhotoRule(
                        icon: "exclamationmark.circle",
                        text: String(localized: "Elbise, palto ve bol giysi ölçüleri gizler")
                    )
                }
            }
            .padding(.vertical, 20)
            .padding(.horizontal, 18)
            .background(
                RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                    .fill(Palette.canvas.opacity(0.94))
            )
            .padding(.horizontal, 18)
        }
    }

    /// Uretim sirasinda nabiz gibi atan ince altin halka.
    private var generatingOverlay: some View {
        ZStack {
            Rectangle().fill(Color.black.opacity(0.45))
            PulsingHalo()
            VStack(spacing: 12) {
                Text(trUpper(String(localized: "Giydiriliyor", comment: "Parçalar avatara giydiriliyor")))
                    .font(Typo.labelMd)
                    .kerning(2)
                    .foregroundStyle(Palette.white)
                Text("Yarım dakika kadar sürebilir")
                    .font(Typo.bodySm)
                    .foregroundStyle(Palette.white.opacity(0.7))
            }
            .offset(y: 62)
        }
    }

    private var resultActions: some View {
        HStack(spacing: 10) {
            Button {
                Task { await model.saveResult() }
            } label: {
                Label(
                    trUpper(model.resultSaved ? String(localized: "Kaydedildi")
                        : model.saving ? String(localized: "Kaydediliyor") : String(localized: "Kombini Kaydet")),
                    systemImage: model.resultSaved ? "checkmark" : "bookmark"
                )
                .labelStyle(.titleAndIcon)
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(model.saving || model.resultSaved)

            // "Yeni Kombin" ile "Yeniden Kombinle" yan yana okununca
            // ayirt edilmiyordu. Bu dugme aslinda temizliyor, adi da
            // onu soylesin.
            Button {
                dialogs.show(deleteDialog)
            } label: {
                Label(trUpper(String(localized: "Kombini Sil")), systemImage: "trash")
                    .labelStyle(.titleAndIcon)
            }
            .buttonStyle(SecondaryButtonStyle())
        }
    }

    // MARK: - Parcalar

    private var pieces: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack {
                Text("Kombindeki Parçalar")
                    .font(Typo.headlineSm(17))
                    .foregroundStyle(Palette.ink)
                Spacer()
                if !model.chosen.isEmpty {
                    Text("\(model.chosen.count) parça")
                        .font(Typo.bodySm)
                        .foregroundStyle(Palette.inkFaint)
                }
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 11) {
                    ForEach(model.chosen) { item in
                        PieceCard(
                            item: item,
                            onEdit: { editing = item.slot },
                            onRemove: { model.remove(slot: item.slot) }
                        )
                    }
                    // Kombin doluyken de duruyor: yeni urun geldiginde
                    // hangi parcanin yerine gececegini kullanici seciyor.
                    AddPieceCard(loading: model.resolving) { addingLink = true }
                }
            }
        }
    }

    /// Hata degil, bilgi. Kirmizi degil, sahnedeki notlarla ayni dilde.
    private func noticeBanner(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: "arrow.left.arrow.right")
                .font(.system(size: 12, weight: .semibold))
            Text(text).font(Typo.bodySm)
        }
        .foregroundStyle(Palette.inkSoft)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(13)
        .background(Palette.pearl)
        .clipShape(RoundedRectangle(cornerRadius: Radius.base, style: .continuous))
    }

    private func errorBanner(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: "exclamationmark.circle")
                .font(.system(size: 13, weight: .semibold))
            Text(text).font(Typo.bodyMd)
        }
        .foregroundStyle(Palette.errorInk)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(13)
        .background(Palette.errorBg)
        .clipShape(RoundedRectangle(cornerRadius: Radius.base, style: .continuous))
    }

    /// Kombinle dugmesinin altindaki hak uyarisi.
    private var creditNote: String? {
        guard let credits = model.credits, credits.needsAttestation != true,
              !credits.isUnlimited else { return nil }
        if credits.remaining == 0 {
            return credits.isSubscribed
                ? String(localized: "Bu ayki hakkın bitti")
                : String(localized: "Ücretsiz hakkın bitti · Abonelikle devam et")
        }
        return String(localized: "1 kombin hakkı kullanılır · \(credits.remaining) kaldı", comment: "Sayı kalan kombin (outfit) hakkı")
    }

    @ViewBuilder
    private var hint: some View {
        if model.avatar == nil {
            centeredHint("Başlamak için fotoğrafını ekle")
        } else if model.chosen.isEmpty {
            centeredHint("En az bir parça ekle")
        }
    }

    private func centeredHint(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(Typo.bodySm)
            .foregroundStyle(Palette.inkFaint)
            .frame(maxWidth: .infinity)
    }
}

// MARK: - Nabiz halkasi

// MARK: - Parca kartlari

private struct PieceCard: View {
    let item: Item
    let onEdit: () -> Void
    let onRemove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(action: onEdit) {
                ZStack {
                    Palette.surfaceLow
                    RemoteImage(url: item.image, contentMode: .fill)
                }
                .frame(width: 124, height: 162)
                .clipped()
                .clipShape(RoundedRectangle(cornerRadius: Radius.base, style: .continuous))
                // Rozet ve carpi, cerceve kirpildiktan sonra bindiriliyor.
                // ZStack icinde dursalardi dolduran gorsel yiginin
                // sinirlarini buyuttugu icin kartin disina tasiyorlardi.
                .overlay(alignment: .topTrailing) {
                    Button(action: onRemove) {
                        Image(systemName: "xmark")
                            .font(.system(size: 8, weight: .bold))
                            .foregroundStyle(Palette.ink)
                            .padding(6)
                            .background(Palette.white.opacity(0.9))
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .padding(7)
                }
            }
            .buttonStyle(.plain)

            Text(trUpper(item.product.brand ?? item.slot.label))
                .font(Typo.labelSm)
                .kerning(1)
                .foregroundStyle(Palette.inkFaint)

            Text(item.product.name)
                .font(Typo.bodySm)
                .foregroundStyle(Palette.ink)
                .lineLimit(2, reservesSpace: true)
                .multilineTextAlignment(.leading)

            if let price = item.priceText {
                Text(price)
                    .font(Typo.labelMd)
                    .foregroundStyle(Palette.ink)
            }
        }
        .frame(width: 124, alignment: .leading)
    }
}

private struct AddPieceCard: View {
    let loading: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 9) {
                if loading {
                    ProgressView().tint(Palette.inkFaint)
                } else {
                    Image(systemName: "plus")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Palette.ink)
                    Text(trUpper(String(localized: "Link ekle")))
                        .font(Typo.labelSm)
                        .kerning(1)
                        .foregroundStyle(Palette.inkFaint)
                }
            }
            .frame(width: 124, height: 162)
            .background(Palette.pearl)
            .clipShape(RoundedRectangle(cornerRadius: Radius.base, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(loading)
    }
}
