package app.dosing.companion;

import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "ObservationReminders",
    permissions = { @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" }) }
)
public final class ObservationRemindersPlugin extends Plugin {
    @PluginMethod
    public void getStatus(PluginCall call) {
        resolveStatus(call);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        try {
            ObservationReminderManager.markPermissionRequested(getContext());
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                call.resolve(ObservationReminderManager.getStatus(getContext(), getActivity()));
                return;
            }
            requestPermissionForAlias("notifications", call, "notificationPermissionResult");
        } catch (ObservationReminderManager.ReminderException exception) {
            reject(call, exception);
        }
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) {
        resolveStatus(call);
    }

    @PluginMethod
    public void replacePlan(PluginCall call) {
        try {
            JSObject result = ObservationReminderManager.replacePlan(
                getContext(),
                call.getString("studyId"),
                call.getInt("revision"),
                call.getString("startedAt"),
                call.getString("plannedEndAt"),
                call.getObject("plan"),
                getActivity()
            );
            call.resolve(result);
        } catch (ObservationReminderManager.ReminderException exception) {
            reject(call, exception);
        }
    }

    @PluginMethod
    public void cancelStudy(PluginCall call) {
        try {
            call.resolve(ObservationReminderManager.cancelStudy(getContext(), call.getString("studyId"), getActivity()));
        } catch (ObservationReminderManager.ReminderException exception) {
            reject(call, exception);
        }
    }

    @PluginMethod
    public void getPendingOpen(PluginCall call) {
        try {
            call.resolve(ObservationReminderManager.getPendingOpen(getContext()));
        } catch (ObservationReminderManager.ReminderException exception) {
            reject(call, exception);
        }
    }

    @PluginMethod
    public void acknowledgeOpen(PluginCall call) {
        try {
            call.resolve(ObservationReminderManager.acknowledgeOpen(getContext(), call.getString("occurrenceId")));
        } catch (ObservationReminderManager.ReminderException exception) {
            reject(call, exception);
        }
    }

    void notifyReminderOpen() {
        JSObject event = new JSObject();
        event.put("schemaVersion", 1);
        notifyListeners("reminderOpen", event);
    }

    private void resolveStatus(PluginCall call) {
        try {
            call.resolve(ObservationReminderManager.getStatus(getContext(), getActivity()));
        } catch (ObservationReminderManager.ReminderException exception) {
            reject(call, exception);
        }
    }

    private static void reject(PluginCall call, ObservationReminderManager.ReminderException exception) {
        call.reject(exception.safeMessage, exception.code);
    }
}
