package mx.cerca.combis.demo;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.regex.Pattern;

/** Downloads only this repository's signed releases; hands installation to Android, never a browser. */
@CapacitorPlugin(name = "NativeUpdate")
public class NativeUpdatePlugin extends Plugin {
    private static final String BASE = "https://github.com/ManexG/Hackaton2.0/releases/download/v";
    private static final long MAX_APK = 120L * 1024 * 1024;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile boolean busy = false, canceled = false;
    private volatile HttpURLConnection connection;
    private File readyFile;
    private String readyVersion;

    private File directory() throws IOException {
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("No hay espacio para descargar la actualización.");
        return dir;
    }
    private String version(PluginCall call) throws IOException {
        String value = call.getString("version", "");
        if (!value.matches("[0-9]{1,6}\\.[0-9]{1,6}\\.[0-9]{1,6}")) throw new IOException("Versión no válida.");
        return value;
    }
    private HttpURLConnection open(String address) throws IOException {
        URL url = new URL(address);
        for (int redirects = 0; redirects < 6; redirects++) {
            String host = url.getHost();
            if (!"https".equals(url.getProtocol()) || !("github.com".equals(host) || "release-assets.githubusercontent.com".equals(host) || "objects.githubusercontent.com".equals(host)))
                throw new IOException("El servidor de actualización no está autorizado.");
            HttpURLConnection next = (HttpURLConnection) url.openConnection();
            connection = next;
            next.setConnectTimeout(15000); next.setReadTimeout(20000);
            next.setInstanceFollowRedirects(false);
            next.setRequestProperty("User-Agent", "OptiRouteLZC-Android");
            int status = next.getResponseCode();
            if (status == 200) return next;
            if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                String location = next.getHeaderField("Location"); next.disconnect();
                if (location == null) throw new IOException("Descarga no disponible.");
                url = new URL(url, location);
            } else { next.disconnect(); throw new IOException("No pudimos descargar la actualización (" + status + "). Intenta de nuevo."); }
        }
        throw new IOException("Demasiadas redirecciones en la descarga.");
    }
    private String checksum(String target) throws Exception {
        HttpURLConnection request = open(BASE + target + "/SHA256SUMS.txt");
        try (InputStream in = request.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int count;
            while ((count = in.read(buffer)) != -1) {
                if (canceled) throw new IOException("Descarga cancelada.");
                if (out.size() + count > 16384) throw new IOException("Comprobación de descarga no válida.");
                out.write(buffer, 0, count);
            }
            var match = Pattern.compile("(?m)^([a-fA-F0-9]{64})[ \\t]+\\*?Las-Palmas-Rutas\\.apk\\s*$").matcher(new String(out.toByteArray(), StandardCharsets.UTF_8));
            if (!match.find()) throw new IOException("La versión no incluye su comprobación de integridad.");
            return match.group(1).toLowerCase(java.util.Locale.ROOT);
        } finally { request.disconnect(); }
    }
    private String hash(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[65536]; int count;
            while ((count = in.read(buffer)) != -1) { if (canceled) throw new IOException("Descarga cancelada."); digest.update(buffer, 0, count); }
        }
        StringBuilder value = new StringBuilder();
        for (byte b : digest.digest()) value.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return value.toString();
    }
    private void verify(File file, String target, String expected) throws Exception {
        if (!file.isFile() || file.length() < 1 || file.length() > MAX_APK || !hash(file).equals(expected))
            throw new IOException("La descarga está incompleta o dañada. Vuelve a descargarla.");
        PackageManager pm = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo current = pm.getPackageInfo(getContext().getPackageName(), flags);
        PackageInfo archive = pm.getPackageArchiveInfo(file.getAbsolutePath(), flags);
        long currentCode = Build.VERSION.SDK_INT >= 28 ? current.getLongVersionCode() : current.versionCode;
        long archiveCode = archive == null ? -1 : Build.VERSION.SDK_INT >= 28 ? archive.getLongVersionCode() : archive.versionCode;
        if (archive == null || !current.packageName.equals(archive.packageName) || !target.equals(archive.versionName) || archiveCode <= currentCode)
            throw new IOException("Este archivo no es una actualización válida de OptiRouteLZC.");
        Signature[] a, b;
        if (Build.VERSION.SDK_INT >= 28) {
            if (archive.signingInfo == null || current.signingInfo == null) throw new IOException("No pudimos comprobar la firma de la app.");
            a = archive.signingInfo.getApkContentsSigners(); b = current.signingInfo.getApkContentsSigners();
        } else { a = archive.signatures; b = current.signatures; }
        if (a == null || b == null) throw new IOException("No pudimos comprobar la firma de la app.");
        if (a.length != b.length || !Arrays.asList(a).containsAll(Arrays.asList(b)))
            throw new IOException("La firma de la actualización no coincide con tu app.");
    }
    private void progress(String stage, long bytes, long total) {
        JSObject value = new JSObject(); value.put("stage", stage); value.put("bytes", bytes); value.put("total", total);
        value.put("percent", total > 0 ? Math.min(100, bytes * 100 / total) : -1);
        notifyListeners("progress", value);
    }
    @PluginMethod public synchronized void download(PluginCall call) {
        if (busy) { call.reject("Ya hay una descarga en curso."); return; }
        busy = true; canceled = false;
        executor.execute(() -> {
            File partial = null;
            try {
                String target = version(call), url = call.getString("url", "");
                if (!url.equals(BASE + target + "/Las-Palmas-Rutas.apk")) throw new IOException("Descarga no autorizada.");
                var prefs = getContext().getSharedPreferences("native-update", 0);
                File file = new File(directory(), "release-" + target + ".apk");
                boolean cached = false;
                if (target.equals(prefs.getString("version", "")) && file.isFile()) {
                    try { verify(file, target, prefs.getString("sha256", "")); cached = true; }
                    catch (Exception invalidCache) { file.delete(); prefs.edit().remove("version").remove("sha256").apply(); }
                }
                if (!cached) {
                    progress("checking", 0, 0);
                    String expected = checksum(target);
                    partial = new File(directory(), "download.part");
                    HttpURLConnection request = open(url);
                    try (InputStream in = request.getInputStream(); OutputStream out = new FileOutputStream(partial)) {
                        long total = request.getContentLengthLong(), bytes = 0, lastEvent = 0, start = System.currentTimeMillis();
                        if (total > MAX_APK) throw new IOException("El archivo de actualización es demasiado grande.");
                        byte[] buffer = new byte[65536]; int count;
                        while ((count = in.read(buffer)) != -1) {
                            if (canceled) throw new IOException("Descarga cancelada.");
                            bytes += count;
                            if (bytes > MAX_APK || System.currentTimeMillis() - start > 300000) throw new IOException("La descarga tardó demasiado. Revisa tu conexión.");
                            out.write(buffer, 0, count);
                            if (System.currentTimeMillis() - lastEvent > 250) { progress("downloading", bytes, total); lastEvent = System.currentTimeMillis(); }
                        }
                        if (total > 0 && bytes != total) throw new IOException("La descarga quedó incompleta.");
                    } finally { request.disconnect(); }
                    progress("verifying", partial.length(), partial.length());
                    verify(partial, target, expected);
                    if (!partial.renameTo(file)) throw new IOException("No pudimos guardar la actualización.");
                    prefs.edit().putString("version", target).putString("sha256", expected).apply();
                    for (File old : directory().listFiles()) if (!old.equals(file) && old.getName().startsWith("release-") && old.getName().endsWith(".apk")) old.delete();
                }
                readyFile = file; readyVersion = target;
                progress("ready", file.length(), file.length());
                JSObject result = new JSObject(); result.put("ready", true); call.resolve(result);
            } catch (Exception error) { call.reject(canceled ? "Descarga cancelada." : error.getMessage()); }
            finally { if (partial != null) partial.delete(); connection = null; busy = false; }
        });
    }
    @PluginMethod public void cancel(PluginCall call) {
        canceled = true; HttpURLConnection request = connection; if (request != null) request.disconnect(); call.resolve();
    }
    @PluginMethod public void status(PluginCall call) {
        executor.execute(() -> {
            boolean ready = false;
            try {
                String target = version(call);
                var prefs = getContext().getSharedPreferences("native-update", 0);
                File file = new File(directory(), "release-" + target + ".apk");
                if (target.equals(prefs.getString("version", ""))) {
                    verify(file, target, prefs.getString("sha256", "")); ready = true;
                }
            } catch (Exception ignored) { /* A missing/evicted download can be retried. */ }
            JSObject value = new JSObject(); value.put("ready", ready); call.resolve(value);
        });
    }
    @PluginMethod public synchronized void install(PluginCall call) {
        if (busy) { call.reject("Espera a que termine la descarga."); return; }
        busy = true; canceled = false;
        executor.execute(() -> {
            try {
                String target = version(call);
                File file = new File(directory(), "release-" + target + ".apk");
                var prefs = getContext().getSharedPreferences("native-update", 0);
                if (!target.equals(prefs.getString("version", ""))) throw new IOException("Descarga la actualización antes de instalarla.");
                verify(file, target, prefs.getString("sha256", "")); readyFile = file; readyVersion = target;
                getActivity().runOnUiThread(() -> {
                    busy = false;
                    try {
                        if (!getContext().getPackageManager().canRequestPackageInstalls()) {
                            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
                            startActivityForResult(call, settings, "permissionResult");
                        } else launchInstaller(call);
                    } catch (Exception error) { call.reject("Android no pudo abrir la instalación. Intenta de nuevo."); }
                });
            } catch (Exception error) { busy = false; call.reject(error.getMessage()); }
        });
    }
    private void launchInstaller(PluginCall call) {
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".updates", readyFile);
        Intent installer = new Intent(Intent.ACTION_VIEW);
        installer.setDataAndType(uri, "application/vnd.android.package-archive");
        installer.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        installer.putExtra(Intent.EXTRA_RETURN_RESULT, true);
        startActivityForResult(call, installer, "installResult");
    }
    @ActivityCallback private void permissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (!getContext().getPackageManager().canRequestPackageInstalls()) { call.reject("Permite actualizar desde OptiRouteLZC para continuar. El archivo ya está descargado."); return; }
        try { launchInstaller(call); } catch (Exception error) { call.reject("No pudimos abrir el instalador de Android."); }
    }
    @ActivityCallback private void installResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_OK) call.resolve();
        else call.reject("Instalación cancelada o pendiente. Toca Instalar actualización para intentarlo de nuevo.");
    }
    @Override protected void handleOnDestroy() { canceled = true; if (connection != null) connection.disconnect(); executor.shutdownNow(); }
}
