package de.bosonian.runway;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * Widgets increment (Runway 0.10.0): registers WidgetBridgePlugin, the
 * app's first custom (non-npm) Capacitor plugin. Calendar/share-target
 * increment (0.17.0) adds CalendarBridgePlugin the same way, plus the
 * ACTION_SEND rewrite trick documented on rewriteShareTargetIntent below.
 * Arrival-detection increment (0.23.0) adds WifiBridgePlugin the same way
 * again. Day-gauge increment (0.31.0) adds DayGaugePlugin the same way once
 * more.
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
        super.onCreate(savedInstanceState);
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
