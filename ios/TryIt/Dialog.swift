import SwiftUI

/// Uygulamanin kendi soru kutusu.
///
/// Sistemin hazir kutulari mavi tonlari, yuvarlak kenarlari ve kendi
/// yazi tipiyle geliyor; uygulamanin geri kalani krem zemin, obsidyen
/// cizgi ve Plus Jakarta Sans. Arada gozle gorulur bir kopukluk vardi.
///
/// Kamera ve galeri secicileri sistemin kalmaya devam ediyor: onlar
/// sistemin kendi verisine dokunuyor, taklit etmek dogru olmaz.

/// Kutudaki tek bir secenek.
struct DialogAction: Identifiable {
    enum Kind {
        /// Dolgulu, one cikan secenek.
        case primary
        /// Cerceveli, sira disi olmayan secenek.
        case normal
        /// Geri donusu olmayan secenek.
        case destructive
    }

    let id = UUID()
    let title: String
    let icon: String?
    let kind: Kind
    let handler: () -> Void

    init(_ title: String, icon: String? = nil, kind: Kind = .normal, handler: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.kind = kind
        self.handler = handler
    }
}

/// Ekranda duran kutunun icerigi.
struct DialogContent: Identifiable {
    let id = UUID()
    let title: String
    let message: String?
    let actions: [DialogAction]
    /// Vazgecme metni. Bos birakilirsa kutu yalnizca disina dokununca kapanir.
    let cancelTitle: String?
    /// Vazgecildiginde calisacak is. Disina dokunmak da bunu tetikliyor.
    let onCancel: (() -> Void)?

    init(
        title: String,
        message: String? = nil,
        cancelTitle: String? = String(localized: "Vazgeç"),
        onCancel: (() -> Void)? = nil,
        actions: [DialogAction]
    ) {
        self.title = title
        self.message = message
        self.cancelTitle = cancelTitle
        self.onCancel = onCancel
        self.actions = actions
    }
}

/// Acik kutuyu tutan ortak yer.
///
/// Kutu RootView'in en ustunde ciziliyor, cunku sekme cubugunu ve
/// baslik seridini de ortmesi gerekiyor. Icerigi isteyen ekranlar ise
/// daha asagida; aradaki baglantiyi bu tutuyor.
@MainActor
@Observable
final class DialogCenter {
    var content: DialogContent?

    func show(_ content: DialogContent) {
        self.content = content
    }

    func dismiss() {
        content = nil
    }
}

/// Kutuyu cizen bindirme. RootView bir kez kuruyor.
struct DialogHost: View {
    @Bindable var center: DialogCenter

    var body: some View {
        ZStack(alignment: .bottom) {
            if let content = center.content {
                Color.black.opacity(0.28)
                    .ignoresSafeArea()
                    .onTapGesture { cancel(content) }
                    .transition(.opacity)

                card(content)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: 0.22), value: center.content?.id)
    }

    private func card(_ content: DialogContent) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Text(content.title)
                    .font(Typo.headlineMd(20))
                    .foregroundStyle(Palette.ink)
                if let message = content.message {
                    Text(message)
                        .font(Typo.bodyMd)
                        .foregroundStyle(Palette.inkFaint)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            VStack(spacing: 10) {
                ForEach(content.actions) { action in
                    button(action)
                }

                if let cancelTitle = content.cancelTitle {
                    Button {
                        cancel(content)
                    } label: {
                        Text(trUpper(cancelTitle))
                            .font(Typo.labelMd)
                            .foregroundStyle(Palette.inkFaint)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(22)
        .padding(.bottom, SafeArea.bottom > 0 ? SafeArea.bottom - 8 : 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.canvas)
        .clipShape(
            UnevenRoundedRectangle(
                topLeadingRadius: Radius.sheet,
                topTrailingRadius: Radius.sheet,
                style: .continuous
            )
        )
        .overlay(alignment: .top) {
            Rectangle().fill(Palette.hairline).frame(height: 1)
        }
        .ignoresSafeArea(edges: .bottom)
    }

    @ViewBuilder
    private func button(_ action: DialogAction) -> some View {
        let label = HStack(spacing: 8) {
            if let icon = action.icon {
                Image(systemName: icon).font(.system(size: 13, weight: .semibold))
            }
            Text(trUpper(action.title))
        }

        switch action.kind {
        case .primary:
            Button {
                center.dismiss()
                action.handler()
            } label: { label }
                .buttonStyle(PrimaryButtonStyle())
        case .normal:
            Button {
                center.dismiss()
                action.handler()
            } label: { label }
                .buttonStyle(SecondaryButtonStyle())
        case .destructive:
            Button {
                center.dismiss()
                action.handler()
            } label: {
                label
                    .font(Typo.labelMd)
                    .foregroundStyle(Palette.errorInk)
                    .frame(maxWidth: .infinity, minHeight: 46)
                    .background(Palette.errorBg)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.base, style: .continuous))
            }
            .buttonStyle(.plain)
        }
    }

    private func cancel(_ content: DialogContent) {
        center.dismiss()
        content.onCancel?()
    }
}
