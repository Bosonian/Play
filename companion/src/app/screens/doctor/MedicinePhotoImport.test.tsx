import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { boundedImageDimensions, MedicinePhotoImport, MedicinePhotoPreview } from './MedicinePhotoImport';

describe('medicine photo import screen', () => {
  it('bounds decoded image dimensions without enlarging smaller photos', () => {
    expect(boundedImageDimensions(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(boundedImageDimensions(8000, 4000)).toEqual({ width: 4096, height: 2048 });
    expect(boundedImageDimensions(0, 400)).toBeNull();
  });

  it('shows patient binding and waits for native status before exposing photo controls', () => {
    const html = renderToStaticMarkup(
      <MedicinePhotoImport
        patientCode="P-01"
        savedMedications={[]}
        onApply={async () => undefined}
        onBack={() => undefined}
      />,
    );
    expect(html).toContain('Medicine photo import');
    expect(html).toContain('Patient P-01');
    expect(html).toContain('Checking Android setup');
    expect(html).not.toContain('type="file"');
  });

  it('makes the normalized preview explicitly enlargable', () => {
    const html = renderToStaticMarkup(<MedicinePhotoPreview src="data:image/jpeg;base64,AA==" alt="Medicine list" />);
    expect(html).toContain('aria-label="Enlarge medicine list"');
    expect(html).toContain('Enlarge photo');
    expect(html).toContain('alt="Medicine list"');
  });
});
