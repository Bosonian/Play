import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AsNeededMedicineList } from './Home';

describe('patient as-needed medicines', () => {
  it('renders identity, dose, indication, instructions, and an explicit log action', () => {
    const html = renderToStaticMarkup(
      <AsNeededMedicineList
        choices={[{
          regimenItemId: 'prn-1',
          drug: 'custom',
          customName: 'Pramipexole',
          customFormulation: 'Immediate-release tablet',
          doseMg: 0.088,
          indication: 'OFF symptoms',
          instructions: 'At least two hours apart.',
        }]}
        onLog={() => undefined}
      />,
    );
    expect(html).toContain('As-needed medicines');
    expect(html).toContain('Pramipexole (Immediate-release tablet) 0.088 mg');
    expect(html).toContain('When needed: OFF symptoms');
    expect(html).toContain('At least two hours apart.');
    expect(html).toContain('Log a dose after taking it.');
    expect(html).toContain('does not calculate when another dose is due');
    expect(html).toContain('Log dose taken');
    expect(html).not.toContain('Pending');
    expect(html).not.toContain('Overdue');
  });
});
