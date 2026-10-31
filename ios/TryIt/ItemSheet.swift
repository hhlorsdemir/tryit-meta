import SwiftUI

/// Bir parcanin yuvasini ve giydirmede kullanilacak urun fotografini duzenler.
struct ItemSheet: View {
    let item: Item
    @Bindable var model: AppModel

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Palette.canvas.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    hero
                    slotPicker
                    if item.product.images.count > 1 { photoPicker }
                    actions
                }
                .padding(20)
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(Radius.sheet)
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 14) {
            AspectFrame(ratio: 3.0 / 4.0) {
                RemoteImage(url: item.image, contentMode: .fill)
            }
            .overlay(alignment: .topLeading) {
                if !item.product.slotConfident {
                    GoldBadge(text: String(localized: "Yeri tahmin edildi", comment: "Parçanın yuvası (üst, alt...) tahmin edildi")).padding(12)
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                Text(trUpper(item.product.brand ?? String(localized: "Ürün")))
                    .font(Typo.labelSm)
                    .kerning(1.4)
                    .foregroundStyle(Palette.inkFaint)

                Text(item.product.name)
                    .font(Typo.headlineMd(21))
                    .foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)

                if let price = item.priceText {
                    Text(price)
                        .font(Typo.headlineSm(17))
                        .foregroundStyle(Palette.ink)
                }
            }
        }
    }

    private var slotPicker: some View {
        VStack(alignment: .leading, spacing: 11) {
            SectionLabel(text: String(localized: "Nereye giyilecek"))
            HStack(spacing: 8) {
                ForEach(Slot.allCases) { slot in
                    Button {
                        model.move(from: item.slot, to: slot)
                        dismiss()
                    } label: {
                        Chip(text: slot.label, active: slot == item.slot)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var photoPicker: some View {
        VStack(alignment: .leading, spacing: 11) {
            SectionLabel(text: String(localized: "Giydirme için referans fotoğraf"))
            Text("Giydirme bu fotoğrafa bakıyor. Ürünü en iyi gösteren kareyi seç.")
                .font(Typo.bodySm)
                .foregroundStyle(Palette.inkFaint)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 9) {
                    ForEach(item.product.images.prefix(10), id: \.self) { image in
                        let active = image == item.image
                        Button {
                            model.pickImage(slot: item.slot, image: image)
                        } label: {
                            ZStack {
                                Palette.surfaceLow
                                RemoteImage(url: image, contentMode: .fill)
                            }
                            .frame(width: 78, height: 100)
                            .clipped()
                            .clipShape(RoundedRectangle(cornerRadius: Radius.base, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: Radius.base, style: .continuous)
                                    .strokeBorder(active ? Palette.ink : .clear, lineWidth: 2)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private var actions: some View {
        VStack(spacing: 10) {
            if let url = URL(string: item.product.url) {
                Link(destination: url) {
                    Text(trUpper(String(localized: "Ürün Sayfasını Aç")))
                        .font(Typo.labelLg)
                        .foregroundStyle(Palette.white)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(Palette.ink)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.base, style: .continuous))
                }
            }

            Button {
                model.remove(slot: item.slot)
                dismiss()
            } label: {
                Text(trUpper(String(localized: "Kombinden Çıkar")))
                    .font(Typo.labelMd)
                    .foregroundStyle(Palette.errorInk)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            }
            .buttonStyle(.plain)
        }
    }
}
