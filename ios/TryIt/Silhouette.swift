import SwiftUI

/// Cinsiyetsiz, tam boy insan silueti.
///
/// Kullanici kendini bu hatta denk getiriyor. Amaci estetik degil kalite:
/// giydirme modeli karsidan, kollar yanda, bastan ayaga cekilmis kareyi
/// belirgin sekilde daha iyi isliyor. Silueti 2:3 bir cerceveye gore
/// oranliyoruz, cunku uygulamadaki her sahne o oranda.
struct Silhouette: Shape {
    func path(in rect: CGRect) -> Path {
        let w = rect.width, h = rect.height
        let cx = rect.midX
        func y(_ f: CGFloat) -> CGFloat { rect.minY + h * f }

        // Oranlar yaklasik 7.5 bas boyu bir govdeye gore.
        let headHalf = w * 0.068
        let headTop = y(0.05), headBottom = y(0.175)
        let neck = y(0.205), neckHalf = headHalf * 0.62
        let shoulder = y(0.25), shoulderHalf = w * 0.225
        let armpit = y(0.315), armpitHalf = w * 0.175
        let wrist = y(0.545), armOuterHalf = w * 0.295, armInnerHalf = w * 0.20
        let waist = y(0.47), waistHalf = w * 0.15
        let hip = y(0.55), hipHalf = w * 0.185
        let crotch = y(0.585)
        let footY = y(0.955), footOuterHalf = w * 0.155, ankleInnerHalf = w * 0.03

        var path = Path()

        // Bas ayri bir daire; boyunla birlesik cizmek hatti kirletiyor.
        path.addEllipse(in: CGRect(
            x: cx - headHalf,
            y: headTop,
            width: headHalf * 2,
            height: headBottom - headTop
        ))

        // Govdenin sag yarisi yukaridan asagiya. Koltuk alti ayri bir kose:
        // o olmadan kolun ic kenari govdeyle kesisiyor ve hat dugumleniyor.
        let right: [CGPoint] = [
            CGPoint(x: cx + neckHalf, y: neck),
            CGPoint(x: cx + shoulderHalf, y: shoulder),
            CGPoint(x: cx + armOuterHalf, y: wrist),
            CGPoint(x: cx + armInnerHalf, y: wrist),
            CGPoint(x: cx + armpitHalf, y: armpit),
            CGPoint(x: cx + waistHalf, y: waist),
            CGPoint(x: cx + hipHalf, y: hip),
            CGPoint(x: cx + footOuterHalf, y: footY),
            CGPoint(x: cx + ankleInnerHalf, y: footY),
        ]

        path.move(to: CGPoint(x: cx - neckHalf, y: neck))
        right.forEach { path.addLine(to: $0) }
        path.addLine(to: CGPoint(x: cx, y: crotch))
        // Sol yari sagin aynasi, ters sirada.
        right.reversed().forEach {
            path.addLine(to: CGPoint(x: 2 * cx - $0.x, y: $0.y))
        }
        path.closeSubpath()

        return path
    }
}

/// Siluet hattini ve altindaki yonergeyi birlikte cizen bindirme.
struct SilhouetteGuide: View {
    var tint: Color = Palette.white
    var hint: String? = String(localized: "Kendini hatta denk getir")

    var body: some View {
        GeometryReader { geo in
            let box = fitted(in: geo.size)
            ZStack {
                Silhouette()
                    .stroke(
                        tint.opacity(0.85),
                        style: StrokeStyle(lineWidth: 1.5, lineJoin: .round, dash: [7, 6])
                    )
                    .frame(width: box.width, height: box.height)
                    .position(x: geo.size.width / 2, y: geo.size.height / 2)

                if let hint {
                    Text(hint)
                        .font(Typo.bodySm)
                        .foregroundStyle(tint.opacity(0.9))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(.black.opacity(0.35))
                        .clipShape(Capsule())
                        .position(
                            x: geo.size.width / 2,
                            y: geo.size.height / 2 + box.height / 2 + 18
                        )
                }
            }
        }
        .allowsHitTesting(false)
    }

    /// Silueti her zaman 2:3 tutup verilen alana sigdiriyor.
    private func fitted(in size: CGSize) -> CGSize {
        let ratio: CGFloat = 2.0 / 3.0
        let height = min(size.height * 0.88, size.width * 0.88 / ratio)
        return CGSize(width: height * ratio, height: height)
    }
}
