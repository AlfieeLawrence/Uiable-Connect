import Foundation
import Capacitor
import Citadel
import Crypto
import NIO
import NIOSSH
import Security

/// Native SSH for Uiable Connect on iPhone/iPad. Mirrors the Android plugin (SshCore.java) method for method.
@objc(UiableSshPlugin)
public class UiableSshPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "UiableSshPlugin"
    public let jsName = "UiableSsh"
    public let pluginMethods: [CAPPluginMethod] = [
        "test", "connect", "disconnect", "exec", "shellOpen", "shellWrite", "shellResize", "shellClose",
        "sftpRealpath", "sftpList", "sftpStat", "sftpMkdir", "sftpRename", "sftpRemove", "sftpRead", "sftpWrite",
        "forwardStart", "forwardStop", "portFree", "secretGet", "secretSet",
    ].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }

    private let core = SshStore()

    private func run(_ call: CAPPluginCall, _ body: @escaping (CAPPluginCall) async throws -> [String: Any]?) {
        Task {
            do { call.resolve(try await body(call) ?? [:]) }
            catch { call.reject(SshStore.describe(error)) }
        }
    }
    private func auth(_ c: CAPPluginCall) -> SshAuth {
        SshAuth(host: c.getString("host") ?? "", port: c.getInt("port") ?? 22, username: c.getString("username") ?? "",
                password: c.getString("password"), privateKey: c.getString("privateKey"), passphrase: c.getString("passphrase"), hostKey: c.getString("hostKey"))
    }
    private func id(_ c: CAPPluginCall) -> String { c.getString("id") ?? "" }

    public override func load() {
        core.onShellData = { [weak self] id, sid, data in self?.notifyListeners("shellData", data: ["id": id, "sid": sid, "data": data]) }
        core.onShellExit = { [weak self] id, sid in self?.notifyListeners("shellExit", data: ["id": id, "sid": sid]) }
        core.onClosed = { [weak self] id in self?.notifyListeners("closed", data: ["id": id]) }
    }

    @objc func test(_ call: CAPPluginCall) { run(call) { c in ["info": try await self.core.test(self.auth(c))] } }
    @objc func connect(_ call: CAPPluginCall) { run(call) { c in try await self.core.connect(self.id(c), self.auth(c)); return nil } }
    @objc func disconnect(_ call: CAPPluginCall) { run(call) { c in await self.core.disconnect(self.id(c)); return nil } }
    @objc func exec(_ call: CAPPluginCall) { run(call) { c in
        let r = try await self.core.exec(self.id(c), c.getString("cmd") ?? "", timeoutMs: c.getInt("timeout") ?? 20000)
        return ["code": r.code, "out": r.out, "err": r.err] } }
    @objc func shellOpen(_ call: CAPPluginCall) { run(call) { c in
        try await self.core.shellOpen(self.id(c), sid: c.getString("sid") ?? "", cols: c.getInt("cols") ?? 80, rows: c.getInt("rows") ?? 24); return nil } }
    @objc func shellWrite(_ call: CAPPluginCall) { run(call) { c in try await self.core.shellWrite(self.id(c), sid: c.getString("sid") ?? "", data: c.getString("data") ?? ""); return nil } }
    @objc func shellResize(_ call: CAPPluginCall) { run(call) { c in try await self.core.shellResize(self.id(c), sid: c.getString("sid") ?? "", cols: c.getInt("cols") ?? 80, rows: c.getInt("rows") ?? 24); return nil } }
    @objc func shellClose(_ call: CAPPluginCall) { run(call) { c in await self.core.shellClose(self.id(c), sid: c.getString("sid") ?? ""); return nil } }
    @objc func sftpRealpath(_ call: CAPPluginCall) { run(call) { c in ["path": try await self.core.realpath(self.id(c), c.getString("path") ?? ".")] } }
    @objc func sftpList(_ call: CAPPluginCall) { run(call) { c in ["items": try await self.core.list(self.id(c), c.getString("path") ?? "/")] } }
    @objc func sftpStat(_ call: CAPPluginCall) { run(call) { c in let s = try await self.core.stat(self.id(c), c.getString("path") ?? ""); return ["size": s.size, "dir": s.dir] } }
    @objc func sftpMkdir(_ call: CAPPluginCall) { run(call) { c in try await self.core.mkdir(self.id(c), c.getString("path") ?? ""); return nil } }
    @objc func sftpRename(_ call: CAPPluginCall) { run(call) { c in try await self.core.rename(self.id(c), c.getString("from") ?? "", c.getString("to") ?? ""); return nil } }
    @objc func sftpRemove(_ call: CAPPluginCall) { run(call) { c in try await self.core.remove(self.id(c), c.getString("path") ?? ""); return nil } }
    @objc func sftpRead(_ call: CAPPluginCall) { run(call) { c in
        let d = try await self.core.read(self.id(c), c.getString("path") ?? "", offset: UInt64(c.getDouble("offset") ?? 0), length: UInt32(c.getInt("length") ?? 524288))
        return ["data": d.base64EncodedString(), "bytes": d.count] } }
    @objc func sftpWrite(_ call: CAPPluginCall) { run(call) { c in
        let d = Data(base64Encoded: c.getString("data") ?? "") ?? Data()
        try await self.core.write(self.id(c), c.getString("path") ?? "", data: d, append: c.getBool("append") ?? false); return nil } }
    @objc func forwardStart(_ call: CAPPluginCall) { run(call) { c in
        try await self.core.forwardStart(self.id(c), fid: c.getString("fid") ?? "", localPort: c.getInt("localPort") ?? 0,
                                         remoteHost: c.getString("remoteHost") ?? "127.0.0.1", remotePort: c.getInt("remotePort") ?? 0); return nil } }
    @objc func forwardStop(_ call: CAPPluginCall) { run(call) { c in await self.core.forwardStop(self.id(c), fid: c.getString("fid") ?? ""); return nil } }
    @objc func portFree(_ call: CAPPluginCall) { run(call) { c in ["free": SshStore.portFree(c.getInt("port") ?? 0)] } }

    // ---- secrets in the iOS Keychain (this device only, available after first unlock)
    private func kcQuery(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.alfie.uiableconnect", kSecAttrAccount as String: key]
    }
    @objc func secretSet(_ call: CAPPluginCall) {
        let key = call.getString("key") ?? "", value = Data((call.getString("value") ?? "").utf8)
        SecItemDelete(kcQuery(key) as CFDictionary)
        var q = kcQuery(key); q[kSecValueData as String] = value
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let st = SecItemAdd(q as CFDictionary, nil)
        st == errSecSuccess ? call.resolve() : call.reject("Keychain error \(st)")
    }
    @objc func secretGet(_ call: CAPPluginCall) {
        var q = kcQuery(call.getString("key") ?? ""); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        let st = SecItemCopyMatching(q as CFDictionary, &out)
        if st == errSecSuccess, let d = out as? Data { call.resolve(["value": String(decoding: d, as: UTF8.self)]) }
        else if st == errSecItemNotFound { call.resolve(["value": NSNull()]) }
        else { call.reject("Keychain error \(st)") }
    }
}
