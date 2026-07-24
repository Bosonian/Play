package de.bosonian.tide;

import com.getcapacitor.BridgeActivity;

/**
 * Minimal by design, unlike apps/runway's own MainActivity.java (which
 * registers five custom native plugins — widgets, calendar, wifi, day-gauge,
 * bluetooth — accumulated over many increments). Increment 2 adds no custom
 * (non-npm) Capacitor plugin for Tide; the Health Connect bridge (TIDE_PLAN.md
 * §3, increment 3) will be the first one, at which point this class gains a
 * registerPlugin() call the same way Runway's did — see that file's own doc
 * comment for the "before super.onCreate()" ordering rule to follow then.
 */
public class MainActivity extends BridgeActivity {}
