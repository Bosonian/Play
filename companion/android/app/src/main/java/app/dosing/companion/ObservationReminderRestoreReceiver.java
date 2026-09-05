package app.dosing.companion;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class ObservationReminderRestoreReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
            && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
            && !Intent.ACTION_TIME_CHANGED.equals(action)
            && !Intent.ACTION_TIMEZONE_CHANGED.equals(action)) return;
        ObservationReminderManager.restoreAfterSystemChange(context.getApplicationContext());
    }
}
