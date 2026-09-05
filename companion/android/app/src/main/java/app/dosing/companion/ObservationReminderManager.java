package app.dosing.companion;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.AtomicFile;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.text.ParseException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class ObservationReminderManager {
    static final String ACTION_ALARM = "app.dosing.companion.observation.ALARM";
    static final String ACTION_OPEN = "app.dosing.companion.observation.OPEN";
    static final String EXTRA_KIND = "kind";
    static final String EXTRA_STUDY = "study";
    static final String EXTRA_REVISION = "revision";
    static final String EXTRA_OCCURRENCE = "occurrence";
    static final String EXTRA_SCHEDULED_AT = "scheduledAt";
    static final String EXTRA_DELIVERED_AT = "deliveredAt";
    static final String EXTRA_TOKEN = "token";

    private static final Object LOCK = new Object();
    private static final int SCHEMA_VERSION = 1;
    private static final int ALARM_REQUEST_CODE = 7401;
    private static final int OPEN_REQUEST_CODE = 7402;
    private static final int NOTIFICATION_ID = 7403;
    private static final int MAX_STATE_BYTES = 64 * 1024;
    private static final int MAX_CUSTOM_TIMES = 48;
    private static final long MAX_STUDY_MILLIS = 367L * 24L * 60L * 60L * 1000L;
    private static final String STATE_FILE = "observation-reminders-v1.json";
    private static final String CHANNEL_ID = "companion-observation-check-ins-v1";
    private static final Pattern STUDY_ID = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}");
    private static final Pattern TIME = Pattern.compile("([01]\\d|2[0-3]):([0-5]\\d)");
    private static final SecureRandom RANDOM = new SecureRandom();

    private ObservationReminderManager() {}

    static JSObject replacePlan(
        Context context,
        String studyId,
        Integer revision,
        String startedAt,
        String plannedEndAt,
        JSObject planObject,
        Activity activity
    ) throws ReminderException {
        ObservationReminderSchedule.Plan incoming = parsePlan(studyId, revision, startedAt, plannedEndAt, planObject);
        synchronized (LOCK) {
            State state = load(context);
            if (state.plan != null && state.plan.studyId.equals(incoming.studyId)) {
                if (incoming.revision < state.plan.revision) {
                    throw error("STALE_REVISION", "A newer reminder plan is already active.");
                }
                if (incoming.revision == state.plan.revision) {
                    if (!samePlan(state.plan, incoming)) {
                        throw error("REVISION_CONFLICT", "This reminder revision already has different settings.");
                    }
                    long now = System.currentTimeMillis();
                    reconcileLocked(context, state, now, true);
                    save(context, state);
                    return statusLocked(context, activity, state, now);
                }
            }
            clearAlarmAndNotification(context);
            state.clearPlan();
            long now = System.currentTimeMillis();
            if (incoming.enabled && now < incoming.plannedEndAt) {
                state.plan = incoming;
                scheduleNextLocked(context, state, now);
            }
            save(context, state);
            return statusLocked(context, activity, state, now);
        }
    }

    static JSObject cancelStudy(Context context, String studyId, Activity activity) throws ReminderException {
        if (!validStudyId(studyId)) throw error("INVALID_STUDY_ID", "The observation study ID is invalid.");
        synchronized (LOCK) {
            State state = load(context);
            if (state.plan != null && state.plan.studyId.equals(studyId)) {
                clearAlarmAndNotification(context);
                state.clearPlan();
                save(context, state);
            }
            return statusLocked(context, activity, state, System.currentTimeMillis());
        }
    }

    static JSObject getStatus(Context context, Activity activity) throws ReminderException {
        synchronized (LOCK) {
            State state = load(context);
            reconcileLocked(context, state, System.currentTimeMillis(), true);
            save(context, state);
            return statusLocked(context, activity, state, System.currentTimeMillis());
        }
    }

    static void markPermissionRequested(Context context) throws ReminderException {
        synchronized (LOCK) {
            State state = load(context);
            state.permissionRequested = true;
            save(context, state);
        }
    }

    static JSObject getPendingOpen(Context context) throws ReminderException {
        synchronized (LOCK) {
            State state = load(context);
            long now = System.currentTimeMillis();
            if (state.plan != null && now >= state.plan.plannedEndAt) {
                clearAlarmAndNotification(context);
                state.clearPlan();
                save(context, state);
            } else if (state.plan == null || !pendingMatchesPlan(state)) {
                state.pending = null;
                save(context, state);
            }
            JSObject result = new JSObject();
            result.put("schemaVersion", SCHEMA_VERSION);
            result.put("pending", state.pending == null ? JSONObject.NULL : pendingObject(state.pending));
            return result;
        }
    }

    static JSObject acknowledgeOpen(Context context, String occurrenceId) throws ReminderException {
        if (occurrenceId == null || occurrenceId.length() > 220) {
            throw error("INVALID_OCCURRENCE_ID", "The reminder occurrence ID is invalid.");
        }
        synchronized (LOCK) {
            State state = load(context);
            boolean acknowledged = state.pending != null && state.pending.occurrenceId.equals(occurrenceId);
            if (acknowledged) {
                state.pending = null;
                state.delivery = null;
                save(context, state);
                NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID);
            }
            JSObject result = new JSObject();
            result.put("schemaVersion", SCHEMA_VERSION);
            result.put("acknowledged", acknowledged);
            return result;
        }
    }

    static boolean captureOpenIntent(Context context, Intent intent) {
        if (intent == null || !ACTION_OPEN.equals(intent.getAction())) return false;
        synchronized (LOCK) {
            try {
                State state = load(context);
                long now = System.currentTimeMillis();
                Delivery delivery = state.delivery;
                String token = intent.getStringExtra(EXTRA_TOKEN);
                if (state.plan == null || delivery == null || token == null || now >= state.plan.plannedEndAt) return false;
                if (!delivery.token.equals(token)
                    || !delivery.occurrenceId.equals(intent.getStringExtra(EXTRA_OCCURRENCE))
                    || !delivery.studyId.equals(intent.getStringExtra(EXTRA_STUDY))
                    || delivery.revision != intent.getIntExtra(EXTRA_REVISION, -1)
                    || delivery.scheduledAt != intent.getLongExtra(EXTRA_SCHEDULED_AT, -1L)
                    || delivery.deliveredAt != intent.getLongExtra(EXTRA_DELIVERED_AT, -1L)
                    || !delivery.studyId.equals(state.plan.studyId)
                    || delivery.revision != state.plan.revision) return false;
                state.pending = new PendingOpen(
                    delivery.occurrenceId,
                    delivery.studyId,
                    delivery.revision,
                    delivery.scheduledAt,
                    delivery.deliveredAt,
                    now
                );
                state.delivery = null;
                save(context, state);
                NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID);
                return true;
            } catch (ReminderException ignored) {
                // A malformed private state never becomes an open request.
            }
        }
        return false;
    }

    static void onAlarm(Context context, Intent intent) {
        if (intent == null || !ACTION_ALARM.equals(intent.getAction())) return;
        synchronized (LOCK) {
            try {
                State state = load(context);
                long now = System.currentTimeMillis();
                if (state.plan == null) return;
                if (!state.plan.enabled || now >= state.plan.plannedEndAt) {
                    clearAlarmAndNotification(context);
                    state.clearPlan();
                    save(context, state);
                    return;
                }
                if (!state.plan.studyId.equals(intent.getStringExtra(EXTRA_STUDY))
                    || state.plan.revision != intent.getIntExtra(EXTRA_REVISION, -1)) return;
                String kind = intent.getStringExtra(EXTRA_KIND);
                if ("expire".equals(kind)) {
                    if (now >= state.plan.plannedEndAt) {
                        clearAlarmAndNotification(context);
                        state.clearPlan();
                        save(context, state);
                    } else {
                        scheduleExpiry(context, state.plan);
                    }
                    return;
                }
                deliverOccurrenceLocked(context, state, intent, now);
            } catch (ReminderException ignored) {
                clearAlarmAndNotification(context);
            }
        }
    }

    static void restoreAfterSystemChange(Context context) {
        synchronized (LOCK) {
            try {
                State state = load(context);
                clearAlarmAndNotification(context);
                state.delivery = null;
                state.pending = null;
                state.next = null;
                reconcileLocked(context, state, System.currentTimeMillis(), true);
                save(context, state);
            } catch (ReminderException ignored) {
                clearAlarmAndNotification(context);
            }
        }
    }

    private static void deliverOccurrenceLocked(Context context, State state, Intent intent, long now) throws ReminderException {
        ObservationReminderSchedule.Occurrence expected = state.next;
        if (expected == null
            || !expected.id.equals(intent.getStringExtra(EXTRA_OCCURRENCE))
            || expected.revision != intent.getIntExtra(EXTRA_REVISION, -1)
            || expected.scheduledAt != intent.getLongExtra(EXTRA_SCHEDULED_AT, -1L)
            || expected.scheduledAt < state.plan.startedAt
            || expected.scheduledAt >= state.plan.plannedEndAt
            || !state.plan.enabled
            || now >= state.plan.plannedEndAt) return;

        if (now < expected.scheduledAt) {
            setAlarm(context, state.plan, expected, false);
            return;
        }

        boolean timely = now < ObservationReminderSchedule.deliveryDeadline(state.plan, expected);
        boolean newOccurrence = !expected.id.equals(state.lastDeliveredId);
        state.next = null;
        Delivery delivery = null;
        if (timely && newOccurrence && notificationsGranted(context)) {
            delivery = new Delivery(
                expected.id,
                expected.studyId,
                expected.revision,
                expected.scheduledAt,
                now,
                randomToken()
            );
            state.lastDeliveredId = expected.id;
            state.delivery = delivery;
            state.pending = null;
        }
        scheduleNextLocked(context, state, now);
        save(context, state);
        if (delivery != null) postNotification(context, state.plan, delivery);
    }

    private static void reconcileLocked(Context context, State state, long now, boolean force) {
        if (state.plan == null) return;
        if (!state.plan.enabled || now >= state.plan.plannedEndAt) {
            clearAlarmAndNotification(context);
            state.clearPlan();
            return;
        }
        if (state.next != null) {
            if (state.next.scheduledAt <= now) {
                if (now < ObservationReminderSchedule.deliveryDeadline(state.plan, state.next)) {
                    setAlarm(context, state.plan, state.next, false);
                    return;
                }
                state.next = null;
            } else {
                if (force) setAlarm(context, state.plan, state.next, false);
                return;
            }
        }
        scheduleNextLocked(context, state, now);
    }

    private static void scheduleNextLocked(Context context, State state, long now) {
        if (state.plan == null || !state.plan.enabled || now >= state.plan.plannedEndAt) return;
        ObservationReminderSchedule.Occurrence next = ObservationReminderSchedule.next(state.plan, now);
        state.next = next;
        if (next == null) {
            scheduleExpiry(context, state.plan);
        } else {
            setAlarm(context, state.plan, next, false);
        }
    }

    private static void scheduleExpiry(Context context, ObservationReminderSchedule.Plan plan) {
        setAlarm(context, plan, null, true);
    }

    private static void setAlarm(
        Context context,
        ObservationReminderSchedule.Plan plan,
        ObservationReminderSchedule.Occurrence occurrence,
        boolean expiry
    ) {
        Intent intent = new Intent(context, ObservationReminderReceiver.class)
            .setAction(ACTION_ALARM)
            .putExtra(EXTRA_KIND, expiry ? "expire" : "occurrence")
            .putExtra(EXTRA_STUDY, plan.studyId)
            .putExtra(EXTRA_REVISION, plan.revision);
        long triggerAt;
        if (expiry) {
            triggerAt = plan.plannedEndAt;
        } else {
            intent.putExtra(EXTRA_OCCURRENCE, occurrence.id);
            intent.putExtra(EXTRA_SCHEDULED_AT, occurrence.scheduledAt);
            triggerAt = occurrence.scheduledAt;
        }
        PendingIntent pending = PendingIntent.getBroadcast(
            context,
            ALARM_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) alarms.set(AlarmManager.RTC_WAKEUP, triggerAt, pending);
    }

    private static void clearAlarmAndNotification(Context context) {
        Intent intent = new Intent(context, ObservationReminderReceiver.class).setAction(ACTION_ALARM);
        PendingIntent pending = PendingIntent.getBroadcast(
            context,
            ALARM_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
        );
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms != null && pending != null) alarms.cancel(pending);
        if (pending != null) pending.cancel();
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID);
    }

    private static void postNotification(Context context, ObservationReminderSchedule.Plan plan, Delivery delivery) {
        ensureChannel(context);
        Intent open = new Intent(context, MainActivity.class)
            .setAction(ACTION_OPEN)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_STUDY, delivery.studyId)
            .putExtra(EXTRA_REVISION, delivery.revision)
            .putExtra(EXTRA_OCCURRENCE, delivery.occurrenceId)
            .putExtra(EXTRA_SCHEDULED_AT, delivery.scheduledAt)
            .putExtra(EXTRA_DELIVERED_AT, delivery.deliveredAt)
            .putExtra(EXTRA_TOKEN, delivery.token);
        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            OPEN_REQUEST_CODE,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationCompat.Builder notification = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification_companion)
            .setContentTitle("Companion check-in")
            .setContentText("Open Companion for your scheduled check-in.")
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            notification.setTimeoutAfter(Math.max(1L, plan.plannedEndAt - System.currentTimeMillis()));
        }
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification.build());
        } catch (SecurityException ignored) {
            // Permission may have changed after the alarm validation.
        }
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Observation check-ins",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Private reminders to open Companion for a scheduled check-in.");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private static boolean notificationsGranted(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel channel = manager == null ? null : manager.getNotificationChannel(CHANNEL_ID);
            if (channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        }
        return true;
    }

    private static String permissionState(Context context, Activity activity, boolean requested) {
        if (notificationsGranted(context)) return "granted";
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return "settings";
        if (!requested) return "not-requested";
        if (activity != null && activity.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) return "denied";
        return "settings";
    }

    private static JSObject statusLocked(Context context, Activity activity, State state, long now) {
        JSObject result = new JSObject();
        boolean configured = state.plan != null && state.plan.enabled && now < state.plan.plannedEndAt;
        result.put("schemaVersion", SCHEMA_VERSION);
        result.put("permission", permissionState(context, activity, state.permissionRequested));
        result.put("configured", configured);
        result.put("studyId", configured ? state.plan.studyId : JSONObject.NULL);
        result.put("revision", configured ? state.plan.revision : JSONObject.NULL);
        result.put("nextScheduledAt", configured && state.next != null
            ? ObservationReminderSchedule.formatInstant(state.next.scheduledAt)
            : JSONObject.NULL);
        return result;
    }

    private static JSObject pendingObject(PendingOpen pending) {
        JSObject result = new JSObject();
        result.put("occurrenceId", pending.occurrenceId);
        result.put("studyId", pending.studyId);
        result.put("revision", pending.revision);
        result.put("scheduledAt", ObservationReminderSchedule.formatInstant(pending.scheduledAt));
        result.put("deliveredAt", ObservationReminderSchedule.formatInstant(pending.deliveredAt));
        result.put("openedAt", ObservationReminderSchedule.formatInstant(pending.openedAt));
        return result;
    }

    private static boolean pendingMatchesPlan(State state) {
        return state.pending != null && state.plan != null
            && state.pending.studyId.equals(state.plan.studyId)
            && state.pending.revision == state.plan.revision
            && state.pending.scheduledAt >= state.plan.startedAt
            && state.pending.scheduledAt < state.plan.plannedEndAt;
    }

    private static boolean samePlan(
        ObservationReminderSchedule.Plan left,
        ObservationReminderSchedule.Plan right
    ) {
        return left.studyId.equals(right.studyId)
            && left.revision == right.revision
            && left.enabled == right.enabled
            && left.startedAt == right.startedAt
            && left.plannedEndAt == right.plannedEndAt
            && left.timeZone.equals(right.timeZone)
            && left.times.equals(right.times);
    }

    private static ObservationReminderSchedule.Plan parsePlan(
        String studyId,
        Integer revision,
        String startedAt,
        String plannedEndAt,
        JSObject object
    ) throws ReminderException {
        if (!validStudyId(studyId)) throw error("INVALID_STUDY_ID", "The observation study ID is invalid.");
        if (object == null) throw error("INVALID_PLAN", "The reminder plan is missing.");
        Integer version = object.getInteger("version");
        Integer planRevision = object.getInteger("revision");
        Boolean enabled = object.getBool("enabled");
        String mode = object.getString("mode");
        String timeZone = object.getString("timeZone");
        String firstTime = object.getString("firstTime");
        String lastTime = object.getString("lastTime");
        if (version == null || version != 1 || revision == null || revision < 1 || revision > 1_000_000_000
            || planRevision == null || !revision.equals(planRevision) || enabled == null
            || (!"interval".equals(mode) && !"custom".equals(mode))
            || !ObservationReminderSchedule.isKnownTimeZone(timeZone)) {
            throw error("INVALID_PLAN", "The reminder plan is invalid.");
        }
        int first = timeMinutes(firstTime);
        int last = timeMinutes(lastTime);
        if (first < 0 || last < 0 || first >= last) throw error("INVALID_PLAN", "The reminder time window is invalid.");

        List<Integer> times = new ArrayList<>();
        if ("interval".equals(mode)) {
            Integer interval = object.getInteger("intervalMinutes");
            if (interval == null || (interval != 30 && interval != 60 && interval != 120 && interval != 240)) {
                throw error("INVALID_PLAN", "The reminder interval is invalid.");
            }
            for (int value = first; value <= last; value += interval) times.add(value);
        } else {
            JSONArray custom = object.optJSONArray("customTimes");
            if (custom == null || custom.length() == 0 || custom.length() > MAX_CUSTOM_TIMES) {
                throw error("INVALID_PLAN", "The custom reminder times are invalid.");
            }
            Set<Integer> unique = new HashSet<>();
            for (int index = 0; index < custom.length(); index++) {
                Object raw = custom.opt(index);
                if (!(raw instanceof String)) throw error("INVALID_PLAN", "The custom reminder times are invalid.");
                int value = timeMinutes((String) raw);
                if (value < first || value > last || !unique.add(value)) {
                    throw error("INVALID_PLAN", "The custom reminder times are invalid.");
                }
                times.add(value);
            }
            Collections.sort(times);
        }

        try {
            long start = ObservationReminderSchedule.parseInstant(startedAt);
            long end = ObservationReminderSchedule.parseInstant(plannedEndAt);
            if (end <= start || end - start > MAX_STUDY_MILLIS) {
                throw error("INVALID_WINDOW", "The observation reminder window is invalid.");
            }
            return new ObservationReminderSchedule.Plan(studyId, revision, enabled, start, end, timeZone, times);
        } catch (ParseException exception) {
            throw error("INVALID_WINDOW", "The observation reminder window is invalid.");
        }
    }

    private static int timeMinutes(String value) {
        if (value == null) return -1;
        Matcher match = TIME.matcher(value);
        if (!match.matches()) return -1;
        return Integer.parseInt(match.group(1)) * 60 + Integer.parseInt(match.group(2));
    }

    private static boolean validStudyId(String value) {
        return value != null && STUDY_ID.matcher(value).matches();
    }

    private static State load(Context context) throws ReminderException {
        AtomicFile file = stateFile(context);
        if (!file.getBaseFile().exists()) return new State();
        try (FileInputStream input = file.openRead()) {
            byte[] bytes = readBounded(input);
            return stateFromJson(new JSONObject(new String(bytes, StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw error("STATE_ERROR", "The private reminder state could not be read.");
        }
    }

    private static void save(Context context, State state) throws ReminderException {
        AtomicFile file = stateFile(context);
        FileOutputStream output = null;
        try {
            byte[] bytes = stateToJson(state).toString().getBytes(StandardCharsets.UTF_8);
            if (bytes.length > MAX_STATE_BYTES) throw new IOException();
            output = file.startWrite();
            output.write(bytes);
            file.finishWrite(output);
            output = null;
        } catch (Exception exception) {
            if (output != null) file.failWrite(output);
            throw error("STATE_ERROR", "The private reminder state could not be saved.");
        }
    }

    private static AtomicFile stateFile(Context context) {
        return new AtomicFile(new File(context.getNoBackupFilesDir(), STATE_FILE));
    }

    private static byte[] readBounded(FileInputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int total = 0;
        int count;
        while ((count = input.read(buffer)) != -1) {
            total += count;
            if (total > MAX_STATE_BYTES) throw new IOException();
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    private static JSONObject stateToJson(State state) throws JSONException {
        JSONObject root = new JSONObject();
        root.put("version", SCHEMA_VERSION);
        root.put("permissionRequested", state.permissionRequested);
        if (state.plan != null) root.put("plan", planToJson(state.plan));
        if (state.next != null) root.put("next", occurrenceToJson(state.next));
        if (state.lastDeliveredId != null) root.put("lastDeliveredId", state.lastDeliveredId);
        if (state.delivery != null) root.put("delivery", deliveryToJson(state.delivery));
        if (state.pending != null) root.put("pending", pendingToJson(state.pending));
        return root;
    }

    private static State stateFromJson(JSONObject root) throws JSONException, ReminderException {
        if (root.optInt("version", -1) != SCHEMA_VERSION) throw error("STATE_ERROR", "The private reminder state is invalid.");
        State state = new State();
        state.permissionRequested = root.optBoolean("permissionRequested", false);
        JSONObject plan = root.optJSONObject("plan");
        if (plan != null) state.plan = planFromJson(plan);
        JSONObject next = root.optJSONObject("next");
        if (next != null) state.next = occurrenceFromJson(next);
        state.lastDeliveredId = optionalString(root, "lastDeliveredId", 220);
        JSONObject delivery = root.optJSONObject("delivery");
        if (delivery != null) state.delivery = deliveryFromJson(delivery);
        JSONObject pending = root.optJSONObject("pending");
        if (pending != null) state.pending = pendingFromJson(pending);
        return state;
    }

    private static JSONObject planToJson(ObservationReminderSchedule.Plan plan) throws JSONException {
        JSONObject value = new JSONObject();
        value.put("studyId", plan.studyId);
        value.put("revision", plan.revision);
        value.put("enabled", plan.enabled);
        value.put("startedAt", plan.startedAt);
        value.put("plannedEndAt", plan.plannedEndAt);
        value.put("timeZone", plan.timeZone);
        JSONArray times = new JSONArray();
        for (int time : plan.times) times.put(time);
        value.put("times", times);
        return value;
    }

    private static ObservationReminderSchedule.Plan planFromJson(JSONObject value) throws ReminderException {
        String studyId = requiredString(value, "studyId", 128);
        int revision = positiveInt(value, "revision");
        boolean enabled = value.optBoolean("enabled", false);
        long startedAt = requiredLong(value, "startedAt");
        long plannedEndAt = requiredLong(value, "plannedEndAt");
        String timeZone = requiredString(value, "timeZone", 64);
        JSONArray values = value.optJSONArray("times");
        if (!validStudyId(studyId) || !ObservationReminderSchedule.isKnownTimeZone(timeZone)
            || plannedEndAt <= startedAt || plannedEndAt - startedAt > MAX_STUDY_MILLIS
            || values == null || values.length() == 0 || values.length() > MAX_CUSTOM_TIMES) {
            throw error("STATE_ERROR", "The private reminder state is invalid.");
        }
        List<Integer> times = new ArrayList<>();
        int previous = -1;
        for (int index = 0; index < values.length(); index++) {
            int time = values.optInt(index, -1);
            if (time < 0 || time > 1439 || time <= previous) throw error("STATE_ERROR", "The private reminder state is invalid.");
            times.add(time);
            previous = time;
        }
        return new ObservationReminderSchedule.Plan(studyId, revision, enabled, startedAt, plannedEndAt, timeZone, times);
    }

    private static JSONObject occurrenceToJson(ObservationReminderSchedule.Occurrence value) throws JSONException {
        return new JSONObject()
            .put("id", value.id)
            .put("studyId", value.studyId)
            .put("revision", value.revision)
            .put("scheduledAt", value.scheduledAt)
            .put("localDate", value.localDate)
            .put("localTime", value.localTime);
    }

    private static ObservationReminderSchedule.Occurrence occurrenceFromJson(JSONObject value) throws ReminderException {
        String id = requiredString(value, "id", 220);
        String studyId = requiredString(value, "studyId", 128);
        int revision = positiveInt(value, "revision");
        long scheduledAt = requiredLong(value, "scheduledAt");
        String localDate = requiredString(value, "localDate", 10);
        String localTime = requiredString(value, "localTime", 5);
        if (!validStudyId(studyId) || !TIME.matcher(localTime).matches()
            || !id.equals(studyId + ":r" + revision + ":" + localDate + "T" + localTime)) {
            throw error("STATE_ERROR", "The private reminder state is invalid.");
        }
        return new ObservationReminderSchedule.Occurrence(id, studyId, revision, scheduledAt, localDate, localTime);
    }

    private static JSONObject deliveryToJson(Delivery value) throws JSONException {
        return new JSONObject()
            .put("occurrenceId", value.occurrenceId)
            .put("studyId", value.studyId)
            .put("revision", value.revision)
            .put("scheduledAt", value.scheduledAt)
            .put("deliveredAt", value.deliveredAt)
            .put("token", value.token);
    }

    private static Delivery deliveryFromJson(JSONObject value) throws ReminderException {
        return new Delivery(
            requiredString(value, "occurrenceId", 220),
            requiredString(value, "studyId", 128),
            positiveInt(value, "revision"),
            requiredLong(value, "scheduledAt"),
            requiredLong(value, "deliveredAt"),
            requiredString(value, "token", 64)
        );
    }

    private static JSONObject pendingToJson(PendingOpen value) throws JSONException {
        return new JSONObject()
            .put("occurrenceId", value.occurrenceId)
            .put("studyId", value.studyId)
            .put("revision", value.revision)
            .put("scheduledAt", value.scheduledAt)
            .put("deliveredAt", value.deliveredAt)
            .put("openedAt", value.openedAt);
    }

    private static PendingOpen pendingFromJson(JSONObject value) throws ReminderException {
        return new PendingOpen(
            requiredString(value, "occurrenceId", 220),
            requiredString(value, "studyId", 128),
            positiveInt(value, "revision"),
            requiredLong(value, "scheduledAt"),
            requiredLong(value, "deliveredAt"),
            requiredLong(value, "openedAt")
        );
    }

    private static String requiredString(JSONObject object, String key, int max) throws ReminderException {
        Object value = object.opt(key);
        if (!(value instanceof String) || ((String) value).isEmpty() || ((String) value).length() > max) {
            throw error("STATE_ERROR", "The private reminder state is invalid.");
        }
        return (String) value;
    }

    private static String optionalString(JSONObject object, String key, int max) throws ReminderException {
        if (!object.has(key)) return null;
        return requiredString(object, key, max);
    }

    private static int positiveInt(JSONObject object, String key) throws ReminderException {
        Object value = object.opt(key);
        if (!(value instanceof Integer) || (Integer) value < 1 || (Integer) value > 1_000_000_000) {
            throw error("STATE_ERROR", "The private reminder state is invalid.");
        }
        return (Integer) value;
    }

    private static long requiredLong(JSONObject object, String key) throws ReminderException {
        Object value = object.opt(key);
        if (!(value instanceof Number)) throw error("STATE_ERROR", "The private reminder state is invalid.");
        return ((Number) value).longValue();
    }

    private static String randomToken() {
        byte[] bytes = new byte[24];
        RANDOM.nextBytes(bytes);
        StringBuilder value = new StringBuilder(bytes.length * 2);
        for (byte item : bytes) value.append(String.format(Locale.US, "%02x", item & 0xff));
        return value.toString();
    }

    static ReminderException error(String code, String message) {
        return new ReminderException(code, message);
    }

    static final class ReminderException extends Exception {
        final String code;
        final String safeMessage;

        ReminderException(String code, String safeMessage) {
            super(code);
            this.code = code;
            this.safeMessage = safeMessage;
        }
    }

    private static final class State {
        boolean permissionRequested;
        ObservationReminderSchedule.Plan plan;
        ObservationReminderSchedule.Occurrence next;
        String lastDeliveredId;
        Delivery delivery;
        PendingOpen pending;

        void clearPlan() {
            plan = null;
            next = null;
            lastDeliveredId = null;
            delivery = null;
            pending = null;
        }
    }

    private static final class Delivery {
        final String occurrenceId;
        final String studyId;
        final int revision;
        final long scheduledAt;
        final long deliveredAt;
        String token;

        Delivery(String occurrenceId, String studyId, int revision, long scheduledAt, long deliveredAt, String token) {
            this.occurrenceId = occurrenceId;
            this.studyId = studyId;
            this.revision = revision;
            this.scheduledAt = scheduledAt;
            this.deliveredAt = deliveredAt;
            this.token = token;
        }
    }

    private static final class PendingOpen {
        final String occurrenceId;
        final String studyId;
        final int revision;
        final long scheduledAt;
        final long deliveredAt;
        final long openedAt;

        PendingOpen(String occurrenceId, String studyId, int revision, long scheduledAt, long deliveredAt, long openedAt) {
            this.occurrenceId = occurrenceId;
            this.studyId = studyId;
            this.revision = revision;
            this.scheduledAt = scheduledAt;
            this.deliveredAt = deliveredAt;
            this.openedAt = openedAt;
        }
    }
}
