package app.dosing.companion;

import android.app.Activity;
import android.view.HapticFeedbackConstants;
import android.view.View;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

final class TapFeedbackPolicy {
    static final long MAX_REQUEST_AGE_MS = 150L;
    static final int MAX_SESSION_TOKEN_CHARS = 128;

    private TapFeedbackPolicy() {}

    static boolean isValidSessionToken(String token) {
        return token != null && !token.isEmpty() && token.length() <= MAX_SESSION_TOKEN_CHARS;
    }

    static boolean isFresh(long requestedAtEpochMs, long nowEpochMs) {
        return requestedAtEpochMs >= 0L
            && nowEpochMs >= requestedAtEpochMs
            && nowEpochMs - requestedAtEpochMs <= MAX_REQUEST_AGE_MS;
    }
}

@CapacitorPlugin(name = "TapFeedback")
public final class TapFeedbackPlugin extends Plugin {
    private final Object stateLock = new Object();
    private String activeSessionToken;
    private boolean foreground;
    private boolean destroyed;
    private boolean pendingUiTick;
    private long sessionGeneration;

    @PluginMethod
    public void beginSession(PluginCall call) {
        String token = call.getString("sessionToken");
        if (!TapFeedbackPolicy.isValidSessionToken(token)) {
            call.reject("A valid tapping session token is required.", "INVALID_SESSION_TOKEN");
            return;
        }
        Activity activity = getActivity();
        synchronized (stateLock) {
            if (destroyed) {
                resolvePerformed(call, false);
                return;
            }
            activeSessionToken = token;
            sessionGeneration++;
            foreground = isWindowReady(activity);
        }
        JSObject result = new JSObject();
        result.put("active", true);
        call.resolve(result);
    }

    @PluginMethod
    public void performTap(PluginCall call) {
        String token = call.getString("sessionToken");
        Long requestedAtEpochMs = call.getLong("requestedAtEpochMs");
        Activity activity = getActivity();
        long generation;
        synchronized (stateLock) {
            if (destroyed
                || !foreground
                || !TapFeedbackPolicy.isValidSessionToken(token)
                || !token.equals(activeSessionToken)
                || requestedAtEpochMs == null
                || !TapFeedbackPolicy.isFresh(requestedAtEpochMs, System.currentTimeMillis())
                || !isWindowReady(activity)
                || pendingUiTick) {
                resolvePerformed(call, false);
                return;
            }
            pendingUiTick = true;
            generation = sessionGeneration;
        }

        final long capturedGeneration = generation;
        final long capturedRequestedAt = requestedAtEpochMs;
        final String capturedToken = token;
        try {
            activity.runOnUiThread(() -> {
                boolean performed = false;
                try {
                    synchronized (stateLock) {
                        if (!destroyed
                            && foreground
                            && capturedGeneration == sessionGeneration
                            && capturedToken.equals(activeSessionToken)
                            && TapFeedbackPolicy.isFresh(capturedRequestedAt, System.currentTimeMillis())
                            && isWindowReady(activity)) {
                            View target = activity.getWindow().getDecorView();
                            performed = target.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
                        }
                    }
                } catch (RuntimeException ignored) {
                    performed = false;
                } finally {
                    synchronized (stateLock) {
                        pendingUiTick = false;
                    }
                    resolvePerformed(call, performed);
                }
            });
        } catch (RuntimeException ignored) {
            synchronized (stateLock) {
                pendingUiTick = false;
            }
            resolvePerformed(call, false);
        }
    }

    @PluginMethod
    public void endSession(PluginCall call) {
        String token = call.getString("sessionToken");
        boolean ended = false;
        synchronized (stateLock) {
            if (TapFeedbackPolicy.isValidSessionToken(token) && token.equals(activeSessionToken)) {
                activeSessionToken = null;
                sessionGeneration++;
                ended = true;
            }
        }
        JSObject result = new JSObject();
        result.put("ended", ended);
        call.resolve(result);
    }

    @Override
    protected void handleOnResume() {
        synchronized (stateLock) {
            if (!destroyed) foreground = true;
        }
        super.handleOnResume();
    }

    @Override
    protected void handleOnPause() {
        synchronized (stateLock) {
            foreground = false;
            activeSessionToken = null;
            sessionGeneration++;
        }
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (stateLock) {
            destroyed = true;
            foreground = false;
            activeSessionToken = null;
            sessionGeneration++;
        }
        super.handleOnDestroy();
    }

    private static boolean isWindowReady(Activity activity) {
        return activity != null
            && !activity.isFinishing()
            && !activity.isDestroyed()
            && activity.getWindow() != null
            && activity.getWindow().getDecorView().hasWindowFocus();
    }

    private static void resolvePerformed(PluginCall call, boolean performed) {
        JSObject result = new JSObject();
        result.put("performed", performed);
        call.resolve(result);
    }
}
