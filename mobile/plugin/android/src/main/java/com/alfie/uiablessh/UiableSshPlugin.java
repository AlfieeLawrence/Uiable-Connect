package com.alfie.uiablessh;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "UiableSsh")
public class UiableSshPlugin extends Plugin {
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private SshCore core;

    @Override public void load() {
        core = new SshCore(new SshCore.Events() {
            public void shellData(String id, String sid, String data) { JSObject o = new JSObject(); o.put("id", id); o.put("sid", sid); o.put("data", data); notifyListeners("shellData", o); }
            public void shellExit(String id, String sid) { JSObject o = new JSObject(); o.put("id", id); o.put("sid", sid); notifyListeners("shellExit", o); }
            public void closed(String id) { JSObject o = new JSObject(); o.put("id", id); notifyListeners("closed", o); }
        });
    }
    @Override protected void handleOnDestroy() { pool.shutdownNow(); }

    interface Job { JSObject run(PluginCall c) throws Exception; }
    private void bg(PluginCall call, Job j) { pool.execute(() -> { try { JSObject r = j.run(call); call.resolve(r == null ? new JSObject() : r); } catch (Exception e) { call.reject(SshCore.friendly(e)); } }); }
    private static SshCore.Auth auth(PluginCall c) {
        SshCore.Auth a = new SshCore.Auth(); a.host = c.getString("host"); a.port = c.getInt("port", 22); a.username = c.getString("username");
        a.password = c.getString("password"); a.privateKey = c.getString("privateKey"); a.passphrase = c.getString("passphrase"); return a;
    }
    private static JSObject o(String k, Object v) { JSObject o = new JSObject(); o.put(k, v); return o; }

    @PluginMethod public void test(PluginCall call) { bg(call, c -> o("info", core.test(auth(c)))); }
    @PluginMethod public void connect(PluginCall call) { bg(call, c -> { core.connect(c.getString("id"), auth(c)); return null; }); }
    @PluginMethod public void disconnect(PluginCall call) { bg(call, c -> { core.disconnect(c.getString("id")); return null; }); }
    @PluginMethod public void exec(PluginCall call) { bg(call, c -> { SshCore.ExecResult r = core.exec(c.getString("id"), c.getString("cmd"), c.getInt("timeout", 20000));
        JSObject x = new JSObject(); x.put("code", r.code); x.put("out", r.out); x.put("err", r.err); return x; }); }
    @PluginMethod public void shellOpen(PluginCall call) { bg(call, c -> { core.shellOpen(c.getString("id"), c.getString("sid"), c.getInt("cols", 80), c.getInt("rows", 24)); return null; }); }
    @PluginMethod public void shellWrite(PluginCall call) { bg(call, c -> { core.shellWrite(c.getString("id"), c.getString("sid"), c.getString("data", "")); return null; }); }
    @PluginMethod public void shellResize(PluginCall call) { bg(call, c -> { core.shellResize(c.getString("id"), c.getString("sid"), c.getInt("cols", 80), c.getInt("rows", 24)); return null; }); }
    @PluginMethod public void shellClose(PluginCall call) { bg(call, c -> { core.shellClose(c.getString("id"), c.getString("sid")); return null; }); }
    @PluginMethod public void sftpRealpath(PluginCall call) { bg(call, c -> o("path", core.realpath(c.getString("id"), c.getString("path", ".")))); }
    @PluginMethod public void sftpList(PluginCall call) { bg(call, c -> { JSArray a = new JSArray();
        for (SshCore.Entry e : core.list(c.getString("id"), c.getString("path"))) { JSObject x = new JSObject(); x.put("name", e.name); x.put("size", e.size); x.put("mtime", e.mtime); x.put("mode", e.mode); a.put(x); }
        return o("items", a); }); }
    @PluginMethod public void sftpStat(PluginCall call) { bg(call, c -> { long[] s = core.stat(c.getString("id"), c.getString("path")); JSObject x = new JSObject(); x.put("size", s[0]); x.put("dir", s[1] == 1); return x; }); }
    @PluginMethod public void sftpMkdir(PluginCall call) { bg(call, c -> { core.mkdir(c.getString("id"), c.getString("path")); return null; }); }
    @PluginMethod public void sftpRename(PluginCall call) { bg(call, c -> { core.rename(c.getString("id"), c.getString("from"), c.getString("to")); return null; }); }
    @PluginMethod public void sftpRemove(PluginCall call) { bg(call, c -> { core.remove(c.getString("id"), c.getString("path")); return null; }); }
    @PluginMethod public void sftpRead(PluginCall call) { bg(call, c -> { byte[] b = core.read(c.getString("id"), c.getString("path"), c.getLong("offset", 0L), c.getInt("length", 524288));
        JSObject x = new JSObject(); x.put("data", Base64.encodeToString(b, Base64.NO_WRAP)); x.put("bytes", b.length); return x; }); }
    @PluginMethod public void sftpWrite(PluginCall call) { bg(call, c -> { core.write(c.getString("id"), c.getString("path"), Base64.decode(c.getString("data", ""), Base64.DEFAULT), c.getBoolean("append", false)); return null; }); }
    @PluginMethod public void forwardStart(PluginCall call) { bg(call, c -> { core.forwardStart(c.getString("id"), c.getString("fid"), c.getInt("localPort"), c.getString("remoteHost", "127.0.0.1"), c.getInt("remotePort")); return null; }); }
    @PluginMethod public void forwardStop(PluginCall call) { bg(call, c -> { core.forwardStop(c.getString("id"), c.getString("fid")); return null; }); }
    @PluginMethod public void portFree(PluginCall call) { bg(call, c -> o("free", SshCore.portFree(c.getInt("port")))); }

    // ---- secrets: AES-256-GCM key held in the Android Keystore (never leaves secure hardware), ciphertext in SharedPreferences
    private static final String ALIAS = "uiable-connect-store";
    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        if (ks.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
        return g.generateKey();
    }
    private SharedPreferences prefs() { return getContext().getSharedPreferences("uiable_secure", Context.MODE_PRIVATE); }
    @PluginMethod public void secretSet(PluginCall call) { bg(call, c -> {
        Cipher ci = Cipher.getInstance("AES/GCM/NoPadding"); ci.init(Cipher.ENCRYPT_MODE, key());
        byte[] ct = ci.doFinal(c.getString("value", "").getBytes(StandardCharsets.UTF_8));
        prefs().edit().putString(c.getString("key"), Base64.encodeToString(ci.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP)).commit();
        return null; }); }
    @PluginMethod public void secretGet(PluginCall call) { bg(call, c -> {
        String v = prefs().getString(c.getString("key"), null); if (v == null) return o("value", null);
        String[] p = v.split(":"); Cipher ci = Cipher.getInstance("AES/GCM/NoPadding");
        ci.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(p[0], Base64.NO_WRAP)));
        return o("value", new String(ci.doFinal(Base64.decode(p[1], Base64.NO_WRAP)), StandardCharsets.UTF_8)); }); }
}
