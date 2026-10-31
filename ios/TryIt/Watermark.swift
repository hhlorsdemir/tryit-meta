import UIKit

/// Paylasilan kombin gorseline marka damgasi basar.
///
/// Damga yalnizca paylasilan kopyada; diskteki dosya temiz kaliyor.
/// Insanlar kombini birbirine atarken "bu ne uygulamasi" sorusunun
/// cevabi goruntunun icinde olsun diye duruyor.
///
/// Beyaz yaziyi golgeyle basiyoruz: kombin fotograflari bazen acik bir
/// duvarin, bazen koyu bir mobilyanin onunde cikiyor, dolgulu bir kutu
/// koysak fotografa yapistirilmis etiket gibi duracakti.
enum Watermark {
    static func stamp(_ image: UIImage) -> UIImage {
        let size = image.size
        guard size.width > 0, size.height > 0 else { return image }

        let format = UIGraphicsImageRendererFormat()
        format.scale = image.scale
        format.opaque = false

        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            image.draw(in: CGRect(origin: .zero, size: size))
            draw(in: context.cgContext, size: size)
        }
    }

    private static func draw(in context: CGContext, size: CGSize) {
        // Olculer gorselin kendisine orantili: 1K da 4K da ayni dursun.
        let fontSize = max(11, size.height * 0.021)
        let margin = size.height * 0.024
        let gap = fontSize * 0.42

        let shadow = NSShadow()
        shadow.shadowColor = UIColor.black.withAlphaComponent(0.55)
        shadow.shadowBlurRadius = fontSize * 0.5
        shadow.shadowOffset = CGSize(width: 0, height: fontSize * 0.06)

        let attributes: [NSAttributedString.Key: Any] = [
            .font: font(ofSize: fontSize),
            .foregroundColor: UIColor.white,
            .kern: fontSize * 0.14,
            .shadow: shadow,
        ]

        let text = NSAttributedString(string: "TRYIT", attributes: attributes)
        let textSize = text.size()

        let markSize = fontSize * 1.15
        let totalWidth = markSize + gap + textSize.width
        let originX = size.width - margin - totalWidth
        let baseline = size.height - margin - textSize.height

        if let hanger = UIImage(systemName: "hanger")?
            .withConfiguration(UIImage.SymbolConfiguration(pointSize: markSize, weight: .medium))
            .withTintColor(.white, renderingMode: .alwaysOriginal) {
            let box = CGRect(
                x: originX,
                y: baseline + (textSize.height - markSize) / 2,
                width: markSize,
                height: markSize
            )
            context.saveGState()
            context.setShadow(
                offset: shadow.shadowOffset,
                blur: shadow.shadowBlurRadius,
                color: UIColor.black.withAlphaComponent(0.55).cgColor
            )
            hanger.draw(in: box)
            context.restoreGState()
        }

        text.draw(at: CGPoint(x: originX + markSize + gap, y: baseline))
    }

    /// Uygulamanin yazi tipi, bulunamazsa sistemin.
    ///
    /// Degisken yazi tipinin PostScript adi surume gore degisebiliyor,
    /// o yuzden once aileyi deniyoruz.
    private static func font(ofSize size: CGFloat) -> UIFont {
        for name in ["PlusJakartaSans-Bold", "PlusJakartaSans-SemiBold", "PlusJakartaSans-Regular"] {
            if let font = UIFont(name: name, size: size) { return font }
        }
        let descriptor = UIFontDescriptor(fontAttributes: [.family: "Plus Jakarta Sans"])
        let family = UIFont(descriptor: descriptor, size: size)
        if family.familyName == "Plus Jakarta Sans" {
            return UIFont(descriptor: descriptor.withSymbolicTraits(.traitBold) ?? descriptor, size: size)
        }
        return .systemFont(ofSize: size, weight: .semibold)
    }
}
