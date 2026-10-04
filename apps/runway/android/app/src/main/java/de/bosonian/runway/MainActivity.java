package de.bosonian.runway;

import android.app.PictureInPictureParams;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;

/**
 * Widgets increment (Runway 0.10.0): registers WidgetBridgePlugin, the
 * app's first custom (non-npm) Capacitor plugin. Calendar/share-target
 * increment (0.17.0) adds CalendarBridgePlugin the same way, plus the
 * ACTION_SEND rewrite trick documented on rewriteShareTargetIntent below.
 * Arrival-detection increment (0.23.0) adds WifiBridgePlugin the same way
 * again. Day-gauge increment (0.31.0) adds DayGaugePlugin the same way once
 * more. Car Bluetooth transit increment (0.36.0) adds BluetoothBridgePlugin
 * the same way again — BluetoothTransitReceiver, the OTHER new class this
 * increment ships, is a manifest-declared BroadcastReceiver, not a plugin,
 * so it needs no registerPlugin() call here at all (see its own class doc
 * comment and AndroidManifest.xml's <receiver> entry). Picture-in-picture
 * increment (0.46.0) adds PipBridgePlugin the same way once more, plus two
 * new Activity lifecycle overrides (onPictureInPictureModeChanged,
 * onUserLeaveHint) that PipBridgePlugin has no way to receive itself — see
 * those methods' own doc comments below for why entering/reporting PiP has
 * to happen on the Activity rather than the plugin.
 *
 * The registerPlugin() call has to happen BEFORE super.onCreate() runs, not
 * after: BridgeActivity.onCreate() (see
 * node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeActivity.java)
 * loads every registered plugin into the Bridge and calls load() at the end
 * of its own onCreate() — by the time super.onCreate() returns, the plugin
 * list is already frozen for this Activity instance. registerPlugin() only
 * appends to `bridgeBuilder`, a field initialised at construction time
 * (`protected final Bridge.Builder bridgeBuilder = new Bridge.Builder(this);`
 * in BridgeActivity), so it's already safe to call before super.onCreate()
 * runs — the object it writes to exists before onCreate() is ever invoked.
 * This is the standard Capacitor pattern for registering a plugin that
 * doesn't ship as an npm package.
 */
public class MainActivity extends BridgeActivity {

    /**
     * Combined onCreate decision table (m6's history strip + the share-target
     * rewrite below), evaluated top-to-bottom in this exact order — SEND
     * rewrite first, history strip second:
     *
     * | incoming intent                        | FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY | after rewrite step         | after strip step         | result                                   |
     * |-----------------------------------------|--------------------------------------|------------------------------|---------------------------|-------------------------------------------|
     * | ACTION_SEND text/plain, EXTRA_TEXT set   | absent (genuine fresh share)         | ACTION_VIEW runway://share-target?text=... | unchanged (flag absent)  | deep link survives -> DepartureSetup prefilled |
     * | ACTION_SEND text/plain, EXTRA_TEXT set   | present (task reopened from Recents after process death — its ORIGINAL/root intent was this same ACTION_SEND) | ACTION_VIEW runway://share-target?text=... | reset to ACTION_MAIN, data null | lands on Home, not a re-prefilled stale destination |
     * | anything else (MAIN, runway://, ...)     | absent                               | unchanged (not ACTION_SEND)  | unchanged                | normal launch/deep-link handling         |
     * | anything else (MAIN, runway://, ...)     | present                              | unchanged (not ACTION_SEND)  | reset to ACTION_MAIN, data null | lands on Home (m6, unchanged from before this increment) |
     *
     * Why the rewrite has to run FIRST: the history strip's own condition
     * only looks at the FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY bit, not at the
     * intent's action — so it strips a re-opened-from-Recents SEND intent
     * regardless of whether that intent has already been rewritten to
     * runway://share-target by the time the strip runs. Running the rewrite
     * first therefore costs nothing in the "stale share" row (still
     * correctly stripped down to Home) while being the ONLY order that lets
     * a genuine fresh share survive the strip's flag check at all (row 1: no
     * flag present, so nothing to strip either way, but the rewrite must
     * still have already happened for the deep-link machinery below to see
     * runway://share-target rather than a raw, un-rewritten ACTION_SEND).
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        rewriteShareTargetIntent(getIntent());

        // m6: a task relaunched from the Recents list after its process was
        // killed redelivers the ORIGINAL launch intent — including whatever
        // runway:// deep-link data URI it carried, e.g. a widget tap that
        // cold-started the app hours or days ago. BridgeActivity.load()
        // (called from super.onCreate() below) reads getIntent() and
        // synthesizes a retained appUrlOpen event from it (see
        // deepLinks.ts's own corrected comment on why that path exists), so
        // without stripping the stale data here first, resuming from
        // Recents would re-navigate to that old target instead of landing
        // on Home — which is what resuming a recents entry should do. This
        // has to run BEFORE super.onCreate(), same ordering reason as
        // registerPlugin() below: super.onCreate() is what reads
        // getIntent() and acts on it, so the strip must land first.
        if ((getIntent().getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) {
            setIntent(new Intent(getIntent()).setData(null).setAction(Intent.ACTION_MAIN));
        }

        registerPlugin(WidgetBridgePlugin.class);
        registerPlugin(CalendarBridgePlugin.class);
        // Arrival-detection increment (0.23.0): WifiBridgePlugin.java.
        registerPlugin(WifiBridgePlugin.class);
        // Day-gauge increment (0.31.0): DayGaugePlugin.java.
        registerPlugin(DayGaugePlugin.class);
        // Car Bluetooth transit increment (0.36.0): BluetoothBridgePlugin.java.
        registerPlugin(BluetoothBridgePlugin.class);
        // Picture-in-picture increment (0.46.0): PipBridgePlugin.java.
        registerPlugin(PipBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * Picture-in-picture increment: Android calls this whenever the Activity
     * transitions in or out of PiP — including a transition the OS itself
     * drove (Deepak dragging the pill back to full screen), not only one
     * this app triggered. super runs first, per Android's own documented
     * contract for overriding this method; the new mode is then forwarded to
     * PipBridgePlugin so StepFocus.tsx's usePipMode() hook can swap in the
     * compact pill layout — see that hook and
     * PipBridgePlugin.handlePipModeChanged for the JS side.
     */
    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        PipBridgePlugin plugin = getPipBridgePlugin();
        if (plugin != null) plugin.handlePipModeChanged(isInPictureInPictureMode);
    }

    /**
     * Picture-in-picture increment: the API 26-30 FALLBACK path only. Fires
     * whenever this Activity is about to leave the foreground for a reason
     * the user can navigate back from (home button, recents, app switch) —
     * not on every pause (e.g. a permission dialog appearing over the app
     * does not trigger this). On API 31+, setAutoEnterEnabled
     * (PipBridgePlugin.setAutoEnter) already tells the OS to enter PiP
     * automatically at this same moment, with no app code needed at all —
     * calling enterPictureInPictureMode() here TOO on those OS versions
     * would ask Android to enter PiP twice for the same transition, which is
     * exactly why this whole body is guarded to SDK_INT < S. The try/catch
     * mirrors PipBridgePlugin.setAutoEnter's own — same IllegalStateException
     * the OS can throw for the same two reasons (PiP unsupported here, or
     * turned off for this app in Settings), same deliberate silent
     * degradation: the app just stays in the foreground, not a crash.
     */
    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return;

        PipBridgePlugin plugin = getPipBridgePlugin();
        if (plugin == null || !plugin.isAutoEnterArmed()) return;

        try {
            // PipBridgePlugin.PILL_ASPECT, not a second literal — the two
            // paths request the same shape by construction, so the API 26-30
            // fallback can't drift away from the API 31+ path. See that
            // constant's own comment for why 2.39:1 and why it cannot go
            // wider.
            PictureInPictureParams params =
                new PictureInPictureParams.Builder().setAspectRatio(PipBridgePlugin.PILL_ASPECT).build();
            enterPictureInPictureMode(params);
        } catch (IllegalStateException e) {
            // See PipBridgePlugin.setAutoEnter's own comment on this exact
            // exception — deliberate silent degradation, not swallowed.
        }
    }

    /**
     * Looks up the running PipBridgePlugin instance through the Bridge,
     * never a static field — a static reference to a plugin holding an
     * Activity would leak that Activity past its own lifecycle. Every step
     * is null-guarded rather than assumed: getBridge() can be null before
     * onCreate() finishes constructing it and during teardown, and
     * getPlugin() returns null for a plugin id that isn't registered (should
     * be unreachable here — PipBridgePlugin.class is registered above — but
     * guarded anyway, same defensive posture this file already takes
     * elsewhere). Verified against
     * node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeActivity.java's
     * getBridge(), Bridge.java's getPlugin(String) -> PluginHandle, and
     * PluginHandle.java's getInstance() -> Plugin.
     */
    private PipBridgePlugin getPipBridgePlugin() {
        Bridge bridge = getBridge();
        if (bridge == null) return null;
        PluginHandle handle = bridge.getPlugin("PipBridge");
        if (handle == null) return null;
        Plugin instance = handle.getInstance();
        if (!(instance instanceof PipBridgePlugin)) return null;
        return (PipBridgePlugin) instance;
    }

    /**
     * Share-target increment: a share tapped while the app (and its task)
     * is already alive arrives here, not onCreate — singleTask launchMode
     * routes it to the running Activity's onNewIntent instead of spawning a
     * second instance (same launchMode reasoning as the runway:// deep links
     * documented in AndroidManifest.xml). No history-flag strip needed here:
     * that flag is specifically a cold-start/Recents-relaunch signal (see
     * BridgeActivity.onCreate()'s load() -> onNewIntent(getIntent()) call),
     * not something a live onNewIntent delivery ever carries in practice.
     * `setIntent(intent)` keeps getActivity().getIntent() consistent with
     * what was just delivered, matching Android's own documented advice for
     * onNewIntent overrides (BridgeActivity's onNewIntent doesn't do this
     * itself — see its own onNewIntent(Intent), which reads the passed
     * parameter, not getIntent() — so this is belt-and-suspenders, not load
     * -bearing for the deep-link flow below).
     */
    @Override
    public void onNewIntent(Intent intent) {
        rewriteShareTargetIntent(intent);
        setIntent(intent);
        super.onNewIntent(intent);
    }

    /**
     * Rewrites an ACTION_SEND(text/plain) intent — the shape Android hands
     * every app registered as a share target, e.g. Google Maps' "Share" on
     * a place — into an ACTION_VIEW runway://share-target?text={encoded}
     * intent, MUTATING the given Intent object in place rather than
     * building a new one. The trick: once it looks like a runway:// VIEW
     * intent, the existing deep-link machinery (src/native/deepLinks.ts,
     * riding on @capacitor/app's appUrlOpen) delivers it to JS with ZERO new
     * bridge code — this plugin/MainActivity file needs no new
     * registerPlugin(), no new PluginMethod, nothing. deepLinks.ts's own
     * screenForUrl() gains a `share-target` case (this increment) that
     * parses the `text` query param via src/lib/shareTarget.ts's
     * parseSharedDestination() and navigates to departureSetup prefilled.
     * No-op (leaves the intent untouched) for anything that isn't exactly
     * ACTION_SEND + text/plain + a present EXTRA_TEXT — a share of a photo,
     * a share with no text body, or an intent that's already something
     * else entirely all fall through unchanged.
     */
    private static void rewriteShareTargetIntent(Intent intent) {
        if (intent == null) return;
        if (!Intent.ACTION_SEND.equals(intent.getAction())) return;
        if (!"text/plain".equals(intent.getType())) return;

        String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (sharedText == null) return;

        Uri deepLink = Uri.parse("runway://share-target?text=" + Uri.encode(sharedText));
        intent.setAction(Intent.ACTION_VIEW).setData(deepLink);
    }
}
