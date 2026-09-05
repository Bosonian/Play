package app.dosing.companion;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class ObservationReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        ObservationReminderManager.onAlarm(context.getApplicationContext(), intent);
    }
}
