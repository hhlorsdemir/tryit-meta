import SwiftUI
import UIKit

/// Yuklenmeden once fotografi 2:3 cerceveye hizalar.
///
/// Ayni siluet burada da duruyor: kullanici parmagiyla kaydirip yakinlastirarak
/// kendini hatta denk getiriyor. Hem galeriden secilen hem kameradan cekilen
/// kare buradan geciyor; kamera onizlemesi tam ekran, cekilen foto ise 4:3
/// oldugu icin cekimde gorulen kadraj zaten birebir cikmiyor.
struct AvatarCropView: View {
    let image: UIImage
    let onConfirm: (Data) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var scale: CGFloat = 1
    @State private var committedScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var committedOffset: CGSize = .zero
    @State private var frame: CGSize = .zero

    private let minScale: CGFloat = 1
    private let maxScale: CGFloat = 4

    var body: some View {
        VStack(spacing: 14) {
            header
            cropArea
            actions
        }
        .padding(.horizontal, 20)
        .padding(.top, SafeArea.top + 8)
        .padding(.bottom, SafeArea.bottom + 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.canvas.ignoresSafeArea())
    }

    private var header: some View {
        HStack {
            Button { dismiss() } label: {
                Text(trUpper(String(localized: "Vazgeç")))
                    .font(Typo.labelMd)
                    .foregroundStyle(Palette.inkFaint)
            }
            .buttonStyle(.plain)
            Spacer()
        }
    }

    private var cropArea: some View {
        GeometryReader { geo in
            let box = fitted(in: geo.size)
            Rectangle()
                .fill(Color.black)
                .frame(width: box.width, height: box.height)
                .overlay {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .scaleEffect(scale)
                        .offset(offset)
                }
                .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                .overlay { SilhouetteGuide(tint: Palette.white) }
                .position(x: geo.size.width / 2, y: geo.size.height / 2)
                .gesture(
                    SimultaneousGesture(
                        DragGesture()
                            .onChanged { value in
                                offset = clamped(
                                    CGSize(
                                        width: committedOffset.width + value.translation.width,
                                        height: committedOffset.height + value.translation.height
                                    ),
                                    at: scale
                                )
                            }
                            .onEnded { _ in committedOffset = offset },
                        MagnifyGesture()
                            .onChanged { value in
                                let next = min(max(committedScale * value.magnification, minScale), maxScale)
                                scale = next
                                offset = clamped(offset, at: next)
                            }
                            .onEnded { _ in
                                committedScale = scale
                                committedOffset = offset
                            }
                    )
                )
                .onAppear { frame = box }
                .onChange(of: box) { _, new in
                    frame = new
                    offset = clamped(offset, at: scale)
                    committedOffset = offset
                }
        }
        .frame(maxHeight: .infinity)
    }

    private var actions: some View {
        VStack(spacing: 10) {
            Button(trUpper(String(localized: "Bu Kareyi Kullan"))) {
                guard let data = cropped() else { return }
                onConfirm(data)
                dismiss()
            }
            .buttonStyle(PrimaryButtonStyle())

            Text("Kaydırarak ve iki parmakla yakınlaştırarak hizala")
                .font(Typo.bodySm)
                .foregroundStyle(Palette.inkFaint)
        }
    }

    /// Kaydirmayi goruntunun sinirlari icinde tutar.
    ///
    /// Serbest biraktigimizda kullanici fotografi cerceveden disari suruyor ve
    /// altinda siyah bir seritle kaliyordu; kirpma da o bosluga denk gelip
    /// 2:3 oranini bozuyordu.
    private func clamped(_ value: CGSize, at scale: CGFloat) -> CGSize {
        let limit = slack(at: scale)
        return CGSize(
            width: min(max(value.width, -limit.width), limit.width),
            height: min(max(value.height, -limit.height), limit.height)
        )
    }

    /// Cerceveyi dolduran goruntunun her iki yonde ne kadar tasma payi var.
    private func slack(at scale: CGFloat) -> CGSize {
        let size = image.size
        guard frame.width > 0, frame.height > 0, size.width > 0, size.height > 0 else { return .zero }
        let total = max(frame.width / size.width, frame.height / size.height) * scale
        return CGSize(
            width: max(0, (size.width * total - frame.width) / 2),
            height: max(0, (size.height * total - frame.height) / 2)
        )
    }

    /// Cerceve her zaman 2:3, verilen alana sigacak kadar buyuk.
    private func fitted(in size: CGSize) -> CGSize {
        let ratio: CGFloat = 2.0 / 3.0
        let height = min(size.height, size.width / ratio)
        return CGSize(width: height * ratio, height: height)
    }

    /// Ekranda gorulen pencereyi goruntu piksellerine cevirip kirpar.
    private func cropped() -> Data? {
        guard frame.width > 0, frame.height > 0 else { return nil }

        // EXIF donuklugunu duzlestiriyoruz, yoksa piksel koordinatlari
        // ekranda gorulenle ortusmuyor.
        let flat = normalized(image)
        guard let cg = flat.cgImage else { return nil }

        let pixels = CGSize(width: CGFloat(cg.width), height: CGFloat(cg.height))
        // scaledToFill tabani, ustune kullanicinin yakinlastirmasi.
        let base = max(frame.width / pixels.width, frame.height / pixels.height)
        let total = base * scale
        let shown = CGSize(width: pixels.width * total, height: pixels.height * total)

        // Goruntunun sol ust kosesinin cerceve icindeki yeri.
        let originInFrame = CGPoint(
            x: frame.width / 2 + offset.width - shown.width / 2,
            y: frame.height / 2 + offset.height - shown.height / 2
        )

        var rect = CGRect(
            x: -originInFrame.x / total,
            y: -originInFrame.y / total,
            width: frame.width / total,
            height: frame.height / total
        )
        // Kullanici cerceveyi goruntunun disina tasimis olabilir.
        rect = rect.intersection(CGRect(origin: .zero, size: pixels))
        guard !rect.isNull, rect.width > 1, rect.height > 1,
              let cut = cg.cropping(to: rect.integral) else { return nil }

        return UIImage(cgImage: cut).jpegData(compressionQuality: 0.9)
    }

    private func normalized(_ image: UIImage) -> UIImage {
        guard image.imageOrientation != .up else { return image }
        let format = UIGraphicsImageRendererFormat()
        format.scale = image.scale
        return UIGraphicsImageRenderer(size: image.size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: image.size))
        }
    }
}

/// Kirpma ekranina gidecek fotograf.
struct PendingPhoto: Identifiable {
    let id = UUID()
    let image: UIImage
}
