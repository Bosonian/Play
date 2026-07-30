package de.bosonian.runway;

// ARCHITECTURE RULE (same as WidgetBridgePlugin.java/DayGaugePlugin.java/
// WifiBridgePlugin.java/CalendarBridgePlugin.java/BluetoothBridgePlugin.java):
// this plugin moves data and OS state across the JS<->native boundary and
// nothing more. Which step's countdown is live, whether the current one is
// even eligible for a pill (a step that hasn't started yet), and the
// compact pill's own layout are all decided in TypeScript/JSX
// (src/screens/StepFocus.tsx, src/hooks/usePipMode.ts) — this file only
// knows how to ask Android "is PiP available on this device" and arm/read
// the auto-enter flag MainActivity needs at the moment the app backgrounds.
// See MainActivity's onUserLeaveHint/onPictureInPictureModeChanged overrides
// for the other half of the mechanism this plugin can't reach on its own —
// entering PiP and reporting a mode change both have to happen on the
// Activity itself, not on a Plugin, which is why those two methods live
// there instead of here.

import android.app.PictureInPictureParams;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Rational;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The JS<->native bridge for Picture-in-Picture (PiP increment, 0.46.0):
 * lets StepFocus's live countdown keep showing as a small movable pill while
 * Deepak switches to another app — the same shape as Android's own Timer
 * app. See src/native/pip.ts for the JS side (the only file that calls into
 * this plugin).
 */
@CapacitorPlugin(name = "PipBridge")
public class PipBridgePlugin extends Plugin {

    // Whether StepFocus currently wants auto-enter armed. Read by
    // MainActivity.onUserLeaveHint (the API 26-30 fallback path ONLY — see
    // that method's own comment for why it's not consulted on API 31+,
    // where setAutoEnterEnabled below already tells the OS the same thing
    // directly) at the exact moment the app is about to background. Plain
    // in-memory field, not persisted to SharedPreferences the way
    // BluetoothBridgePlugin's watched-device state is: this only ever needs
    // to reflect "what does the currently-open StepFocus want right now",
    // which is meaningless — and correctly false — the moment the app isn't
    // running at all, so there is nothing here worth surviving a process
    // death.
    private volatile boolean autoEnterArmed = false;

    /**
     * Resolves `{ supported: boolean }` — never rejects. True only when BOTH
     * the OS is new enough (the PictureInPictureParams/setAutoEnterEnabled
     * APIs this plugin and MainActivity call are API 26/Oreo+) AND the
     * device itself declares the PiP hardware feature.
     *
     * minSdkVersion is 23 (android/variables.gradle) — BELOW API 26 —
     * verified by reading that file directly rather than assumed, so the
     * SDK_INT check below is load-bearing, not defensive decoration: a
     * device on API 23-25 reaching PictureInPictureParams (referenced
     * elsewhere in this file and in MainActivity) would hit
     * NoClassDefFoundError without it. FEATURE_PICTURE_IN_PICTURE is itself
     * an OPTIONAL hardware feature — Android's compatibility definition does
     * not require every API-26+ device to declare it (some budget/TV/
     * Android-Go builds omit it despite meeting the API level) — so the
     * SDK check alone would be an honest-SOUNDING but wrong answer on a
     * device like that; both conditions are required.
     */
    @PluginMethod
    public void isSupported(PluginCall call) {
        boolean supported =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);

        JSObject result = new JSObject();
        result.put("supported", supported);
        call.resolve(result);
    }

    /**
     * Expects `{ enabled: boolean }`. Stores the armed flag unconditionally
     * — read by MainActivity's API 26-30 fallback regardless of what OS
     * version this actually runs on, since a caller on an unsupported OS
     * simply gets a flag nothing ever reads — then, API 31+ ONLY, ALSO tells
     * the OS directly via setPictureInPictureParams/setAutoEnterEnabled,
     * which is what makes PiP kick in automatically on that range with no
     * onUserLeaveHint fallback needed at all (see MainActivity's own comment
     * on why its fallback path is guarded to SDK_INT < S).
     *
     * `call.getBoolean("enabled", false)` returns a NULLABLE `Boolean` even
     * with a default supplied — verified against
     * node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/PluginCall.java's
     * `getBoolean(name, defaultValue)`: its signature is `@Nullable Boolean
     * defaultValue` -> `@Nullable Boolean` return, and it only substitutes
     * the default when the key is absent or isn't actually a JSON boolean —
     * nothing about the signature rules out a caller (or a future refactor
     * of this method) passing a null default and getting one back. This app
     * has been bitten by exactly this shape before with `getLong` (see
     * DayGaugePlugin's own comment on why IT reads via `optLong` instead) —
     * so this reads into a boxed local and checks it explicitly rather than
     * auto-unboxing straight into a primitive `boolean`.
     */
    @PluginMethod
    public void setAutoEnter(PluginCall call) {
        Boolean enabledBoxed = call.getBoolean("enabled", false);
        boolean enabled = enabledBoxed != null && enabledBoxed;
        autoEnterArmed = enabled;

        // The Activity is captured ONCE into a final local here rather than
        // calling getActivity() a second time inside the runnable below.
        // Two separate bugs that closes, both found in review rather than by
        // compiling (this file cannot be built in this environment):
        //   1. getActivity() can legally return null, so calling it again
        //      inside a runnable that executes LATER — after the null check
        //      above already passed — could NPE on a torn-down Activity.
        //      NullPointerException is not an IllegalStateException, so the
        //      catch below would not have caught it, and the crash would
        //      land on Android's UI thread.
        //   2. call.resolve() used to sit inside the runnable. If the
        //      runnable never ran (Activity destroyed before the post was
        //      drained), the JS promise would never settle — a quiet leak
        //      rather than a crash, but a leak with no timeout behind it.
        // Resolving synchronously below instead is honest: the only state
        // this method's caller depends on is `autoEnterArmed`, which is
        // already set above, on this thread, before the post happens.
        final android.app.Activity activity =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? getActivity() : null;

        if (activity != null) {
            activity.runOnUiThread(() -> {
                try {
                    PictureInPictureParams params = new PictureInPictureParams.Builder()
                        .setAspectRatio(new Rational(16, 9))
                        .setAutoEnterEnabled(enabled)
                        .build();
                    activity.setPictureInPictureParams(params);
                } catch (RuntimeException e) {
                    // Deliberate silent degradation, not a swallowed bug.
                    // setPictureInPictureParams throws IllegalStateException
                    // when the Activity doesn't support PiP (shouldn't
                    // happen here — android:supportsPictureInPicture="true"
                    // is set in the manifest — but this is the same
                    // defensive posture WifiBridgePlugin/CalendarBridgePlugin
                    // already take against a documented-but-rare OS
                    // inconsistency) or when Deepak has turned PiP off for
                    // this app in Android Settings, which is a real,
                    // reachable case, not a hypothetical one. There is no
                    // honest UI to show for either case here — "your system
                    // settings turned this off" is exactly the kind of nag
                    // CLAUDE.md's calm/spare rule argues against, and the
                    // countdown itself keeps working perfectly inside the
                    // app either way — so this resolves normally rather than
                    // rejecting, and the pill simply never appears.
                    //
                    // Caught as RuntimeException, not IllegalStateException:
                    // setAspectRatio also documents IllegalArgumentException
                    // for a ratio outside Android's accepted range. 16:9
                    // (1.778) sits well inside the documented 0.4184..2.39
                    // window so that should never fire, but "should never"
                    // is not a reason to let an unbuildable-here file crash
                    // the UI thread. Every throwable this block can produce
                    // means exactly one thing — the pill won't appear — and
                    // that is the same silent degradation either way.
                }
            });
        }

        call.resolve();

        call.resolve();
    }

    /**
     * Forwards an onPictureInPictureModeChanged callback from MainActivity
     * into JS as a `pipModeChanged` event carrying `{ isInPip: boolean }` —
     * see src/hooks/usePipMode.ts for the JS side that turns this into a
     * plain boolean. Called directly from MainActivity, not from a
     * PluginCall, so there is no `call` of its own here to resolve/reject.
     */
    public void handlePipModeChanged(boolean isInPip) {
        JSObject data = new JSObject();
        data.put("isInPip", isInPip);
        notifyListeners("pipModeChanged", data);
    }

    /**
     * Whether StepFocus currently wants auto-enter armed — read by
     * MainActivity.onUserLeaveHint's API 26-30 fallback path only. See
     * `autoEnterArmed`'s own field comment above for why this is plain
     * in-memory state rather than anything persisted.
     */
    public boolean isAutoEnterArmed() {
        return autoEnterArmed;
    }
}
