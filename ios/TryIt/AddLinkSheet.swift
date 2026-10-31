import SwiftUI
import UIKit

struct AddLinkSheet: View {
    let resolving: Bool
    let onSubmit: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var link = ""
    @FocusState private var focused: Bool

    /// `hasURLs` ve `hasStrings` pano icerigini okumuyor, yalnizca ne tur
    /// veri oldugunu soyluyor; bu yuzden sistemin yapistirma uyarisini
    /// tetiklemiyorlar.
    private var clipboardHasLink: Bool {
        UIPasteboard.general.hasURLs || UIPasteboard.general.hasStrings
    }

    var body: some View {
        ZStack {
            Palette.canvas.ignoresSafeArea()

            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Yeni Parça Ekle")
                        .font(Typo.headlineMd(21))
                        .foregroundStyle(Palette.ink)
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Palette.inkFaint)
                            .padding(8)
                            .background(Palette.pearl)
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                }

                Text("Beğendiğin ürünün web adresini yapıştır, parçayı gardırobuna alalım.")
                    .font(Typo.bodyMd)
                    .foregroundStyle(Palette.inkSoft)

                HStack(spacing: 10) {
                    TextField(text: $link) { Text(verbatim: "https://") }
                        .font(Typo.bodyLg)
                        .foregroundStyle(Palette.ink)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .submitLabel(.go)
                        .focused($focused)
                        .onSubmit(submit)
                        .padding(15)
                        .background(Palette.field)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.base, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: Radius.base, style: .continuous)
                                .strokeBorder(focused ? Palette.ink : .clear, lineWidth: 1.5)
                        )

                    if clipboardHasLink {
                        // Sistemin kendi yapistirma dugmesi: panoyu kendimiz
                        // okusaydik iOS her seferinde izin soruyordu.
                        PasteButton(payloadType: String.self) { strings in
                            guard let first = strings.first else { return }
                            // Kapanis ana aktorde calismiyor.
                            Task { @MainActor in
                                link = first.trimmingCharacters(in: .whitespacesAndNewlines)
                            }
                        }
                        .labelStyle(.iconOnly)
                        .buttonBorderShape(.circle)
                        .tint(Palette.ink)
                    }
                }

                if resolving {
                    HStack(spacing: 9) {
                        ProgressView().controlSize(.small).tint(Palette.inkFaint)
                        Text("Ürün sayfası okunuyor")
                            .font(Typo.bodyMd)
                            .foregroundStyle(Palette.inkSoft)
                    }
                }

                Button(trUpper(String(localized: "Parçayı Gardroba Ekle")), action: submit)
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(link.trimmingCharacters(in: .whitespaces).isEmpty)

                Text("Üst, alt ve ayakkabı otomatik ayrılıyor.")
                    .font(Typo.bodySm)
                    .foregroundStyle(Palette.inkFaint)
                    .frame(maxWidth: .infinity)

                Spacer(minLength: 0)
            }
            .padding(20)
        }
        .presentationDetents([.height(340)])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(Radius.sheet)
        .onAppear { focused = true }
    }

    private func submit() {
        let trimmed = link.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        onSubmit(trimmed)
        dismiss()
    }
}
