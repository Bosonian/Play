package app.dosing.companion;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class MedicineOcrPolicyTest {
    @Test
    public void acceptsOnlyCanonicalProjectAndRequestIdentifiers() {
        assertTrue(MedicineOcrPolicy.isValidProjectId("companion-vision-123"));
        assertFalse(MedicineOcrPolicy.isValidProjectId("Companion Vision"));
        assertFalse(MedicineOcrPolicy.isValidProjectId("https://example.test"));
        assertTrue(MedicineOcrPolicy.isValidRequestId("photo_2026-09-05.1"));
        assertFalse(MedicineOcrPolicy.isValidRequestId("photo/../../secret"));
    }

    @Test
    public void rejectsOversizedTextAndAllowsOnlyInlinePhotoMimeTypes() {
        assertTrue(MedicineOcrPolicy.isSupportedMimeType("image/jpeg"));
        assertTrue(MedicineOcrPolicy.isSupportedMimeType(" IMAGE/PNG "));
        assertFalse(MedicineOcrPolicy.isSupportedMimeType("application/pdf"));
        String oversized = "x".repeat(MedicineOcrPolicy.MAX_TEXT_CHARS + 50);
        assertFalse(MedicineOcrPolicy.isTextWithinLimit(oversized));
        assertTrue(MedicineOcrPolicy.isTextWithinLimit(oversized.substring(0, MedicineOcrPolicy.MAX_TEXT_CHARS)));
        assertFalse(MedicineOcrPolicy.isReadableText(" \n\t "));
        assertTrue(MedicineOcrPolicy.isReadableText("Pramipexole 0.088 mg"));
        assertTrue(MedicineOcrPolicy.isValidCoordinate(1200, 800, 1200, 800));
        assertFalse(MedicineOcrPolicy.isValidCoordinate(-1, 40, 1200, 800));
        assertFalse(MedicineOcrPolicy.isValidCoordinate(1201, 40, 1200, 800));
        assertTrue(MedicineOcrPolicy.canAppendLine(999, 29_995, "dose"));
        assertFalse(MedicineOcrPolicy.canAppendLine(1000, 1000, "line 1001"));
        assertFalse(MedicineOcrPolicy.canAppendLine(20, 29_998, "mid-paragraph"));
    }
}
