package app.dosing.companion;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.MessageDigest;

@CapacitorPlugin(name = "AppUpdateIdentity")
public final class AppUpdateIdentityPlugin extends Plugin {
    private static final int SCHEMA_VERSION = 1;

    @PluginMethod
    public void getIdentity(PluginCall call) {
        try {
            String packageName = getContext().getPackageName();
            PackageManager manager = getContext().getPackageManager();
            PackageInfo info = packageInfo(manager, packageName);
            Signature signer = currentSingleSigner(info);
            long versionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? info.getLongVersionCode()
                : info.versionCode;
            if (versionCode < 1 || versionCode > 2_100_000_000L || info.versionName == null || info.versionName.trim().isEmpty()) {
                throw new IllegalStateException();
            }

            JSObject result = new JSObject();
            result.put("schemaVersion", SCHEMA_VERSION);
            result.put("packageName", packageName);
            result.put("versionCode", versionCode);
            result.put("versionName", info.versionName);
            result.put("signerSha256", sha256(signer.toByteArray()));
            call.resolve(result);
        } catch (Exception exception) {
            call.reject("App update identity is unavailable.", "IDENTITY_UNAVAILABLE");
        }
    }

    @SuppressWarnings("deprecation")
    private static PackageInfo packageInfo(PackageManager manager, String packageName)
        throws PackageManager.NameNotFoundException {
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return manager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(flags));
        }
        return manager.getPackageInfo(packageName, flags);
    }

    @SuppressWarnings("deprecation")
    private static Signature currentSingleSigner(PackageInfo info) {
        Signature[] signers;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            if (info.signingInfo == null || info.signingInfo.hasMultipleSigners()) {
                throw new IllegalStateException();
            }
            signers = info.signingInfo.getApkContentsSigners();
        } else {
            signers = info.signatures;
        }
        if (signers == null || signers.length != 1 || signers[0] == null) {
            throw new IllegalStateException();
        }
        return signers[0];
    }

    private static String sha256(byte[] value) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(value);
        StringBuilder hex = new StringBuilder(digest.length * 2);
        for (byte item : digest) hex.append(String.format("%02x", item & 0xff));
        return hex.toString();
    }
}
