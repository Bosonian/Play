package app.dosing.companion;

import java.text.ParseException;
import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;

final class ObservationReminderSchedule {
    static final long MAX_LATE_MILLIS = 30L * 60L * 1000L;
    static final int MAX_STUDY_DAYS = 366;
    private static final TimeZone UTC = TimeZone.getTimeZone("UTC");
    private static final Set<String> TIME_ZONE_IDS;

    static {
        Set<String> ids = new HashSet<>();
        Collections.addAll(ids, TimeZone.getAvailableIDs());
        TIME_ZONE_IDS = Collections.unmodifiableSet(ids);
    }

    private ObservationReminderSchedule() {}

    static boolean isKnownTimeZone(String value) {
        return value != null && value.length() <= 64 && TIME_ZONE_IDS.contains(value);
    }

    static long parseInstant(String value) throws ParseException {
        if (value == null || value.length() > 35) throw new ParseException("invalid", 0);
        String[] patterns = {
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
            "yyyy-MM-dd'T'HH:mm:ssXXX"
        };
        for (String pattern : patterns) {
            SimpleDateFormat format = new SimpleDateFormat(pattern, Locale.US);
            format.setLenient(false);
            ParsePosition position = new ParsePosition(0);
            Date date = format.parse(value, position);
            if (date != null && position.getErrorIndex() < 0 && position.getIndex() == value.length()) return date.getTime();
        }
        throw new ParseException("invalid", 0);
    }

    static String formatInstant(long value) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(UTC);
        return format.format(new Date(value));
    }

    static Occurrence next(Plan plan, long afterExclusive) {
        long lowerBound = Math.max(plan.startedAt, afterExclusive + 1L);
        if (!plan.enabled || lowerBound >= plan.plannedEndAt) return null;
        TimeZone zone = TimeZone.getTimeZone(plan.timeZone);
        Calendar cursor = Calendar.getInstance(zone, Locale.US);
        cursor.setTimeInMillis(lowerBound);
        int year = cursor.get(Calendar.YEAR);
        int month = cursor.get(Calendar.MONTH);
        int day = cursor.get(Calendar.DAY_OF_MONTH);

        for (int dateOffset = 0; dateOffset <= MAX_STUDY_DAYS; dateOffset++) {
            for (int minuteOfDay : plan.times) {
                Long scheduledAt = localInstant(zone, year, month, day, minuteOfDay);
                if (scheduledAt == null || scheduledAt < plan.startedAt || scheduledAt < lowerBound) continue;
                if (scheduledAt >= plan.plannedEndAt) return null;
                String date = String.format(Locale.US, "%04d-%02d-%02d", year, month + 1, day);
                String time = String.format(Locale.US, "%02d:%02d", minuteOfDay / 60, minuteOfDay % 60);
                return new Occurrence(
                    plan.studyId + ":r" + plan.revision + ":" + date + "T" + time,
                    plan.studyId,
                    plan.revision,
                    scheduledAt,
                    date,
                    time
                );
            }
            Calendar nextDate = Calendar.getInstance(zone, Locale.US);
            nextDate.clear();
            nextDate.set(year, month, day, 12, 0, 0);
            nextDate.add(Calendar.DAY_OF_MONTH, 1);
            year = nextDate.get(Calendar.YEAR);
            month = nextDate.get(Calendar.MONTH);
            day = nextDate.get(Calendar.DAY_OF_MONTH);
        }
        return null;
    }

    static long deliveryDeadline(Plan plan, Occurrence occurrence) {
        long deadline = Math.min(plan.plannedEndAt, occurrence.scheduledAt + MAX_LATE_MILLIS);
        Occurrence next = next(plan, occurrence.scheduledAt);
        if (next != null) deadline = Math.min(deadline, next.scheduledAt);
        return deadline;
    }

    private static Long localInstant(TimeZone zone, int year, int month, int day, int minuteOfDay) {
        Calendar calendar = Calendar.getInstance(zone, Locale.US);
        calendar.clear();
        calendar.setLenient(false);
        calendar.set(Calendar.YEAR, year);
        calendar.set(Calendar.MONTH, month);
        calendar.set(Calendar.DAY_OF_MONTH, day);
        calendar.set(Calendar.HOUR_OF_DAY, minuteOfDay / 60);
        calendar.set(Calendar.MINUTE, minuteOfDay % 60);
        calendar.set(Calendar.SECOND, 0);
        calendar.set(Calendar.MILLISECOND, 0);
        try {
            return calendar.getTimeInMillis();
        } catch (IllegalArgumentException exception) {
            return null;
        }
    }

    static final class Plan {
        final String studyId;
        final int revision;
        final boolean enabled;
        final long startedAt;
        final long plannedEndAt;
        final String timeZone;
        final List<Integer> times;

        Plan(String studyId, int revision, boolean enabled, long startedAt, long plannedEndAt, String timeZone, List<Integer> times) {
            this.studyId = studyId;
            this.revision = revision;
            this.enabled = enabled;
            this.startedAt = startedAt;
            this.plannedEndAt = plannedEndAt;
            this.timeZone = timeZone;
            this.times = Collections.unmodifiableList(new ArrayList<>(times));
        }
    }

    static final class Occurrence {
        final String id;
        final String studyId;
        final int revision;
        final long scheduledAt;
        final String localDate;
        final String localTime;

        Occurrence(String id, String studyId, int revision, long scheduledAt, String localDate, String localTime) {
            this.id = id;
            this.studyId = studyId;
            this.revision = revision;
            this.scheduledAt = scheduledAt;
            this.localDate = localDate;
            this.localTime = localTime;
        }
    }
}
