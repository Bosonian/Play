package de.bosonian.runway;

// ARCHITECTURE RULE (widgets increment, Runway 0.10.0; calendar-slide
// reworked m3): all business math — pace, remaining hours, the ready-date
// projection — lives in TypeScript (src/lib/examProjection.ts,
// src/lib/widgetSnapshot.ts). This class is display plumbing only. The only
// arithmetic it performs on numbers is: (1) counting how many whole calendar
// days have passed since the snapshot was generated and sliding
// readyDayEpochMs forward by that many days (Calendar day-add) to get a
// display date, and (2) diffing two already-known dates in whole days
// (displayReadyDay vs. anchor) to pick a colour band. Both are a 1:1 mirror
// of the same midnight-to-midnight floor-diff math examProjection.ts's own
// daysBetween does — never a re-derivation of pace or remaining-hours logic.
// m3: this midnight-to-midnight symmetry (both this class and
// examProjection.ts floor calendar days the same way, from the same kind of
// local-midnight instant) is what makes the widget's displayed date agree
// with what ExamOverview.tsx would show if opened at that same moment, by
// construction — not by coincidence, and not by re-deriving the projection.

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Locale;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The Prüfung home-screen widget: the ready-by date, a weekly progress bar,
 * this week's hours, and the exam anchor, rendered from the JSON snapshot
 * WidgetBridgePlugin.updateSnapshot last wrote to SharedPreferences. Tapping
 * anywhere on the widget opens the app to the Prüfung overview via the
 * `runway://exam` deep link (src/native/deepLinks.ts).
 *
 * Progress bar polish (0.40.0): the bar mirrors ExamOverview.tsx's ONE
 * sanctioned progress bar (the weekly one — see that screen's own comment
 * on why a week-scoped, Monday-resetting bar is exempt from CLAUDE.md's
 * "no bars, no streaks" rule). ARCHITECTURE RULE, unchanged and extended:
 * this class does ZERO arithmetic and makes ZERO colour decisions for the
 * bar — `weekProgressPercent` (the fill, 0-100) and `weekAtTarget` (which
 * of the two pre-coloured ProgressBar views to show) are both prebaked in
 * widgetSnapshot.ts and simply read here via optInt/optBoolean, same
 * tolerance idiom `emptyExam` below already uses.
 */
public class PruefungWidgetProvider extends AppWidgetProvider {

    // Same file+key WidgetBridgePlugin writes — see that class's own
    // comment on why these are declared in one place, not duplicated.
    private static final String PREFS_NAME = WidgetBridgePlugin.PREFS_NAME;
    private static final String SNAPSHOT_KEY = WidgetBridgePlugin.SNAPSHOT_KEY;

    private static final long DAY_MILLIS = 24L * 60 * 60 * 1000;
    private static final String FALLBACK_LINE1 = "Open Runway once to fill this widget.";
    // m2: distinct from FALLBACK_LINE1 — a snapshot that DOES exist but
    // whose "pruefung" key is null means Deepak has opened the app at least
    // once (so it's had the chance to write a snapshot) but hasn't set up
    // an exam yet. Telling him to "open Runway once" in that case is simply
    // false and, worse, unactionable: opening the app again doesn't create
    // an exam by itself. See renderSnapshot's own comment on where this is
    // used versus renderFallback.
    private static final String NO_EXAM_LINE1 = "No exam set up.";

    // Empty-exam honesty (widgetSnapshot.ts's `emptyExam` field): an exam
    // that exists but has zero topics (or every topic at 0 estimated
    // hours) used to fall through to the ordinary "Ready by {today}"
    // render below — remainingHours sums to 0 over an empty/all-zero topic
    // list exactly like a genuinely finished exam does. Same shape as
    // NO_EXAM_LINE1/renderNoExam (one line, calm colour, lines 2-3 blank)
    // but a distinct sentence: "no exam" and "an exam with nothing in it
    // yet" are different facts and must not share copy.
    private static final String EMPTY_EXAM_LINE1 = "No topics yet.";

    // Same calm/tight/late palette as the app's own STATE_TEXT
    // (src/screens/ExamOverview.tsx) — kept as literal ARGB ints here
    // rather than a values/colors.xml resource, since the widget provider
    // is the only native code that needs them.
    private static final int COLOR_LATE = 0xFFF87171;
    private static final int COLOR_TIGHT = 0xFFFBBF24;
    private static final int COLOR_CALM = 0xFFF1F5F9;

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateOne(context, appWidgetManager, appWidgetId);
        }
    }

    private void updateOne(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_pruefung);

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String snapshotJson = prefs.getString(SNAPSHOT_KEY, null);

        if (snapshotJson == null) {
            renderFallback(views);
        } else {
            try {
                renderSnapshot(views, snapshotJson);
            } catch (JSONException e) {
                // Malformed snapshot should never happen (it's always
                // written by JSON.stringify on the JS side) but a widget
                // must never crash the home screen over a display bug —
                // same fallback as "no snapshot written yet". This also
                // covers m3's schema upgrade window: a snapshot written by
                // an older APK build (offsetDays, no readyDayEpochMs/
                // generatedDayEpochMs) makes pruefung.getLong(...) below
                // throw JSONException rather than silently misreading a
                // wrong field, landing here too. That's an acceptable
                // fallback, not a real gap — the very next app open
                // (widgets.ts's refreshWidgets, called from several
                // screens on load) overwrites SharedPreferences with a
                // fresh, current-schema snapshot and heals it, and this
                // window only exists between installing an updated APK and
                // next opening the app, never during ordinary use.
                renderFallback(views);
            }
        }

        Intent tapIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("runway://exam"));
        tapIntent.setPackage(context.getPackageName());
        // FLAG_IMMUTABLE per the increment brief — this PendingIntent is
        // never modified by the receiving side (no fillInIntent from a
        // RemoteViewsService), so there's no reason to allow mutation, and
        // Android 12+ requires one of IMMUTABLE/MUTABLE to be set
        // explicitly.
        PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, tapIntent, PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, pendingIntent);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private void renderFallback(RemoteViews views) {
        views.setTextViewText(R.id.widget_line1, FALLBACK_LINE1);
        views.setTextColor(R.id.widget_line1, COLOR_CALM);
        views.setTextViewText(R.id.widget_line2, "");
        views.setTextViewText(R.id.widget_line3, "");
        views.setViewVisibility(R.id.widget_progress_row, View.GONE);
    }

    // m2: same shape as renderFallback (one-line message, calm colour,
    // lines 2-3 blank) but a different sentence — see NO_EXAM_LINE1's own
    // comment for why "no snapshot has ever been written" and "a snapshot
    // exists but there's no exam in it" must not share copy. renderFallback
    // itself stays reserved exclusively for the "no snapshot ever" case
    // (snapshotJson == null, or a JSONException while parsing one) — see
    // updateOne above.
    private void renderNoExam(RemoteViews views) {
        views.setTextViewText(R.id.widget_line1, NO_EXAM_LINE1);
        views.setTextColor(R.id.widget_line1, COLOR_CALM);
        views.setTextViewText(R.id.widget_line2, "");
        views.setTextViewText(R.id.widget_line3, "");
        views.setViewVisibility(R.id.widget_progress_row, View.GONE);
    }

    private void renderSnapshot(RemoteViews views, String snapshotJson) throws JSONException {
        JSONObject root = new JSONObject(snapshotJson);
        if (root.isNull("pruefung")) {
            // A snapshot exists (the app has run at least once) but no exam
            // has been set up yet — the tap target below is still
            // runway://exam either way, which is correct here too: Home's
            // own routing already lands on exam setup when db.exams has no
            // row, so tapping this state takes Deepak straight to creating
            // one rather than to a dead end.
            renderNoExam(views);
            return;
        }
        JSONObject pruefung = root.getJSONObject("pruefung");

        boolean neverReady = pruefung.getBoolean("neverReady");
        // optBoolean(..., false): a snapshot written by a pre-empty-exam-fix
        // APK build has no "emptyExam" key at all — org.json's optBoolean
        // tolerates that (returns the default) rather than throwing, same
        // graceful-degradation window this class's JSONException catch
        // already documents for other schema upgrades. Defaulting to false
        // means an old snapshot just falls through to its old rendering
        // until the app is next opened and overwrites it.
        boolean emptyExam = pruefung.optBoolean("emptyExam", false);

        if (emptyExam) {
            // Same shape as renderNoExam (one line, calm colour, lines 2-3
            // blank) — see EMPTY_EXAM_LINE1's own comment for why the
            // sentence must differ from NO_EXAM_LINE1's.
            views.setTextViewText(R.id.widget_line1, EMPTY_EXAM_LINE1);
            views.setTextColor(R.id.widget_line1, COLOR_CALM);
            views.setTextViewText(R.id.widget_line2, "");
            views.setTextViewText(R.id.widget_line3, "");
            views.setViewVisibility(R.id.widget_progress_row, View.GONE);
            return;
        }

        String anchorLabel = pruefung.getString("anchorLabel");
        String weekLine = pruefung.getString("weekLine");
        long weekStartEpochMs = pruefung.getLong("weekStartEpochMs");
        int stateThresholdDays = pruefung.getInt("stateThresholdDays");

        views.setTextViewText(R.id.widget_line2, anchorLabel);

        if (neverReady) {
            // Mirrors examProjection.ts's readyDate === null case exactly
            // (zero measured pace, or an overflowed projection) — see
            // PruefungWidgetData.neverReady's doc comment in
            // widgetSnapshot.ts. readyDayEpochMs/generatedDayEpochMs are
            // meaningless here and are not read.
            views.setTextViewText(R.id.widget_line1, "Ready: never at current pace");
            views.setTextColor(R.id.widget_line1, COLOR_LATE);
        } else {
            // m3: readyDayEpochMs/generatedDayEpochMs are both already local
            // midnight of their respective calendar days (see
            // widgetSnapshot.ts's localMidnight — the JS side builds them
            // that way, not this class). Getting "today" the same way here
            // (midnight, not the current instant) is what keeps the slide
            // count a whole-day count rather than picking up a spurious
            // extra/missing day depending on what time of day the widget
            // happens to redraw.
            long readyDayEpochMs = pruefung.getLong("readyDayEpochMs");
            long generatedDayEpochMs = pruefung.getLong("generatedDayEpochMs");
            long anchorEpochMs = pruefung.getLong("anchorEpochMs");

            Calendar todayMidnight = Calendar.getInstance();
            todayMidnight.set(Calendar.HOUR_OF_DAY, 0);
            todayMidnight.set(Calendar.MINUTE, 0);
            todayMidnight.set(Calendar.SECOND, 0);
            todayMidnight.set(Calendar.MILLISECOND, 0);

            // How many whole calendar days have passed since this snapshot
            // was generated — clamped at 0 (never negative) so a snapshot
            // that's somehow "from the future" (a device clock adjustment
            // between generation and redraw) never slides the ready date
            // backwards; it just renders as of the day it was generated,
            // same as a same-day snapshot would.
            long slideDays = Math.max(0, daysBetween(generatedDayEpochMs, todayMidnight.getTimeInMillis()));

            Calendar displayReadyDay = Calendar.getInstance();
            displayReadyDay.setTimeInMillis(readyDayEpochMs);
            displayReadyDay.add(Calendar.DAY_OF_YEAR, (int) slideDays);

            long slackDays = daysBetween(displayReadyDay.getTimeInMillis(), anchorEpochMs);
            int color;
            if (slackDays < 0) {
                color = COLOR_LATE;
            } else if (slackDays < stateThresholdDays) {
                color = COLOR_TIGHT;
            } else {
                color = COLOR_CALM;
            }

            views.setTextViewText(R.id.widget_line1, "Ready by " + formatDisplayDate(displayReadyDay));
            views.setTextColor(R.id.widget_line1, color);
        }

        // Stale-week guard: once the real device clock has moved past the
        // week this weekLine was computed for, it no longer describes "this
        // week" — hidden rather than shown out of date. A snapshot is only
        // ever refreshed by the app itself (src/native/widgets.ts), so an
        // app that's stayed closed across a Monday rollover is exactly the
        // case this guards against. The progress bar (0.40.0) is gated on
        // the SAME weekIsCurrent check, for the same reason — a bar left
        // over from a stale, no-longer-current week is exactly as
        // out-of-date as the text line it sits beside.
        long nowMillis = System.currentTimeMillis();
        boolean weekIsCurrent = nowMillis < weekStartEpochMs + 7 * DAY_MILLIS;
        views.setTextViewText(R.id.widget_line3, weekIsCurrent ? weekLine : "");

        if (weekIsCurrent) {
            // optInt/optBoolean(..., default): same schema-upgrade
            // tolerance idiom as emptyExam above — a snapshot written by a
            // pre-0.40.0 APK build has neither key, and defaults to a 0%,
            // sky-coloured (not-at-target) bar rather than throwing.
            int weekProgressPercent = pruefung.optInt("weekProgressPercent", 0);
            boolean weekAtTarget = pruefung.optBoolean("weekAtTarget", false);

            views.setViewVisibility(R.id.widget_progress_row, View.VISIBLE);
            // Two pre-coloured ProgressBar views occupying the same
            // FrameLayout cell (see widget_pruefung.xml's own comment on
            // why — RemoteViews can't reliably retint a drawable across
            // every API level this app's minSdk spans, so visibility-
            // toggling two ready-made variants is the robust idiom here,
            // not a workaround). Exactly one is VISIBLE at a time; both get
            // the render-honestly-at-zero treatment (0.40.0 spec) — a 0%
            // bar is never hidden, its empty track IS the visual pressure
            // this widget exists to add.
            if (weekAtTarget) {
                views.setViewVisibility(R.id.widget_progress_sky, View.GONE);
                views.setViewVisibility(R.id.widget_progress_emerald, View.VISIBLE);
                views.setProgressBar(R.id.widget_progress_emerald, 100, weekProgressPercent, false);
            } else {
                views.setViewVisibility(R.id.widget_progress_emerald, View.GONE);
                views.setViewVisibility(R.id.widget_progress_sky, View.VISIBLE);
                views.setProgressBar(R.id.widget_progress_sky, 100, weekProgressPercent, false);
            }
        } else {
            views.setViewVisibility(R.id.widget_progress_row, View.GONE);
        }

        // UNVERIFIED on device: how RemoteViews' ProgressBar renders inside
        // One UI's own widget theming (Samsung launchers are known to
        // reskin some system widget styles) — no Android SDK/emulator
        // available in this environment, same caveat every widget-info XML
        // in this app already documents for itself. The two-drawable
        // visibility-toggle approach is the standard, documented RemoteViews
        // pattern for a coloured progress bar, but "standard" isn't the
        // same as "confirmed on Deepak's actual S25 Ultra home screen".
    }

    /** Whole days between two instants, floor-divided — mirrors
     * examProjection.ts's daysBetween exactly (same floor-division shape).
     * The one date-diff arithmetic op the file-top ARCHITECTURE RULE allows
     * this class to do, not a re-derivation of any business rule. */
    private long daysBetween(long fromMillis, long toMillis) {
        return (long) Math.floor((toMillis - fromMillis) / (double) DAY_MILLIS);
    }

    /** "14 Dec" (this year) / "8 Jun 2028" (a different year) — mirrors
     * format.ts's formatDateMedium rule exactly, including that file's F4
     * reasoning: compare against the real current year, not a fixed
     * "always/never show the year" rule, so a far-out projection still
     * shows an unambiguous year. */
    private String formatDisplayDate(Calendar date) {
        Calendar now = Calendar.getInstance();
        String pattern = date.get(Calendar.YEAR) == now.get(Calendar.YEAR) ? "d MMM" : "d MMM yyyy";
        SimpleDateFormat formatter = new SimpleDateFormat(pattern, Locale.ENGLISH);
        return formatter.format(date.getTime());
    }
}
