import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { formatDateDisplay, formatTime } from '../lib/format';
import { getExactAlarmStatus, openExactAlarmSettings } from '../native/notifications';

interface HomeProps {
  onNavigate: (screen: Screen) => void;
}

export function Home({ onNavigate }: HomeProps) {
  const templates = useLiveQuery(() => db.templates.toArray(), []);

  // Checked once per Home mount, native only. "Dismissable-per-session"
  // (increment-4 §6) means exactly that — plain component state, not
  // persisted to Dexie or localStorage, so the banner is back next time the
  // app is reopened if the setting is still off. Deliberately not re-checked
  // on every render: the user has to leave Android settings and come back to
  // change it, which already remounts Home along the way.
  const [exactAlarmsOff, setExactAlarmsOff] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void getExactAlarmStatus().then((status) => setExactAlarmsOff(status !== 'granted'));
  }, []);

  // planned/running departures, soonest appointment first — that ordering
  // is what makes "Upcoming" useful at a glance rather than a junk drawer.
  const upcoming = useLiveQuery(
    () =>
      db.departures
        .where('status')
        .anyOf(['planned', 'running'])
        .sortBy('appointmentAt'),
    [],
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-8 px-4 pb-12 pt-safe-top">
      <header className="pt-8">
        <h1 className="text-2xl font-semibold text-slate-100">Runway</h1>
      </header>

      {exactAlarmsOff && !bannerDismissed && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-700/60 bg-amber-950/40 px-4 py-3">
          <p className="flex-1 text-sm text-amber-200">
            Exact alarms are off for Runway. Scheduled alerts may arrive late or not at all.
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => void openExactAlarmSettings()}
              className="min-h-11 rounded-md px-2 text-sm font-medium text-amber-300 hover:text-amber-200"
            >
              Open settings
            </button>
            <button
              onClick={() => setBannerDismissed(true)}
              aria-label="Dismiss"
              className="flex min-h-11 min-w-11 items-center justify-center text-amber-500 hover:text-amber-300"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      <Button onClick={() => onNavigate({ name: 'departureSetup' })} className="w-full">
        New departure
      </Button>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Templates</h2>
          <button
            onClick={() => onNavigate({ name: 'templateEdit' })}
            className="min-h-11 rounded-md px-2 text-sm font-medium text-sky-400 hover:text-sky-300"
          >
            New template
          </button>
        </div>

        {templates?.length === 0 && (
          <p className="text-sm text-slate-500">No templates yet.</p>
        )}

        <div className="flex flex-col gap-2">
          {templates?.map((template) => {
            const totalPrepMinutes = template.steps.reduce((sum, step) => sum + step.minutes, 0);
            return (
              <div key={template.id} className="flex items-center gap-2">
                <Card
                  onClick={() => onNavigate({ name: 'departureSetup', templateId: template.id })}
                  className="flex-1"
                >
                  <p className="font-medium text-slate-100">{template.name}</p>
                  <p className="text-sm text-slate-400">
                    {template.destination || 'No destination set'}
                  </p>
                  <p className="mt-1 text-sm tabular-nums text-slate-500">
                    {totalPrepMinutes} min prep &middot; {template.travelMinutes} min travel
                  </p>
                </Card>
                <button
                  onClick={() => onNavigate({ name: 'templateEdit', id: template.id })}
                  aria-label={`Edit ${template.name}`}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-500 hover:text-slate-200"
                >
                  Edit
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Upcoming</h2>

        {upcoming?.length === 0 && (
          <p className="text-sm text-slate-500">No departure planned.</p>
        )}

        <div className="flex flex-col gap-2">
          {upcoming?.map((departure) => (
            <Card
              key={departure.id}
              onClick={() => onNavigate({ name: 'runway', departureId: departure.id })}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-slate-100">{departure.name}</p>
                    {departure.status === 'running' && (
                      <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-sky-400">
                        Running
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-400">{departure.destination || 'No destination set'}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold tabular-nums text-slate-100">
                    {formatTime(new Date(departure.appointmentAt))}
                  </p>
                  <p className="text-sm text-slate-500">
                    {formatDateDisplay(new Date(departure.appointmentAt))}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
