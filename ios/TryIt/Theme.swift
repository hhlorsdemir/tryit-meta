import SwiftUI
import UIKit

private extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }
}

/// "Luxe Editorial Atelier" paleti. Tasarım tek temalı ve açık: kemik beyazı
/// bir zemin, obsidyen siyah yazı ve yalnızca rozet ve simgelerde beliren
/// şampanya altını. Renk az, kontrast yüksek, sahne fotoğrafın.
enum Palette {
    static let canvas = Color(hex: 0xFBF9F6)
    static let surfaceLow = Color(hex: 0xF5F3F0)
    static let surface = Color(hex: 0xEFEEEB)
    static let pearl = Color(hex: 0xF1EFEB)
    static let field = Color(hex: 0xF5F3EF)
    static let white = Color(hex: 0xFFFFFF)

    static let ink = Color(hex: 0x121214)
    static let inkSoft = Color(hex: 0x47464A)
    static let inkFaint = Color(hex: 0x121214, alpha: 0.4)
    static let line = Color(hex: 0xC8C6CA)
    static let hairline = Color(hex: 0x121214, alpha: 0.08)

    static let gold = Color(hex: 0xC9A86A)
    static let onGold = Color(hex: 0x121214)

    static let errorInk = Color(hex: 0x991B1B)
    static let errorBg = Color(hex: 0xFDF2F2)
}

/// Plus Jakarta Sans. Değişken font olarak pakete giriyor; ağırlıkları
/// CoreText varyasyon ekseninden seçiliyor.
enum Typo {
    private static let family = "Plus Jakarta Sans"

    private static func font(_ size: CGFloat, _ weight: Font.Weight) -> Font {
        .custom(family, size: size).weight(weight)
    }

    static func displayLg(_ size: CGFloat = 40) -> Font { font(size, .bold) }
    static func headlineLg(_ size: CGFloat = 26) -> Font { font(size, .semibold) }
    static func headlineMd(_ size: CGFloat = 22) -> Font { font(size, .semibold) }
    static func headlineSm(_ size: CGFloat = 18) -> Font { font(size, .semibold) }

    static let bodyLg = font(16, .regular)
    static let bodyMd = font(14, .regular)
    static let bodySm = font(12, .regular)

    static let labelLg = font(14, .semibold)
    static let labelMd = font(12, .semibold)
    static let labelSm = font(10, .semibold)
}

/// Metnin gösterildiği dilin kurallarıyla büyük harf. `uppercased()` yerel
/// ayarı yok sayıyor ve Türkçede "i" harfini noktasız "I" yapıyordu.
/// Türkçede "İ", diğer dillerde "I" oluyor.
func trUpper(_ text: String) -> String {
    text.uppercased(with: .app)
}

extension Locale {
    /// Uygulamanın o an gösterdiği dil.
    ///
    /// `Locale.current` cihazın dili; uygulamada o dilin çevirisi yoksa
    /// metinler Türkçe görünüyor ama `current` yine cihazın dilini
    /// söylüyordu. Paket hangi çeviriyi seçtiyse o.
    static let app = Locale(identifier: Bundle.main.preferredLocalizations.first ?? "tr")

    /// Uygulama Türkçe mi gösteriyor.
    static var appIsTurkish: Bool { app.language.languageCode == .turkish }
}

// MARK: - Köşe yarıçapları

enum Radius {
    /// Standart öğeler.
    static let base: CGFloat = 8
    /// 2:3 kahraman kartları.
    static let card: CGFloat = 16
    /// Alttan açılan sayfalar.
    static let sheet: CGFloat = 24
}

// MARK: - Düğmeler

/// Obsidyen dolgu, 52 punto yükseklik, basılınca hafif küçülme.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Typo.labelLg)
            .foregroundStyle(Palette.white)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(isEnabled ? Palette.ink : Palette.ink.opacity(0.25))
            .clipShape(RoundedRectangle(cornerRadius: Radius.base, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// Şeffaf zemin, 1.5 punto obsidyen çerçeve.
struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Typo.labelMd)
            .foregroundStyle(Palette.ink)
            .frame(maxWidth: .infinity, minHeight: 46)
            .background(Palette.canvas)
            .overlay(
                RoundedRectangle(cornerRadius: Radius.base, style: .continuous)
                    .strokeBorder(Palette.ink, lineWidth: 1.5)
            )
            .clipShape(RoundedRectangle(cornerRadius: Radius.base, style: .continuous))
            .opacity(isEnabled ? (configuration.isPressed ? 0.7 : 1) : 0.35)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

// MARK: - Ortak parçalar

/// Büyük harf, geniş harf aralıklı bölüm etiketi.
struct SectionLabel: View {
    let text: String
    var body: some View {
        Text(trUpper(text))
            .font(Typo.labelSm)
            .kerning(1.6)
            .foregroundStyle(Palette.inkFaint)
    }
}

/// Filtre ve nitelik çipi. Seçiliyken obsidyen, değilken inci grisi.
struct Chip: View {
    let text: String
    var active: Bool = false

    var body: some View {
        Text(text)
            .font(Typo.labelMd)
            .foregroundStyle(active ? Palette.white : Palette.ink)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(active ? Palette.ink : Palette.pearl)
            .clipShape(Capsule())
    }
}

/// Görselin altındaki metnin okunması için gradyan vinyet.
struct Vignette: View {
    var body: some View {
        LinearGradient(
            stops: [
                .init(color: Color(hex: 0x121214, alpha: 0), location: 0.4),
                .init(color: Color(hex: 0x121214, alpha: 0.75), location: 1),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }
}

/// Altın çerçeveli küçük rozet.
struct GoldBadge: View {
    let text: String
    var body: some View {
        Text(trUpper(text))
            .font(Typo.labelSm)
            .kerning(1)
            .foregroundStyle(Palette.onGold)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Palette.gold)
            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
    }
}

struct RemoteImage: View {
    let url: String
    var contentMode: ContentMode = .fit

    var body: some View {
        AsyncImage(url: URL(string: url)) { phase in
            switch phase {
            case .success(let image):
                image.resizable().aspectRatio(contentMode: contentMode)
            case .failure:
                Text("Görsel yüklenemedi")
                    .font(Typo.bodySm)
                    .foregroundStyle(Palette.inkFaint)
            default:
                Shimmer()
            }
        }
    }
}

struct LocalImage: View {
    let url: URL
    var body: some View {
        if let image = UIImage(contentsOfFile: url.path) {
            Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
        } else {
            Palette.surface
        }
    }
}

/// Kemikten inciye kayan yükleme yüzeyi.
struct Shimmer: View {
    @State private var shift: CGFloat = -1

    var body: some View {
        GeometryReader { geo in
            LinearGradient(
                colors: [Palette.pearl, Palette.canvas, Palette.pearl],
                startPoint: .leading,
                endPoint: .trailing
            )
            .frame(width: geo.size.width * 2)
            .offset(x: shift * geo.size.width)
            .onAppear {
                withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) {
                    shift = 1
                }
            }
        }
        .background(Palette.pearl)
        .clipped()
    }
}

/// Marka adi tek yerde duruyor. Isim karari netlesince yalnizca burasi
/// degisiyor.
enum Brand {
    static let name = "TryIt"
}

/// Sabit oranli gorsel cercevesi.
///
/// Orani gorselin kendisine vermek yerine esnek bir zemine veriyoruz.
/// `.aspectRatio(_, contentMode: .fill)` dogrudan bir goruntuye verildiginde
/// gorunum onerilen alani doldurmak yerine ondan BUYUYOR; o goruntu bir
/// ZStack'in cocuguysa yigini da buyutuyor ve butun sayfa ekrani tasiyor.
/// Icerik overlay'e alindigi icin yerlesimi hic etkilemiyor.
struct AspectFrame<Content: View>: View {
    var ratio: CGFloat
    var radius: CGFloat = Radius.card
    @ViewBuilder var content: Content

    var body: some View {
        Rectangle()
            .fill(Palette.surfaceLow)
            .aspectRatio(ratio, contentMode: .fit)
            .overlay { content }
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
    }
}

/// Pencerenin ust guvenli alani.
///
/// `fullScreenCover` icindeki govde, zeminde `ignoresSafeArea` varken ust
/// kenar boslugunu almiyor ve icerik durum cubugunun altina giriyor. Degeri
/// dogrudan pencereden okumak bu durumda en kesin yol.
enum SafeArea {
    static var top: CGFloat {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        let window = scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first
        return window?.safeAreaInsets.top ?? 20
    }

    static var bottom: CGFloat {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        let window = scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first
        return window?.safeAreaInsets.bottom ?? 0
    }
}

/// Fotograf yonergelerindeki tek satir. Ikon sabit genislikte duruyor ki
/// metinler alt alta ayni yerden baslasin.
struct PhotoRule: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 9) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Palette.inkFaint)
                .frame(width: 15, alignment: .center)
            Text(text)
                .font(Typo.bodySm)
                .foregroundStyle(Palette.inkSoft)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
    }
}

/// Uretim ve hazirlik sirasinda nabiz gibi atan ince altin halka.
struct PulsingHalo: View {
    @State private var on = false

    var body: some View {
        Circle()
            .strokeBorder(Palette.gold.opacity(on ? 0.15 : 0.7), lineWidth: 1)
            .frame(width: on ? 190 : 96, height: on ? 190 : 96)
            .onAppear {
                withAnimation(.easeOut(duration: 1.8).repeatForever(autoreverses: false)) {
                    on = true
                }
            }
    }
}

/// Tum ekrani kaplayan bekleme perdesi.
///
/// Paylasimdan gelen link cozulurken duruyor. O sirada ekranda hicbir
/// sey olmuyordu: kullanici "Kombine ekle"ye basiyor, birkac saniye
/// bosluk oluyor, sonra bir kutu aciliyordu. Perdenin ikinci bir isi
/// daha var, arkadaki dugmelere dokunmayi engelliyor.
struct BusyOverlay: View {
    let title: String
    let subtitle: String

    var body: some View {
        ZStack {
            Rectangle()
                .fill(Palette.ink.opacity(0.55))
                .ignoresSafeArea()
            PulsingHalo()
            VStack(spacing: 12) {
                Text(trUpper(title))
                    .font(Typo.labelMd)
                    .kerning(2)
                    .foregroundStyle(Palette.white)
                Text(subtitle)
                    .font(Typo.bodySm)
                    .foregroundStyle(Palette.white.opacity(0.7))
            }
            .offset(y: 62)
        }
        .transition(.opacity)
    }
}
