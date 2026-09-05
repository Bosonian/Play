package app.dosing.companion;

import java.util.Locale;
import java.util.regex.Pattern;

final class MedicineOcrPolicy {
    static final int MAX_IMAGE_BYTES = 8 * 1024 * 1024;
    static final int MAX_IMAGE_DIMENSION = 12_000;
    static final long MAX_IMAGE_PIXELS = 40_000_000L;
    static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
    static final int MAX_TEXT_CHARS = 30_000;
    static final int MAX_LINES = 1_000;

    private static final Pattern PROJECT_ID = Pattern.compile("[a-z][a-z0-9-]{4,28}[a-z0-9]");
    private static final Pattern REQUEST_ID = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,63}");

    private MedicineOcrPolicy() {}

    static boolean isValidProjectId(String value) {
        return value != null && PROJECT_ID.matcher(value.trim()).matches();
    }

    static boolean isValidRequestId(String value) {
        return value != null && REQUEST_ID.matcher(value).matches();
    }

    static String normalizeMimeType(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    static boolean isSupportedMimeType(String value) {
        String normalized = normalizeMimeType(value);
        return normalized.equals("image/jpeg") || normalized.equals("image/png") || normalized.equals("image/webp");
    }

    static boolean isTextWithinLimit(String value) {
        return value == null || value.length() <= MAX_TEXT_CHARS;
    }

    static boolean isReadableText(String value) {
        return value != null && !value.trim().isEmpty();
    }

    static boolean isValidCoordinate(int x, int y, int width, int height) {
        return width > 0 && height > 0 && x >= 0 && y >= 0 && x <= width && y <= height;
    }

    static boolean canAppendLine(int existingLines, int emittedChars, String nextLine) {
        return nextLine != null
            && existingLines >= 0
            && existingLines < MAX_LINES
            && emittedChars >= 0
            && nextLine.length() <= MAX_TEXT_CHARS - emittedChars;
    }
}
