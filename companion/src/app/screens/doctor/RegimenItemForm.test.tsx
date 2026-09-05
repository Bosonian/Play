import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { computeInitialFormState, RegimenItemForm } from './RegimenItemForm';
import type { RegimenItem } from '../../../domain/regimen';

describe('custom regimen edit initialization', () => {
  it('always preserves exact stored times and decimal doses in the direct editor', () => {
    const initial: RegimenItem = {
      id: 'custom-r1',
      patient: 'P-01',
      drug: 'custom',
      customName: 'Pramipexole',
      customFormulation: 'Immediate-release tablet',
      times: [
        { time: '08:00', doseMg: 0.088 },
        { time: '20:00', doseMg: 0.18 },
      ],
      updatedAt: '2026-09-05T00:00:00Z',
    };
    const state = computeInitialFormState(initial);
    expect(state.scheduleMode).toBe('custom');
    expect(state.customRows).toEqual([
      { time: '08:00', doseInput: '0.088' },
      { time: '20:00', doseInput: '0.18' },
    ]);

    const html = renderToStaticMarkup(
      <RegimenItemForm
        initial={initial}
        savedMedications={[]}
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('value="08:00"');
    expect(html).toContain('value="0.088"');
  });

  it('reopens an exact when-needed prescription without scheduled defaults', () => {
    const initial: RegimenItem = {
      id: 'prn-r1',
      patient: 'P-01',
      drug: 'madopar-lt',
      times: [],
      prn: {
        doseMg: 0.088,
        indication: 'OFF symptoms',
        instructions: 'At least two hours apart.',
      },
      updatedAt: '2026-09-05T00:00:00Z',
    };
    const state = computeInitialFormState(initial);
    expect(state.regimenMode).toBe('prn');
    expect(state.prnDoseInput).toBe('0.088');
    expect(state.prnIndication).toBe('OFF symptoms');
    expect(state.prnInstructions).toBe('At least two hours apart.');
  });
});
