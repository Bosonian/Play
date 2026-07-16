import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, putRegimenItem, deleteRegimenItem } from '../db/store';
import { usePatient } from '../patient/usePatient';
import { safeUuid } from '../lib/uuid';
import { sortRegimenItems, sortTimes, type RegimenItem } from '../../domain/regimen';
import { RegimenList } from './doctor/RegimenList';
import { RegimenItemForm, type RegimenItemDraft } from './doctor/RegimenItemForm';

type DoctorScreen = { name: 'list' } | { name: 'add' } | { name: 'edit'; item: RegimenItem };

// Doctor-mode container: authors the patient's prescribed regimen. This
// increment's writes are all here — RegimenList and RegimenItemForm are pure
// presentational components (props in, callbacks out, no DB imports) per the
// module spec, so the persistence and StrictMode-safety story lives in one
// place.
export function DoctorHome() {
  const patient = usePatient();
  const [screen, setScreen] = useState<DoctorScreen>({ name: 'list' });
  // Mirrors PatientRoot's lastAction/Undo pattern (RESEARCH §1): persists
  // until the next write or an explicit Undo, no timer. There's no confirm
  // dialog on Remove — Undo is the safety net, not a modal.
  const [lastRemoved, setLastRemoved] = useState<RegimenItem | null>(null);

  // Read-only: no bootstrap write here (SPEC RISK #7). usePatient() already
  // owns the one StrictMode-guarded write this screen depends on (creating
  // the local patient record, done once elsewhere); useLiveQuery only reads.
  const items = useLiveQuery(
    () =>
      patient
        ? db.regimenItems.where('patient').equals(patient.code).toArray()
        : Promise.resolve<RegimenItem[]>([]),
    [patient?.code],
  );

  async function saveItem(draft: RegimenItemDraft) {
    if (!patient) return;
    const existingId = screen.name === 'edit' ? screen.item.id : safeUuid();
    const item: RegimenItem = {
      id: existingId,
      patient: patient.code,
      drug: draft.drug,
      doseMg: draft.doseMg,
      times: sortTimes(draft.times),
      updatedAt: new Date().toISOString(),
    };
    await putRegimenItem(db, item);
    setScreen({ name: 'list' });
    setLastRemoved(null);
  }

  async function removeItem(item: RegimenItem) {
    await deleteRegimenItem(db, item.id);
    setLastRemoved(item);
  }

  async function undoRemove() {
    if (!lastRemoved) return;
    // Same id -> idempotent restore. updatedAt is deliberately NOT refreshed
    // here: an undo restores the item exactly as it was, not as a new edit.
    await putRegimenItem(db, lastRemoved);
    setLastRemoved(null);
  }

  // Renders nothing until the patient record is bootstrapped, same
  // convention as PatientRoot.
  if (!patient) return null;

  if (screen.name === 'add') {
    return (
      <RegimenItemForm
        initial={null}
        onSave={(draft) => void saveItem(draft)}
        onCancel={() => setScreen({ name: 'list' })}
      />
    );
  }

  if (screen.name === 'edit') {
    return (
      <RegimenItemForm
        initial={screen.item}
        onSave={(draft) => void saveItem(draft)}
        onCancel={() => setScreen({ name: 'list' })}
      />
    );
  }

  return (
    <RegimenList
      patientCode={patient.code}
      items={sortRegimenItems(items ?? [])}
      lastRemoved={lastRemoved}
      onAdd={() => setScreen({ name: 'add' })}
      onEdit={(item) => setScreen({ name: 'edit', item })}
      onRemove={(item) => void removeItem(item)}
      onUndoRemove={() => void undoRemove()}
    />
  );
}
