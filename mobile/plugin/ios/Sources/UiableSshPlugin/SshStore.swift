import Foundation
import Citadel
import Crypto
import NIO
import NIOSSH

// Capacitor-free SSH core for iOS (also builds on Linux/macOS so it can be tested with `swift build`).
struct SshAuth { let host: String; let port: Int; let username: String; let password: String?; let privateKey: String?; let passphrase: String? }
struct ExecResult { let code: Int; let out: String; let err: String }
struct SshError: LocalizedError { let message: String; var errorDescription: String? { message } }

final class SshStore: @unchecked Sendable {
    var onShellData: ((String, String, String) -> Void)?
    var onShellExit: ((String, String) -> Void)?
    var onClosed: ((String) -> Void)?

    private final class Conn: @unchecked Sendable {
        let client: SSHClient
        var sftp: SFTPClient?
        var shells: [String: (writer: TTYStdinWriter, task: Task<Void, Never>)] = [:]
        var forwards: [String: Channel] = [:]
        var closing = false
        init(_ c: SSHClient) { client = c }
    }
    private var conns: [String: Conn] = [:]
    private let lock = NSLock()
    private func get(_ id: String) throws -> Conn {
        lock.lock(); defer { lock.unlock() }
        guard let c = conns[id], c.client.isConnected else { throw SshError(message: "Not connected") }
        return c
    }

    static func describe(_ e: Error) -> String {
        if let s = e as? SshError { return s.message }
        if let f = e as? SSHClient.CommandFailed { return "Command failed with exit code \(f.exitCode)" }
        let d = String(describing: e)
        if d.contains("allAuthenticationOptionsFailed") || d.contains("authentication") { return "All configured authentication methods failed" }
        if d.contains("connectTimeout") || d.contains("timeout") { return "Connection timed out" }
        if d.contains("connectionRefused") || d.contains("ECONNREFUSED") { return "Connection refused" }
        return (e as? LocalizedError)?.errorDescription ?? d
    }

    private static func method(_ a: SshAuth) throws -> SSHAuthenticationMethod {
        guard let key = a.privateKey, !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return .passwordBased(username: a.username, password: a.password ?? "")
        }
        let pp = (a.passphrase?.isEmpty == false) ? Data(a.passphrase!.utf8) : nil
        if key.contains("BEGIN RSA PRIVATE KEY") || key.contains("BEGIN PRIVATE KEY") {
            throw SshError(message: "On iPhone/iPad keys must be in OpenSSH format. Convert with: ssh-keygen -p -f yourkey")
        }
        if let k = try? Curve25519.Signing.PrivateKey(sshEd25519: key, decryptionKey: pp) { return .ed25519(username: a.username, privateKey: k) }
        if let k = try? Insecure.RSA.PrivateKey(sshRsa: key, decryptionKey: pp) { return .rsa(username: a.username, privateKey: k) }
        throw SshError(message: "Could not read the private key (wrong passphrase, or not an ed25519/RSA OpenSSH key)")
    }
    private static func open(_ a: SshAuth) async throws -> SSHClient {
        let m = try method(a)
        let isRsa = (a.privateKey ?? "").isEmpty == false && (try? Curve25519.Signing.PrivateKey(sshEd25519: a.privateKey!, decryptionKey: (a.passphrase?.isEmpty == false) ? Data(a.passphrase!.utf8) : nil)) == nil
        do {
            return try await SSHClient.connect(host: a.host, port: a.port, authenticationMethod: m,
                                    hostKeyValidator: .acceptAnything(), // same as desktop: trust on first use
                                    reconnect: .never, connectTimeout: .seconds(15))
        } catch {
            // Citadel signs RSA with legacy ssh-rsa (SHA-1), which OpenSSH 8.8+ refuses by default.
            if isRsa && describe(error).contains("authentication") {
                throw SshError(message: "The server refused this RSA key. On iPhone/iPad use an ed25519 key (ssh-keygen -t ed25519) or a password")
            }
            throw error
        }
    }

    func test(_ a: SshAuth) async throws -> String {
        let c = try await Self.open(a)
        defer { Task { try? await c.close() } }
        let r = try await Self.exec(c, "uname -sr; hostname", timeoutMs: 20000)
        return r.out.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "\n", with: " · ")
    }
    func connect(_ id: String, _ a: SshAuth) async throws {
        await disconnect(id)
        let client = try await Self.open(a)
        let c = Conn(client)
        lock.lock(); conns[id] = c; lock.unlock()
        client.onDisconnect { [weak self] in
            guard let self else { return }
            self.lock.lock(); let mine = self.conns[id] === c; if mine { self.conns[id] = nil }; self.lock.unlock()
            for ch in c.forwards.values { ch.close(promise: nil) }
            if mine && !c.closing { self.onClosed?(id) }
        }
    }
    func disconnect(_ id: String) async {
        lock.lock(); let c = conns.removeValue(forKey: id); lock.unlock()
        guard let c else { return }
        c.closing = true
        for s in c.shells.values { s.task.cancel() }
        for ch in c.forwards.values { try? await ch.close() }
        try? await c.sftp?.close()
        try? await c.client.close()
    }

    // ---- exec (collects stdout/stderr, exit code from CommandFailed)
    func exec(_ id: String, _ cmd: String, timeoutMs: Int) async throws -> ExecResult { try await Self.exec(try get(id).client, cmd, timeoutMs: timeoutMs) }
    static func exec(_ c: SSHClient, _ cmd: String, timeoutMs: Int) async throws -> ExecResult {
        try await withThrowingTaskGroup(of: ExecResult.self) { g in
            g.addTask {
                var out = ByteBuffer(), err = ByteBuffer(), code = 0
                do {
                    for try await chunk in try await c.executeCommandStream(cmd) {
                        switch chunk { case .stdout(var b): out.writeBuffer(&b); case .stderr(var b): err.writeBuffer(&b) }
                    }
                } catch let f as SSHClient.CommandFailed { code = f.exitCode }
                return ExecResult(code: code, out: String(buffer: out), err: String(buffer: err))
            }
            g.addTask { try await Task.sleep(nanoseconds: UInt64(max(timeoutMs, 1000)) * 1_000_000); throw SshError(message: "Command timed out") }
            let r = try await g.next()!; g.cancelAll(); return r
        }
    }

    // ---- PTY shell: runs in a task; writer kept for input/resize
    func shellOpen(_ id: String, sid: String, cols: Int, rows: Int) async throws {
        let c = try get(id)
        let ready = AsyncThrowingStream<TTYStdinWriter, Error>.makeStream()
        let task = Task { [weak self] in
            var dec = Utf8Stream()
            do {
                let req = SSHChannelRequestEvent.PseudoTerminalRequest(wantReply: true, term: "xterm-256color",
                    terminalCharacterWidth: cols, terminalRowHeight: rows, terminalPixelWidth: 0, terminalPixelHeight: 0, terminalModes: .init([:]))
                try await c.client.withPTY(req) { inbound, outbound in
                    ready.continuation.yield(outbound); ready.continuation.finish()
                    for try await chunk in inbound {
                        switch chunk { case .stdout(let b), .stderr(let b):
                            let s = dec.push(Array(b.readableBytesView)); if !s.isEmpty { self?.onShellData?(id, sid, s) } }
                    }
                }
            } catch { ready.continuation.finish(throwing: error) }
            self?.lock.lock(); c.shells[sid] = nil; self?.lock.unlock()
            self?.onShellExit?(id, sid)
        }
        var it = ready.stream.makeAsyncIterator()
        guard let w = try await it.next() else { throw SshError(message: "Could not open a shell") }
        lock.lock(); c.shells[sid] = (w, task); lock.unlock()
    }
    private func shell(_ id: String, _ sid: String) throws -> TTYStdinWriter? { let c = try get(id); lock.lock(); defer { lock.unlock() }; return c.shells[sid]?.writer }
    func shellWrite(_ id: String, sid: String, data: String) async throws { try await shell(id, sid)?.write(ByteBuffer(string: data)) }
    func shellResize(_ id: String, sid: String, cols: Int, rows: Int) async throws { try await shell(id, sid)?.changeSize(cols: cols, rows: rows, pixelWidth: 0, pixelHeight: 0) }
    func shellClose(_ id: String, sid: String) async { guard let c = try? get(id) else { return }; lock.lock(); let s = c.shells[sid]; lock.unlock(); s?.task.cancel() }

    // ---- SFTP
    private func sftp(_ id: String) async throws -> SFTPClient {
        let c = try get(id)
        if let s = c.sftp, s.isActive { return s }
        let s = try await c.client.openSFTP(); c.sftp = s; return s
    }
    func realpath(_ id: String, _ p: String) async throws -> String { try await sftp(id).getRealPath(atPath: p) }
    func list(_ id: String, _ p: String) async throws -> [[String: Any]] {
        var out: [[String: Any]] = []
        for name in try await sftp(id).listDirectory(atPath: p) {
            for e in name.components where e.filename != "." && e.filename != ".." {
                out.append(["name": e.filename, "size": Double(e.attributes.size ?? 0), "mode": Int(e.attributes.permissions ?? 0),
                            "mtime": e.attributes.accessModificationTime?.modificationTime.timeIntervalSince1970 ?? 0])
            }
        }
        return out
    }
    func stat(_ id: String, _ p: String) async throws -> (size: Double, dir: Bool) {
        let a = try await sftp(id).getAttributes(at: p)
        return (Double(a.size ?? 0), ((a.permissions ?? 0) & 0o170000) == 0o040000)
    }
    func mkdir(_ id: String, _ p: String) async throws { try await sftp(id).createDirectory(atPath: p) }
    func rename(_ id: String, _ a: String, _ b: String) async throws { try await sftp(id).rename(at: a, to: b) }
    func remove(_ id: String, _ p: String) async throws { try await sftp(id).remove(at: p) }
    func read(_ id: String, _ p: String, offset: UInt64, length: UInt32) async throws -> Data {
        let f = try await sftp(id).openFile(filePath: p, flags: .read)
        var out = Data()
        do {
            while out.count < Int(length) { // servers cap each read (~32-256 KB), so loop
                let b = try await f.read(from: offset + UInt64(out.count), length: length - UInt32(out.count))
                if b.readableBytes == 0 { break }
                out.append(contentsOf: b.readableBytesView)
            }
        } catch { try? await f.close(); if out.isEmpty { throw error } else { return out } }
        try await f.close(); return out
    }
    func write(_ id: String, _ p: String, data: Data, append: Bool) async throws {
        let s = try await sftp(id)
        var off: UInt64 = 0
        if append { off = (try? await s.getAttributes(at: p).size) ?? 0 }
        let f = try await s.openFile(filePath: p, flags: append ? [.write, .create] : [.write, .create, .truncate])
        do {
            var i = 0; let step = 32 * 1024
            while i < data.count { let end = min(i + step, data.count)
                try await f.write(ByteBuffer(bytes: data[i..<end]), at: off + UInt64(i)); i = end }
        } catch { try? await f.close(); throw error }
        try await f.close()
    }

    // ---- local port forward: NIO listener on 127.0.0.1:localPort, each socket glued to a direct-tcpip channel
    func forwardStart(_ id: String, fid: String, localPort: Int, remoteHost: String, remotePort: Int) async throws {
        let c = try get(id)
        lock.lock(); let exists = c.forwards[fid] != nil; lock.unlock(); if exists { return }
        let client = c.client
        let bootstrap = ServerBootstrap(group: MultiThreadedEventLoopGroup.singleton)
            .serverChannelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
            .childChannelOption(ChannelOptions.autoRead, value: false)
            .childChannelInitializer { local in
                let origin = (try? SocketAddress(ipAddress: "127.0.0.1", port: 0))!
                let settings = SSHChannelType.DirectTCPIP(targetHost: remoteHost, targetPort: remotePort, originatorAddress: local.remoteAddress ?? origin)
                let p = local.eventLoop.makePromise(of: Void.self)
                p.completeWithTask {
                    let (a, b) = Glue.pair()
                    _ = try await client.createDirectTCPIPChannel(using: settings) { remote in remote.pipeline.addHandler(b) }
                    try await local.pipeline.addHandler(a).get()
                    // autoRead stays off until both ends are glued, so no early bytes are dropped
                    try await local.setOption(ChannelOptions.autoRead, value: true).get()
                }
                return p.futureResult.flatMapError { _ in local.close() }
            }
        let server: Channel
        do { server = try await bootstrap.bind(host: "127.0.0.1", port: localPort).get() }
        catch { throw SshError(message: "Local port \(localPort) is already in use on this device") }
        lock.lock(); c.forwards[fid] = server; lock.unlock()
    }
    func forwardStop(_ id: String, fid: String) async {
        lock.lock(); let ch = conns[id]?.forwards.removeValue(forKey: fid); lock.unlock()
        try? await ch?.close()
    }
    static func portFree(_ port: Int) -> Bool {
        guard let ch = try? ServerBootstrap(group: MultiThreadedEventLoopGroup.singleton).bind(host: "127.0.0.1", port: port).wait() else { return false }
        try? ch.close().wait(); return true
    }
}

/// Incremental UTF-8 decoder so multi-byte characters split across packets don't turn into �.
struct Utf8Stream {
    private var pending: [UInt8] = []
    mutating func push(_ bytes: [UInt8]) -> String {
        var all = pending + bytes; pending = []
        var cut = all.count, i = all.count - 1, back = 0
        while i >= 0 && back < 4 { let b = all[i]
            if b & 0xC0 == 0x80 { i -= 1; back += 1; continue }
            let need = b >= 0xF0 ? 4 : b >= 0xE0 ? 3 : b >= 0xC0 ? 2 : 1
            if all.count - i < need { cut = i }
            break }
        if cut < all.count { pending = Array(all[cut...]); all.removeSubrange(cut...) }
        return String(decoding: all, as: UTF8.self)
    }
}

/// Two-way pipe between the local TCP socket (ByteBuffer) and the SSH direct-tcpip channel (ByteBuffer after Citadel's codec).
final class Glue: ChannelDuplexHandler, @unchecked Sendable {
    typealias InboundIn = ByteBuffer; typealias OutboundIn = ByteBuffer; typealias OutboundOut = ByteBuffer
    private var partner: Glue?; private var ctx: ChannelHandlerContext?; private var loop: EventLoop?; private var pendingRead = false
    // The local socket and the SSH channel live on different event loops, so every cross call hops onto the owner's loop.
    private var writableFlag = true  // optimistic: a fresh SSH child channel can report not-writable before it is active
    static func pair() -> (Glue, Glue) { let a = Glue(), b = Glue(); a.partner = b; b.partner = a; return (a, b) }
    private func onLoop(_ f: @escaping () -> Void) { guard let l = loop else { return }; if l.inEventLoop { f() } else { l.execute(f) } }
    func handlerAdded(context: ChannelHandlerContext) { ctx = context; loop = context.eventLoop; partner?.partnerBecameWritable() }
    func handlerRemoved(context: ChannelHandlerContext) { ctx = nil; partner = nil }
    private func partnerWrite(_ d: NIOAny) { onLoop { self.ctx?.write(d, promise: nil) } }
    private func partnerFlush() { onLoop { self.ctx?.flush() } }
    private func partnerClose() { onLoop { self.ctx?.close(promise: nil) } }
    private func partnerBecameWritable() { onLoop { if self.pendingRead { self.pendingRead = false; self.ctx?.read() } } }
    private var partnerWritable: Bool { writableFlag }
    func channelRead(context: ChannelHandlerContext, data: NIOAny) { partner?.partnerWrite(data) }
    func channelReadComplete(context: ChannelHandlerContext) { partner?.partnerFlush() }
    func channelInactive(context: ChannelHandlerContext) { partner?.partnerClose() }
    func errorCaught(context: ChannelHandlerContext, error: Error) { context.close(promise: nil) }
    func channelWritabilityChanged(context: ChannelHandlerContext) { writableFlag = context.channel.isWritable; if writableFlag { partner?.partnerBecameWritable() } }
    func read(context: ChannelHandlerContext) { context.read() }
}
