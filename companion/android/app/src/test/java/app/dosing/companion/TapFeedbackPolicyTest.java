package app.dosing.companion;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class TapFeedbackPolicyTest {
    @Test
    public void sessionTokenMustBePresentAndBounded() {
        assertTrue(TapFeedbackPolicy.isValidSessionToken("assessment-session-1"));
        assertFalse(TapFeedbackPolicy.isValidSessionToken(null));
        assertFalse(TapFeedbackPolicy.isValidSessionToken(""));
        assertFalse(TapFeedbackPolicy.isValidSessionToken("x".repeat(129)));
    }

    @Test
    public void acceptsOnlyCurrentRequestsWithinTheFreshnessWindow() {
        long now = 2_000L;
        assertTrue(TapFeedbackPolicy.isFresh(1_850L, now));
        assertTrue(TapFeedbackPolicy.isFresh(now, now));
        assertFalse(TapFeedbackPolicy.isFresh(1_849L, now));
        assertFalse(TapFeedbackPolicy.isFresh(2_001L, now));
        assertFalse(TapFeedbackPolicy.isFresh(-1L, now));
    }
}
