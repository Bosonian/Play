import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Screen } from '../App';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { formatDateDisplay, formatTime } from '../lib/format';

interface HomeProps {
  onNavigate: (screen: Screen) => void;
}

export function Home({ onNavigate }: HomeProps) {
  const templates = useLiveQuery(() => db.templates.toArray(), []);

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
                  <p className="font-medium text-slate-100">{departure.name}</p>
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
