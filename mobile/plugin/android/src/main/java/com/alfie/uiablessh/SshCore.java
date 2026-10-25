package com.alfie.uiablessh;

import com.jcraft.jsch.*;
import java.io.*;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** Plain-Java SSH core (no Android imports) so it can be unit-tested on a desktop JVM. */
public class SshCore {
    public interface Events {
        void shellData(String id, String sid, String data);
        void shellExit(String id, String sid);
        void closed(String id);
    }
    public static class Auth { public String host, username, password, privateKey, passphrase; public int port = 22; public String hostKey; }
    public static class ExecResult { public int code; public String out, err; }
    public static class Entry { public String name; public long size, mtime; public int mode; }

    static class Conn {
        Session session; ChannelSftp sftp; final Map<String, ChannelShell> shells = new ConcurrentHashMap<>();
        final Map<String, Integer> forwards = new ConcurrentHashMap<>(); volatile boolean closing;
    }
    private final Map<String, Conn> conns = new ConcurrentHashMap<>();
    private final Events ev;
    public SshCore(Events ev) { this.ev = ev; }

    private static Session open(Auth a) throws Exception {
        JSch j = new JSch(); Tofu tofu = new Tofu(a.hostKey); j.setHostKeyRepository(tofu);
        if (a.privateKey != null && !a.privateKey.isEmpty()) {
            byte[] pp = a.passphrase == null || a.passphrase.isEmpty() ? null : a.passphrase.getBytes(StandardCharsets.UTF_8);
            j.addIdentity("key", a.privateKey.getBytes(StandardCharsets.UTF_8), null, pp);
        }
        Session s = j.getSession(a.username, a.host, a.port > 0 ? a.port : 22);
        if (a.password != null && !a.password.isEmpty()) s.setPassword(a.password);
        Properties c = new Properties();
        c.put("StrictHostKeyChecking", "yes"); // checked by Tofu below against the saved fingerprint, before auth
        boolean hasKey = a.privateKey != null && !a.privateKey.isEmpty(), hasPw = a.password != null && !a.password.isEmpty();
        c.put("PreferredAuthentications", hasKey && hasPw ? "publickey,password,keyboard-interactive" : hasKey ? "publickey" : "password,keyboard-interactive");
        s.setConfig(c);
        if (a.password != null) { final String pw = a.password; s.setUserInfo(new PwInfo(pw)); }
        s.setServerAliveInterval(20000); s.setServerAliveCountMax(3);
        try { s.connect(15000); } catch (JSchException e) {
            if (tofu.seen != null && !tofu.seen.equals(a.hostKey)) throw new Exception((a.hostKey == null || a.hostKey.isEmpty() ? "HOSTKEY_UNKNOWN " : "HOSTKEY_CHANGED ") + tofu.seen);
            throw new Exception(friendly(e)); }
        return s;
    }
    /** Trust on first use: only the fingerprint saved with the server (SHA256:base64, same format as OpenSSH/desktop) is accepted. */
    static class Tofu implements HostKeyRepository {
        final String expected; volatile String seen; Tofu(String e) { expected = e == null ? "" : e; }
        public int check(String host, byte[] key) { seen = fp(key); return expected.isEmpty() ? NOT_INCLUDED : expected.equals(seen) ? OK : CHANGED; }
        public void add(HostKey hk, UserInfo ui) {}
        public void remove(String h, String t) {}
        public void remove(String h, String t, byte[] k) {}
        public String getKnownHostsRepositoryID() { return "uiable-connect"; }
        public HostKey[] getHostKey() { return new HostKey[0]; }
        public HostKey[] getHostKey(String h, String t) { return new HostKey[0]; }
    }
    static String fp(byte[] key) {
        try { byte[] d = java.security.MessageDigest.getInstance("SHA-256").digest(key);
            return "SHA256:" + android.util.Base64.encodeToString(d, android.util.Base64.NO_WRAP | android.util.Base64.NO_PADDING); }
        catch (Exception e) { return "SHA256:?"; }
    }
    /** Answers password + keyboard-interactive prompts with the saved password. */
    static class PwInfo implements UserInfo, UIKeyboardInteractive {
        private final String pw; PwInfo(String pw) { this.pw = pw; }
        public String[] promptKeyboardInteractive(String d, String n, String i, String[] p, boolean[] e) { String[] r = new String[p.length]; Arrays.fill(r, pw); return r; }
        public String getPassword() { return pw; } public boolean promptPassword(String m) { return true; }
        public String getPassphrase() { return null; } public boolean promptPassphrase(String m) { return false; }
        public boolean promptYesNo(String m) { return true; } public void showMessage(String m) {}
    }
    static String friendly(Exception e) {
        String m = String.valueOf(e.getMessage());
        if (m.contains("Auth fail") || m.contains("Auth cancel") || m.contains("Too many authentication failures")) return "All configured authentication methods failed";
        if (m.contains("invalid privatekey") || m.contains("USERAUTH fail")) return "Could not read the private key (wrong passphrase or unsupported format)";
        if (e.getCause() != null && m.startsWith("java.")) return e.getCause().getMessage();
        return m;
    }

    public String test(Auth a) throws Exception {
        Session s = open(a);
        try { ExecResult r = exec(s, "uname -sr; hostname", 20000); return r.out.trim().replace("\n", " · "); } finally { s.disconnect(); }
    }

    public void connect(String id, Auth a) throws Exception {
        disconnect(id);
        Conn c = new Conn(); c.session = open(a); conns.put(id, c);
        Thread w = new Thread(() -> { // JSch has no close callback: watch the session
            while (!c.closing) { try { Thread.sleep(2000); } catch (InterruptedException ie) { return; }
                if (!c.session.isConnected()) { if (conns.remove(id, c)) ev.closed(id); return; } } }, "ssh-watch-" + id);
        w.setDaemon(true); w.start();
    }
    public void disconnect(String id) {
        Conn c = conns.remove(id); if (c == null) return; c.closing = true;
        for (ChannelShell sh : c.shells.values()) sh.disconnect();
        if (c.sftp != null) c.sftp.disconnect();
        c.session.disconnect();
    }
    private Conn C(String id) throws Exception { Conn c = conns.get(id); if (c == null || !c.session.isConnected()) throw new Exception("Not connected"); return c; }

    // ---- exec
    public ExecResult exec(String id, String cmd, int timeout) throws Exception { return exec(C(id).session, cmd, timeout); }
    static ExecResult exec(Session s, String cmd, int timeout) throws Exception {
        ChannelExec ch = (ChannelExec) s.openChannel("exec"); ch.setCommand(cmd);
        ByteArrayOutputStream out = new ByteArrayOutputStream(), err = new ByteArrayOutputStream();
        InputStream in = ch.getInputStream(), es = ch.getErrStream(); ch.connect(10000);
        long end = System.currentTimeMillis() + (timeout > 0 ? timeout : 20000); byte[] b = new byte[16384];
        try {
            while (true) {
                boolean got = false;
                while (in.available() > 0) { int n = in.read(b); if (n < 0) break; out.write(b, 0, n); got = true; }
                while (es.available() > 0) { int n = es.read(b); if (n < 0) break; err.write(b, 0, n); got = true; }
                if (ch.isClosed() && in.available() <= 0 && es.available() <= 0) break;
                if (System.currentTimeMillis() > end) throw new Exception("Command timed out");
                if (!got) Thread.sleep(15);
            }
        } finally { ch.disconnect(); }
        ExecResult r = new ExecResult(); r.code = ch.getExitStatus(); r.out = out.toString("UTF-8"); r.err = err.toString("UTF-8"); return r;
    }

    // ---- PTY shell
    public void shellOpen(String id, String sid, int cols, int rows) throws Exception {
        Conn c = C(id); ChannelShell sh = (ChannelShell) c.session.openChannel("shell");
        sh.setPtyType("xterm-256color", cols, rows, 0, 0); sh.setPty(true);
        InputStream in = sh.getInputStream(); sh.connect(10000); c.shells.put(sid, sh);
        Thread t = new Thread(() -> {
            CharsetDecoder dec = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPLACE).onUnmappableCharacter(CodingErrorAction.REPLACE);
            ByteBuffer bb = ByteBuffer.allocate(32768); CharBuffer cb = CharBuffer.allocate(32768);
            try { byte[] b = new byte[16384]; int n;
                while ((n = in.read(b)) >= 0) { // UTF-8 safe across chunk boundaries
                    bb.put(b, 0, n); bb.flip(); dec.decode(bb, cb, false); bb.compact(); cb.flip();
                    if (cb.length() > 0) ev.shellData(id, sid, cb.toString()); cb.clear(); }
            } catch (IOException ignored) {}
            c.shells.remove(sid); sh.disconnect(); ev.shellExit(id, sid);
        }, "ssh-shell-" + sid);
        t.setDaemon(true); t.start();
    }
    public void shellWrite(String id, String sid, String data) throws Exception {
        ChannelShell sh = C(id).shells.get(sid); if (sh == null) return;
        OutputStream o = sh.getOutputStream(); o.write(data.getBytes(StandardCharsets.UTF_8)); o.flush();
    }
    public void shellResize(String id, String sid, int cols, int rows) throws Exception { ChannelShell sh = C(id).shells.get(sid); if (sh != null) sh.setPtySize(cols, rows, 0, 0); }
    public void shellClose(String id, String sid) { Conn c = conns.get(id); if (c == null) return; ChannelShell sh = c.shells.get(sid); if (sh != null) sh.disconnect(); }

    // ---- SFTP (one channel per connection, serialised)
    private ChannelSftp sftp(Conn c) throws Exception {
        if (c.sftp == null || !c.sftp.isConnected()) { ChannelSftp s = (ChannelSftp) c.session.openChannel("sftp"); s.connect(10000); c.sftp = s; }
        return c.sftp;
    }
    private static Exception sfe(SftpException e, String p) {
        if (e.id == ChannelSftp.SSH_FX_NO_SUCH_FILE) return new Exception("No such file: " + p);
        if (e.id == ChannelSftp.SSH_FX_PERMISSION_DENIED) return new Exception("Permission denied: " + p);
        return new Exception(e.getMessage() + ": " + p);
    }
    public String realpath(String id, String p) throws Exception { Conn c = C(id); synchronized (c) { try { return sftp(c).realpath(p); } catch (SftpException e) { throw sfe(e, p); } } }
    public List<Entry> list(String id, String p) throws Exception {
        Conn c = C(id); synchronized (c) { try {
            List<Entry> r = new ArrayList<>();
            for (Object o : sftp(c).ls(p)) { ChannelSftp.LsEntry e = (ChannelSftp.LsEntry) o; String n = e.getFilename();
                if (n.equals(".") || n.equals("..")) continue; Entry x = new Entry(); x.name = n; SftpATTRS a = e.getAttrs();
                x.size = a.getSize(); x.mtime = a.getMTime() & 0xffffffffL; x.mode = a.getPermissions(); r.add(x); }
            return r; } catch (SftpException e) { throw sfe(e, p); } }
    }
    public long[] stat(String id, String p) throws Exception { Conn c = C(id); synchronized (c) { try { SftpATTRS a = sftp(c).stat(p); return new long[]{ a.getSize(), a.isDir() ? 1 : 0 }; } catch (SftpException e) { throw sfe(e, p); } } }
    public void mkdir(String id, String p) throws Exception { Conn c = C(id); synchronized (c) { try { sftp(c).mkdir(p); } catch (SftpException e) { throw sfe(e, p); } } }
    public void rename(String id, String a, String b) throws Exception { Conn c = C(id); synchronized (c) { try { sftp(c).rename(a, b); } catch (SftpException e) { throw sfe(e, a); } } }
    public void remove(String id, String p) throws Exception { Conn c = C(id); synchronized (c) { try { sftp(c).rm(p); } catch (SftpException e) { throw sfe(e, p); } } }
    public byte[] read(String id, String p, long off, int len) throws Exception {
        Conn c = C(id); synchronized (c) { try (InputStream in = sftp(c).get(p, null, off)) {
            ByteArrayOutputStream o = new ByteArrayOutputStream(); byte[] b = new byte[32768]; int n;
            while (o.size() < len && (n = in.read(b, 0, Math.min(b.length, len - o.size()))) > 0) o.write(b, 0, n);
            return o.toByteArray(); } catch (SftpException e) { throw sfe(e, p); } }
    }
    public void write(String id, String p, byte[] data, boolean append) throws Exception {
        Conn c = C(id); synchronized (c) { try { sftp(c).put(new ByteArrayInputStream(data), p, append ? ChannelSftp.APPEND : ChannelSftp.OVERWRITE); } catch (SftpException e) { throw sfe(e, p); } }
    }

    // ---- local port forward: 127.0.0.1:localPort on the device -> remoteHost:remotePort via the server
    public void forwardStart(String id, String fid, int localPort, String rhost, int rport) throws Exception {
        Conn c = C(id); if (c.forwards.containsKey(fid)) return;
        try { c.session.setPortForwardingL("127.0.0.1", localPort, rhost, rport); }
        catch (JSchException e) { throw new Exception("Local port " + localPort + " is already in use on this device"); }
        c.forwards.put(fid, localPort);
    }
    public void forwardStop(String id, String fid) {
        Conn c = conns.get(id); if (c == null) return; Integer p = c.forwards.remove(fid);
        if (p != null) try { c.session.delPortForwardingL("127.0.0.1", p); } catch (JSchException ignored) {}
    }
    public static boolean portFree(int port) {
        try (ServerSocket s = new ServerSocket(port, 1, InetAddress.getByName("127.0.0.1"))) { return true; } catch (IOException e) { return false; }
    }
}
