import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildObservationStudy } from '../../../domain/observation';
import { ObservationStatusView } from './ObservationStatus';

describe('ObservationStatusView', () => {
  it('shows setup guidance when no observation study exists', () => {
    const html = renderToStaticMarkup(
      <ObservationStatusView study={null} onStart={() => undefined}
        onSetupObservation={() => undefined} />,
    );

    expect(html).toContain('Finger tapping');
    expect(html).toContain('prescribed regimen');
    expect(html).toContain('open Observation');
    expect(html).toContain('14- or 28-day observation period');
    expect(html).toContain('Set up in Doctor mode');
    expect(html).not.toContain('Start finger-tapping check');
  });

  it('shows the tapping action and progress for an active study', () => {
    const study = buildObservationStudy({
      id: 'study-1',
      patient: 'P-01',
      durationDays: 14,
      startedAt: new Date().toISOString(),
      regimen: [{
        id: 'regimen-1',
        patient: 'P-01',
        drug: 'levodopa',
        times: [{ time: '08:00', doseMg: 100 }],
        updatedAt: new Date().toISOString(),
      }],
    });
    const html = renderToStaticMarkup(
      <ObservationStatusView study={study} onStart={() => undefined}
        onSetupObservation={() => undefined} />,
    );

    expect(html).toContain('Observation period');
    expect(html).toContain('Day 1 of 14');
    expect(html).toContain('Start finger-tapping check');
    expect(html).not.toContain('Set up in Doctor mode');
  });
});
