package app.dosing.companion;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import org.junit.Test;

public class ObservationReminderScheduleTest {
    private static long at(String value) throws Exception {
        return ObservationReminderSchedule.parseInstant(value);
    }

    private static ObservationReminderSchedule.Plan plan(
        String studyId,
        int revision,
        String start,
        String end,
        String zone,
        Integer... times
    ) throws Exception {
        return new ObservationReminderSchedule.Plan(
            studyId,
            revision,
            true,
            at(start),
            at(end),
            zone,
            Arrays.asList(times)
        );
    }

    @Test
    public void skipsNonexistentSpringTimeAndKeepsStableIdentity() throws Exception {
        ObservationReminderSchedule.Plan plan = plan(
            "study-1", 3,
            "2026-03-28T00:00:00.000Z", "2026-03-31T00:00:00.000Z",
            "Europe/Berlin", 150
        );
        ObservationReminderSchedule.Occurrence first = ObservationReminderSchedule.next(plan, at("2026-03-29T00:00:00.000Z"));
        assertEquals("study-1:r3:2026-03-30T02:30", first.id);
        assertEquals("2026-03-30T00:30:00.000Z", ObservationReminderSchedule.formatInstant(first.scheduledAt));
    }

    @Test
    public void emitsRepeatedAutumnWallTimeOnlyOnce() throws Exception {
        ObservationReminderSchedule.Plan plan = plan(
            "study-2", 1,
            "2026-10-24T00:00:00.000Z", "2026-10-27T00:00:00.000Z",
            "Europe/Berlin", 150
        );
        ObservationReminderSchedule.Occurrence repeated = ObservationReminderSchedule.next(plan, at("2026-10-25T00:00:00.000Z"));
        assertEquals("study-2:r1:2026-10-25T02:30", repeated.id);
        assertEquals("2026-10-25T01:30:00.000Z", ObservationReminderSchedule.formatInstant(repeated.scheduledAt));
        ObservationReminderSchedule.Occurrence following = ObservationReminderSchedule.next(plan, repeated.scheduledAt);
        assertEquals("study-2:r1:2026-10-26T02:30", following.id);
    }

    @Test
    public void skipsNewYorkSpringGapAtTheExactUtcBoundary() throws Exception {
        ObservationReminderSchedule.Plan plan = plan(
            "study-ny-spring", 1,
            "2026-03-08T00:00:00.000Z", "2026-03-10T12:00:00.000Z",
            "America/New_York", 150
        );
        ObservationReminderSchedule.Occurrence next = ObservationReminderSchedule.next(
            plan, at("2026-03-08T00:00:00.000Z")
        );
        assertEquals("study-ny-spring:r1:2026-03-09T02:30", next.id);
        assertEquals("2026-03-09T06:30:00.000Z", ObservationReminderSchedule.formatInstant(next.scheduledAt));
    }

    @Test
    public void choosesLaterNewYorkInstantInRepeatedFallWallTime() throws Exception {
        ObservationReminderSchedule.Plan plan = plan(
            "study-ny-fall", 1,
            "2026-11-01T00:00:00.000Z", "2026-11-02T12:00:00.000Z",
            "America/New_York", 90
        );
        ObservationReminderSchedule.Occurrence repeated = ObservationReminderSchedule.next(
            plan, at("2026-11-01T00:00:00.000Z")
        );
        assertEquals("study-ny-fall:r1:2026-11-01T01:30", repeated.id);
        assertEquals("2026-11-01T06:30:00.000Z", ObservationReminderSchedule.formatInstant(repeated.scheduledAt));
    }

    @Test
    public void latenessNeverPassesNextSlotThirtyMinutesOrStudyEnd() throws Exception {
        ObservationReminderSchedule.Plan closeSlots = plan(
            "study-3", 2,
            "2026-09-05T07:00:00.000Z", "2026-09-05T10:00:00.000Z",
            "UTC", 480, 490
        );
        ObservationReminderSchedule.Occurrence first = ObservationReminderSchedule.next(closeSlots, at("2026-09-05T07:00:00.000Z"));
        assertEquals(at("2026-09-05T08:10:00.000Z"), ObservationReminderSchedule.deliveryDeadline(closeSlots, first));

        ObservationReminderSchedule.Plan finalSlot = plan(
            "study-4", 1,
            "2026-09-05T07:00:00.000Z", "2026-09-05T08:20:00.000Z",
            "UTC", 480
        );
        ObservationReminderSchedule.Occurrence only = ObservationReminderSchedule.next(finalSlot, at("2026-09-05T07:00:00.000Z"));
        assertEquals(at("2026-09-05T08:20:00.000Z"), ObservationReminderSchedule.deliveryDeadline(finalSlot, only));
    }

    @Test
    public void enforcesStudyWindowAndDisabledPlan() throws Exception {
        ObservationReminderSchedule.Plan ended = plan(
            "study-5", 1,
            "2026-09-05T08:30:00.000Z", "2026-09-05T09:30:00.000Z",
            "UTC", 480, 540, 600
        );
        ObservationReminderSchedule.Occurrence occurrence = ObservationReminderSchedule.next(ended, at("2026-09-05T08:00:00.000Z"));
        assertEquals("09:00", occurrence.localTime);
        assertNull(ObservationReminderSchedule.next(ended, at("2026-09-05T09:00:00.000Z")));

        ObservationReminderSchedule.Plan disabled = new ObservationReminderSchedule.Plan(
            ended.studyId, ended.revision, false, ended.startedAt, ended.plannedEndAt, ended.timeZone, ended.times
        );
        assertNull(ObservationReminderSchedule.next(disabled, at("2026-09-05T08:00:00.000Z")));
        assertTrue(ObservationReminderSchedule.isKnownTimeZone("Europe/Berlin"));
    }
}
