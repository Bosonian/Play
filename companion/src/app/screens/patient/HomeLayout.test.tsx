import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SlotStatus } from '../../patient/doses';
import { HomePrimarySections } from './Home';

describe('patient Home primary sections', () => {
  it('keeps the motor hero first and every scheduled dose as its own action', () => {
    const statuses: SlotStatus[] = [
      {
        slot: {
          regimenItemId: 'custom-pramipexole',
          drug: 'custom',
          customName: 'Pramipexole',
          customFormulation: 'Immediate-release tablet',
          customMedicationId: 'saved-pramipexole',
          doseMg: 0.088,
          time: '08:00',
        },
        takenAt: null,
        eventId: null,
      },
      {
        slot: {
          regimenItemId: 'levodopa-noon',
          drug: 'levodopa',
          doseMg: 100,
          time: '12:00',
        },
        takenAt: '2026-09-05T12:04:00.000Z',
        eventId: 'dose-event-noon',
      },
    ];
    const html = renderToStaticMarkup(
      <HomePrimarySections
        slotStatuses={statuses}
        prnChoices={[]}
        observationStatus={<div>Observation marker</div>}
        onLogState={() => undefined}
        onLogMeal={() => undefined}
        onOpenEvent={() => undefined}
        onTakeDose={() => undefined}
        onTakePrnDose={() => undefined}
        onLogAnotherDose={() => undefined}
      />,
    );

    expect(html.indexOf('How I feel now')).toBeLessThan(html.indexOf('Observation marker'));
    expect(html.indexOf('Observation marker')).toBeLessThan(html.indexOf("Today&#x27;s doses"));
    expect(html.indexOf("Today&#x27;s doses")).toBeLessThan(html.indexOf('Log a meal'));
    expect(html).toContain('Log Pramipexole (Immediate-release tablet) 0.088 mg scheduled for 08:00 as taken');
    expect(html).toContain('Open Levodopa 100 mg, Taken at');
    expect(html).toContain('scheduled for 12:00');
    expect(html.match(/Pramipexole \(Immediate-release tablet\) 0\.088 mg/g)).toHaveLength(2);
    expect(html.match(/Levodopa 100 mg/g)).toHaveLength(2);
  });
});
