// Tablet-quantity parsing/formatting for the Phase B grid UI. A DOMAIN file:
// no React, no Dexie, no browser APIs — pure string/number functions, unit
// tested directly (see quantity.test.ts).
//
// "Quantity" here means TABLETS (or patches), e.g. "1½" tablets — distinct
// from DoseTime.doseMg, which is always mg. grid.ts is what converts between
// the two via a strength (qty × strengthMg).

// Parses a doctor-typed tablet quantity. Grammar is intentionally narrow and
// anchored (not a general numeric parser) — a fat-fingered or ambiguous
// entry should fail closed (null) rather than silently guess:
//   1. '' | '0' | '0,0' | '0.0'        -> 0
//   2. optional int + ¼/½/¾            -> int + the fraction's value
//   3. ASCII "N D/D" or "D/D"          -> denominator restricted to {2,4}
//   4. plain decimal, comma or point   -> Number()
//   5. anything else                   -> null
// No ⅓/⅔ support (comment, not an oversight): thirds are repeating decimals
// in mg once multiplied by a strength (e.g. ⅓ × 100mg = 33.33...mg) and
// aren't a standard tablet-scoring fraction the way halves/quarters are.
const UNICODE_FRACTIONS: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75 };

export function parseQuantity(input: string): number | null {
  const trimmed = input.trim();

  if (trimmed === '' || trimmed === '0' || trimmed === '0,0' || trimmed === '0.0') {
    return 0;
  }

  const unicodeMatch = /^(\d+)?\s*([¼½¾])$/.exec(trimmed);
  if (unicodeMatch) {
    const whole = unicodeMatch[1] ? Number(unicodeMatch[1]) : 0;
    return checkFatFinger(whole + UNICODE_FRACTIONS[unicodeMatch[2]]);
  }

  const mixedAsciiMatch = /^(\d+)\s+(\d)\/(\d)$/.exec(trimmed);
  const bareAsciiMatch = mixedAsciiMatch ? null : /^(\d)\/(\d)$/.exec(trimmed);
  const asciiMatch = mixedAsciiMatch ?? bareAsciiMatch;
  if (asciiMatch) {
    const whole = mixedAsciiMatch ? Number(mixedAsciiMatch[1]) : 0;
    const numeratorIdx = mixedAsciiMatch ? 2 : 1;
    const denominatorIdx = mixedAsciiMatch ? 3 : 2;
    const numerator = Number(asciiMatch[numeratorIdx]);
    const denominator = Number(asciiMatch[denominatorIdx]);
    if (denominator !== 2 && denominator !== 4) return null;
    return checkFatFinger(whole + numerator / denominator);
  }

  if (/^\d+([.,]\d+)?$/.test(trimmed)) {
    return checkFatFinger(Number(trimmed.replace(',', '.')));
  }

  return null;
}

// >20 tablets in one administration is never a real PD regimen — treat it as
// a fat-fingered entry (e.g. a stray extra digit) rather than accept it.
function checkFatFinger(qty: number): number | null {
  return qty > 20 ? null : qty;
}

// Inverse of parseQuantity for the common tablet fractions; anything else
// (an odd decimal from a strength that doesn't divide evenly) falls back to
// a plain decimal string so nothing is silently dropped.
export function formatQuantity(qty: number): string {
  const whole = Math.trunc(qty);
  const frac = Math.round((qty - whole) * 100) / 100;

  if (frac === 0) return String(whole);
  if (frac === 0.25) return `${whole === 0 ? '' : whole}¼`;
  if (frac === 0.5) return `${whole === 0 ? '' : whole}½`;
  if (frac === 0.75) return `${whole === 0 ? '' : whole}¾`;

  return String(qty);
}

// 2-decimal-place mg rounding — the float-dust guard (SPEC RISK 6) for
// qty × strengthMg (e.g. 0.1 + 0.2 style binary-float error).
export function roundMg(mg: number): number {
  return Math.round(mg * 100) / 100;
}
