package app.dosing.companion;

import android.os.Bundle;
import android.content.Intent;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MedicineOcrPlugin.class);
        registerPlugin(ObservationRemindersPlugin.class);
        ObservationReminderManager.captureOpenIntent(this, getIntent());
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        boolean captured = ObservationReminderManager.captureOpenIntent(this, intent);
        super.onNewIntent(intent);
        if (captured && getBridge() != null) {
            PluginHandle handle = getBridge().getPlugin("ObservationReminders");
            if (handle != null && handle.getInstance() instanceof ObservationRemindersPlugin) {
                ((ObservationRemindersPlugin) handle.getInstance()).notifyReminderOpen();
            }
        }
    }
}
