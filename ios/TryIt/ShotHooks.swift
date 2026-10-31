import Foundation

/// Mağaza ekran görüntüleri için açılış parametreleri.
///
/// Görüntüler 11 dilde alınıyor; her ekrana elle dokunarak gitmek hem uzun
/// hem kırılgan. Bu parametrelerle her ekran tek komutla açılıyor. Yalnızca
/// geliştirme derlemesinde çalışıyor, App Store sürümünde hepsi etkisiz.
enum Shot {
    static func has(_ flag: String) -> Bool {
        #if DEBUG
        return ProcessInfo.processInfo.arguments.contains(flag)
        #else
        return false
        #endif
    }

    /// `-shotPage 2` gibi bir parametrenin sayısal değeri.
    static func int(_ flag: String) -> Int? {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        guard let at = args.firstIndex(of: flag), at + 1 < args.count else { return nil }
        return Int(args[at + 1])
        #else
        return nil
        #endif
    }
}
