import SwiftUI
import WebKit
import HealthKit

// Native shell around the live site: same app, plus a `health` message handler
// the web code calls when a workout is finished (see doFinishWorkout in sheets.jsx).
let siteURL = URL(string: "https://opengym-alpha-seven.vercel.app")!

@main
struct OpenGymApp: App {
    var body: some Scene {
        WindowGroup {
            WebView().ignoresSafeArea()
        }
    }
}

struct WebView: UIViewRepresentable {
    func makeCoordinator() -> HealthBridge { HealthBridge() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(context.coordinator, name: "health")
        let web = WKWebView(frame: .zero, configuration: config)
        // Let the page's CSS env(safe-area-inset-*) handle the notch, like the Home Screen app.
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsBackForwardNavigationGestures = false
        web.load(URLRequest(url: siteURL))
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {}
}

final class HealthBridge: NSObject, WKScriptMessageHandler {
    let store = HKHealthStore()

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let startMs = body["start"] as? Double,
              let endMs = body["end"] as? Double,
              endMs > startMs else { return }
        let start = Date(timeIntervalSince1970: startMs / 1000)
        let end = Date(timeIntervalSince1970: endMs / 1000)
        Task { [store] in
            do {
                try await store.requestAuthorization(toShare: [HKObjectType.workoutType()], read: [])
                let config = HKWorkoutConfiguration()
                config.activityType = .traditionalStrengthTraining
                let builder = HKWorkoutBuilder(healthStore: store, configuration: config, device: .local())
                try await builder.beginCollection(at: start)
                try await builder.endCollection(at: end)
                _ = try await builder.finishWorkout()
            } catch {
                print("Health save failed: \(error)")
            }
        }
    }
}
