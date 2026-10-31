import SwiftUI

@main
struct TryItApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                // Paylaş menüsünden gelen linkler uygulama her öne
                // geldiğinde alınıyor. Sadece açılışta baksaydık,
                // uygulama arka planda dururken paylaşılan link
                // kullanıcı onu kapatıp açana kadar görünmezdi.
                .task { await model.checkSharedLinks() }
                .task { await model.startPurchases() }
                .onChange(of: phase) { _, now in
                    guard now == .active else { return }
                    Task { await model.checkSharedLinks() }
                    // Ay dönmüş ya da abonelik başka cihazda alınmış olabilir.
                    Task {
                        await model.purchases.refreshEntitlement()
                        await model.refreshCredits()
                    }
                }
        }
    }
}
