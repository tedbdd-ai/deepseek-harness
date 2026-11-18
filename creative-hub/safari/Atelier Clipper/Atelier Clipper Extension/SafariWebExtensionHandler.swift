import Foundation
import SafariServices

/// Answers `browser.runtime.sendNativeMessage` from the Atelier Clipper. The only request is
/// `{type: "token"}`: it returns the Creativity Hub token from `~/.creativity-hub/launcher-token`
/// (readable through the sandbox exception in the entitlements), so the user never types it.
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey] as? [String: Any]
        let answer: [String: Any]
        if message?["type"] as? String == "token" {
            answer = Self.token()
        } else {
            answer = ["error": "Unbekannte Anfrage."]
        }
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: answer]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

    /// The sandbox redirects `NSHomeDirectory()` into the container; the token lives in the real home.
    private static func token() -> [String: Any] {
        guard let entry = getpwuid(getuid()), let home = entry.pointee.pw_dir else { return ["error": "Home-Ordner nicht gefunden."] }
        let path = String(cString: home) + "/.creativity-hub/launcher-token"
        do {
            let token = try String(contentsOfFile: path, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
            return token.isEmpty ? ["error": "Die Schlüsseldatei ist leer."] : ["token": token]
        } catch {
            return ["error": "~/.creativity-hub/launcher-token fehlt. Starte den Hub einmal mit start.command."]
        }
    }
}
