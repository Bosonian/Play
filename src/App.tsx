import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/db';

// Placeholder for §9 step 2 verification. Real UI begins at step 3
// (Today's Scene). This screen just proves the DB is wired and seeded.
export function App() {
  const propCount = useLiveQuery(() => db.propSeeds.count());
  const sceneCount = useLiveQuery(() => db.sceneSeeds.count());
  const profile = useLiveQuery(() => db.userProfile.toCollection().first());

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-2 text-neutral-700">
      <p className="text-sm">PlayDHD — data layer ready.</p>
      <p className="text-xs text-neutral-500">
        {propCount ?? '…'} props · {sceneCount ?? '…'} scenes · profile{' '}
        {profile ? 'seeded' : '…'}
      </p>
    </main>
  );
}
