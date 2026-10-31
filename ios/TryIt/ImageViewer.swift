import SwiftUI
import UIKit

/// Tam ekranda gosterilecek gorselin kaynagi.
enum ImageSource {
    case remote(String)
    case local(URL)
}

/// `fullScreenCover(item:)` icin kimlikli sarmalayici.
struct ZoomedImage: Identifiable {
    let id = UUID()
    let source: ImageSource
}

/// Kombini tam ekranda buyutup inceleme.
///
/// Kumasin dokusu ve dikisin oturusu kucuk karede secilmiyor; asil bakilacak
/// yer burasi. Iki parmakla yakinlastirip kaydiriliyor, cift dokunus bir
/// adimda yaklastirip geri donduruyor.
struct ImageViewerView: View {
    let source: ImageSource

    @Environment(\.dismiss) private var dismiss

    @State private var image: UIImage?
    @State private var failed = false

    @State private var scale: CGFloat = 1
    @State private var committedScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var committedOffset: CGSize = .zero
    /// Kapanis icin asagi suruklerken birikenler.
    @State private var dismissDrag: CGFloat = 0

    private let minScale: CGFloat = 1
    private let maxScale: CGFloat = 6
    private let doubleTapScale: CGFloat = 2.6

    var body: some View {
        ZStack {
            Color.black
                .opacity(1 - min(dismissDrag / 400, 0.6))
                .ignoresSafeArea()

            if let image {
                canvas(image)
            } else if failed {
                Text("Görsel yüklenemedi")
                    .font(Typo.bodyMd)
                    .foregroundStyle(Palette.white.opacity(0.7))
            } else {
                ProgressView().tint(Palette.white)
            }

            closeButton
        }
        .statusBarHidden()
        .task { await load() }
    }

    private var closeButton: some View {
        VStack {
            HStack {
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Palette.white)
                        .padding(12)
                        .background(Color.white.opacity(0.16))
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.top, SafeArea.top + 6)
        // Yakinlastirilmis gorselde parmak hep ekranin ortasinda geziyor,
        // kapatma dugmesi jestin onune gecmemeli.
        .allowsHitTesting(true)
    }

    private func canvas(_ image: UIImage) -> some View {
        GeometryReader { geo in
            let box = fitted(image.size, in: geo.size)
            Image(uiImage: image)
                .resizable()
                .frame(width: box.width, height: box.height)
                .scaleEffect(scale)
                .offset(x: offset.width, y: offset.height + dismissDrag)
                .position(x: geo.size.width / 2, y: geo.size.height / 2)
                .gesture(panAndZoom(box: box, canvas: geo.size))
                .onTapGesture(count: 2) { toggleZoom(box: box, canvas: geo.size) }
        }
    }

    private func panAndZoom(box: CGSize, canvas: CGSize) -> some Gesture {
        SimultaneousGesture(
            DragGesture()
                .onChanged { value in
                    // Yakinlastirilmamisken asagi surukleme kapatma jesti.
                    if scale <= minScale + 0.01 {
                        dismissDrag = max(0, value.translation.height)
                        return
                    }
                    offset = clamped(
                        CGSize(
                            width: committedOffset.width + value.translation.width,
                            height: committedOffset.height + value.translation.height
                        ),
                        box: box, canvas: canvas, at: scale
                    )
                }
                .onEnded { value in
                    if scale <= minScale + 0.01 {
                        if value.translation.height > 120 {
                            dismiss()
                        } else {
                            withAnimation(.easeOut(duration: 0.2)) { dismissDrag = 0 }
                        }
                        return
                    }
                    committedOffset = offset
                },
            MagnifyGesture()
                .onChanged { value in
                    let next = min(max(committedScale * value.magnification, minScale), maxScale)
                    scale = next
                    offset = clamped(offset, box: box, canvas: canvas, at: next)
                }
                .onEnded { _ in
                    committedScale = scale
                    committedOffset = offset
                }
        )
    }

    private func toggleZoom(box: CGSize, canvas: CGSize) {
        withAnimation(.easeOut(duration: 0.22)) {
            if scale > minScale + 0.01 {
                scale = minScale
                offset = .zero
            } else {
                scale = doubleTapScale
                offset = clamped(offset, box: box, canvas: canvas, at: doubleTapScale)
            }
            committedScale = scale
            committedOffset = offset
        }
    }

    /// Gorseli ekrana sigdiran olcu.
    private func fitted(_ size: CGSize, in canvas: CGSize) -> CGSize {
        guard size.width > 0, size.height > 0, canvas.width > 0, canvas.height > 0 else { return canvas }
        let factor = min(canvas.width / size.width, canvas.height / size.height)
        return CGSize(width: size.width * factor, height: size.height * factor)
    }

    /// Kaydirmayi gorselin kenarlarinda durdurur; yoksa fotograf ekrandan
    /// kayip gidiyor ve geri getirmek zor oluyor.
    private func clamped(_ value: CGSize, box: CGSize, canvas: CGSize, at scale: CGFloat) -> CGSize {
        let limit = CGSize(
            width: max(0, (box.width * scale - canvas.width) / 2),
            height: max(0, (box.height * scale - canvas.height) / 2)
        )
        return CGSize(
            width: min(max(value.width, -limit.width), limit.width),
            height: min(max(value.height, -limit.height), limit.height)
        )
    }

    private func load() async {
        guard image == nil, !failed else { return }

        switch source {
        case .local(let url):
            if let loaded = UIImage(contentsOfFile: url.path) {
                image = loaded
            } else {
                failed = true
            }
        case .remote(let raw):
            guard let url = URL(string: raw) else {
                failed = true
                return
            }
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                if let loaded = UIImage(data: data) {
                    image = loaded
                } else {
                    failed = true
                }
            } catch {
                failed = true
            }
        }
    }
}
