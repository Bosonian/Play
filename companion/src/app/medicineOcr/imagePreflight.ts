export const MEDICINE_IMAGE_MAX_SOURCE_BYTES = 12 * 1024 * 1024;
export const MEDICINE_IMAGE_MAX_EDGE = 4096;
export const MEDICINE_IMAGE_MAX_PIXELS = 16_777_216;

export type MedicineImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export type MedicineImagePreflightErrorCode =
  | 'EMPTY_IMAGE'
  | 'IMAGE_TOO_LARGE'
  | 'UNSUPPORTED_IMAGE'
  | 'MIME_MISMATCH'
  | 'MALFORMED_IMAGE'
  | 'IMAGE_DIMENSIONS_TOO_LARGE';

export class MedicineImagePreflightError extends Error {
  readonly code: MedicineImagePreflightErrorCode;

  constructor(code: MedicineImagePreflightErrorCode, message: string) {
    super(message);
    this.name = 'MedicineImagePreflightError';
    this.code = code;
  }
}

export interface MedicineImagePreflightResult {
  mimeType: MedicineImageMimeType;
  width: number;
  height: number;
  byteLength: number;
}

interface ParsedHeader {
  mimeType: MedicineImageMimeType;
  width: number;
  height: number;
}

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function failure(code: MedicineImagePreflightErrorCode): MedicineImagePreflightError {
  const messages: Record<MedicineImagePreflightErrorCode, string> = {
    EMPTY_IMAGE: 'The photo is empty.',
    IMAGE_TOO_LARGE: 'The photo is larger than 12 MB.',
    UNSUPPORTED_IMAGE: 'Use a JPEG, PNG, or WebP image.',
    MIME_MISMATCH: 'The photo type does not match its contents.',
    MALFORMED_IMAGE: 'The photo header is invalid or incomplete.',
    IMAGE_DIMENSIONS_TOO_LARGE: 'The photo dimensions exceed the safe 4096-pixel edge or pixel-count limit.',
  };
  return new MedicineImagePreflightError(code, messages[code]);
}

function normalizedMimeType(value: string | undefined): MedicineImageMimeType | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'image/jpeg' || normalized === 'image/png' || normalized === 'image/webp'
    ? normalized
    : null;
}

function byteString(bytes: Uint8Array, offset: number, length: number): string {
  let value = '';
  for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[offset + index]);
  return value;
}

function uint16be(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 256 + bytes[offset + 1];
}

function uint16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 256;
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65_536;
}

function uint32be(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 16_777_216 + bytes[offset + 1] * 65_536 + bytes[offset + 2] * 256 + bytes[offset + 3];
}

function uint32le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65_536 + bytes[offset + 3] * 16_777_216;
}

function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function parsePng(bytes: Uint8Array): ParsedHeader {
  if (bytes.length < 33 || uint32be(bytes, 8) !== 13 || byteString(bytes, 12, 4) !== 'IHDR') {
    throw failure('MALFORMED_IMAGE');
  }
  return { mimeType: 'image/png', width: uint32be(bytes, 16), height: uint32be(bytes, 20) };
}

function parseJpeg(bytes: Uint8Array): ParsedHeader {
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw failure('MALFORMED_IMAGE');
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) throw failure('MALFORMED_IMAGE');
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) throw failure('MALFORMED_IMAGE');
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) throw failure('MALFORMED_IMAGE');
    const segmentLength = uint16be(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) throw failure('MALFORMED_IMAGE');
    if (JPEG_SOF.has(marker)) {
      if (segmentLength < 8) throw failure('MALFORMED_IMAGE');
      return {
        mimeType: 'image/jpeg',
        width: uint16be(bytes, offset + 5),
        height: uint16be(bytes, offset + 3),
      };
    }
    offset += segmentLength;
  }
  throw failure('MALFORMED_IMAGE');
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && byteString(bytes, 0, 4) === 'RIFF' && byteString(bytes, 8, 4) === 'WEBP';
}

function parseWebp(bytes: Uint8Array): ParsedHeader {
  if (bytes.length < 20) throw failure('MALFORMED_IMAGE');
  const riffEnd = uint32le(bytes, 4) + 8;
  const chunkLength = uint32le(bytes, 16);
  const dataOffset = 20;
  if (riffEnd < dataOffset || riffEnd > bytes.length || dataOffset + chunkLength > riffEnd) {
    throw failure('MALFORMED_IMAGE');
  }
  const chunk = byteString(bytes, 12, 4);
  if (chunk === 'VP8X') {
    if (chunkLength < 10 || dataOffset + 10 > bytes.length) throw failure('MALFORMED_IMAGE');
    return {
      mimeType: 'image/webp',
      width: uint24le(bytes, dataOffset + 4) + 1,
      height: uint24le(bytes, dataOffset + 7) + 1,
    };
  }
  if (chunk === 'VP8 ') {
    if (chunkLength < 10 || dataOffset + 10 > bytes.length
      || bytes[dataOffset + 3] !== 0x9d || bytes[dataOffset + 4] !== 0x01 || bytes[dataOffset + 5] !== 0x2a) {
      throw failure('MALFORMED_IMAGE');
    }
    return {
      mimeType: 'image/webp',
      width: uint16le(bytes, dataOffset + 6) & 0x3fff,
      height: uint16le(bytes, dataOffset + 8) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    if (chunkLength < 5 || dataOffset + 5 > bytes.length || bytes[dataOffset] !== 0x2f) {
      throw failure('MALFORMED_IMAGE');
    }
    const dimensions = uint32le(bytes, dataOffset + 1);
    return {
      mimeType: 'image/webp',
      width: (dimensions & 0x3fff) + 1,
      height: ((dimensions >>> 14) & 0x3fff) + 1,
    };
  }
  throw failure('MALFORMED_IMAGE');
}

function bytesOf(source: ArrayBuffer | Uint8Array): Uint8Array {
  return source instanceof Uint8Array ? source : new Uint8Array(source);
}

export function parseMedicineImageHeader(
  source: ArrayBuffer | Uint8Array,
  declaredMimeType?: string,
): MedicineImagePreflightResult {
  const bytes = bytesOf(source);
  if (bytes.byteLength === 0) throw failure('EMPTY_IMAGE');
  if (bytes.byteLength > MEDICINE_IMAGE_MAX_SOURCE_BYTES) throw failure('IMAGE_TOO_LARGE');
  const declared = declaredMimeType === undefined ? null : normalizedMimeType(declaredMimeType);
  if (declaredMimeType !== undefined && declared === null) throw failure('UNSUPPORTED_IMAGE');

  let parsed: ParsedHeader;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) parsed = parseJpeg(bytes);
  else if (isPng(bytes)) parsed = parsePng(bytes);
  else if (isWebp(bytes)) parsed = parseWebp(bytes);
  else throw failure('UNSUPPORTED_IMAGE');

  if (declared !== null && declared !== parsed.mimeType) throw failure('MIME_MISMATCH');
  const { width, height } = parsed;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw failure('MALFORMED_IMAGE');
  }
  if (width > MEDICINE_IMAGE_MAX_EDGE || height > MEDICINE_IMAGE_MAX_EDGE
    || width * height > MEDICINE_IMAGE_MAX_PIXELS) {
    throw failure('IMAGE_DIMENSIONS_TOO_LARGE');
  }
  return { ...parsed, byteLength: bytes.byteLength };
}

export async function preflightMedicineImage(
  source: File | ArrayBuffer,
  declaredMimeType?: string,
): Promise<MedicineImagePreflightResult> {
  if (source instanceof ArrayBuffer) return parseMedicineImageHeader(source, declaredMimeType);
  if (source.size === 0) throw failure('EMPTY_IMAGE');
  if (source.size > MEDICINE_IMAGE_MAX_SOURCE_BYTES) throw failure('IMAGE_TOO_LARGE');
  const bytes = await source.arrayBuffer();
  if (bytes.byteLength > MEDICINE_IMAGE_MAX_SOURCE_BYTES) throw failure('IMAGE_TOO_LARGE');
  return parseMedicineImageHeader(bytes, declaredMimeType ?? source.type);
}
