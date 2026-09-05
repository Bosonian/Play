import { describe, expect, it } from 'vitest';
import {
  MEDICINE_IMAGE_MAX_SOURCE_BYTES,
  parseMedicineImageHeader,
  preflightMedicineImage,
} from './imagePreflight';

function put16be(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value >>> 8;
  bytes[offset + 1] = value;
}

function put16le(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value;
  bytes[offset + 1] = value >>> 8;
}

function put24le(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value;
  bytes[offset + 1] = value >>> 8;
  bytes[offset + 2] = value >>> 16;
}

function put32be(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value >>> 24;
  bytes[offset + 1] = value >>> 16;
  bytes[offset + 2] = value >>> 8;
  bytes[offset + 3] = value;
}

function put32le(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value;
  bytes[offset + 1] = value >>> 8;
  bytes[offset + 2] = value >>> 16;
  bytes[offset + 3] = value >>> 24;
}

function putAscii(bytes: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  put32be(bytes, 8, 13);
  putAscii(bytes, 12, 'IHDR');
  put32be(bytes, 16, width);
  put32be(bytes, 20, height);
  return bytes;
}

function jpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(18);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc2, 0x00, 0x08, 0x08]);
  put16be(bytes, 13, height);
  put16be(bytes, 15, width);
  bytes[17] = 1;
  return bytes;
}

function webpChunk(type: 'VP8X' | 'VP8 ' | 'VP8L', dataLength: number): Uint8Array {
  const paddedLength = dataLength + (dataLength % 2);
  const bytes = new Uint8Array(20 + paddedLength);
  putAscii(bytes, 0, 'RIFF');
  put32le(bytes, 4, bytes.length - 8);
  putAscii(bytes, 8, 'WEBP');
  putAscii(bytes, 12, type);
  put32le(bytes, 16, dataLength);
  return bytes;
}

function vp8x(width: number, height: number): Uint8Array {
  const bytes = webpChunk('VP8X', 10);
  put24le(bytes, 24, width - 1);
  put24le(bytes, 27, height - 1);
  return bytes;
}

function vp8(width: number, height: number): Uint8Array {
  const bytes = webpChunk('VP8 ', 10);
  bytes.set([0x9d, 0x01, 0x2a], 23);
  put16le(bytes, 26, width);
  put16le(bytes, 28, height);
  return bytes;
}

function vp8l(width: number, height: number): Uint8Array {
  const bytes = webpChunk('VP8L', 5);
  bytes[20] = 0x2f;
  put32le(bytes, 21, (width - 1) | ((height - 1) << 14));
  return bytes;
}

function expectCode(action: () => unknown, code: string) {
  try {
    action();
    throw new Error('Expected image preflight to reject.');
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe('medicine image header preflight', () => {
  it('reads JPEG SOF and PNG IHDR dimensions without decoding pixels', () => {
    expect(parseMedicineImageHeader(jpeg(1200, 800), 'image/jpeg')).toMatchObject({
      mimeType: 'image/jpeg', width: 1200, height: 800,
    });
    expect(parseMedicineImageHeader(png(640, 480), 'image/png')).toMatchObject({
      mimeType: 'image/png', width: 640, height: 480,
    });
  });

  it('reads VP8X, VP8 and VP8L WebP dimensions', () => {
    expect(parseMedicineImageHeader(vp8x(1600, 900), 'image/webp')).toMatchObject({ width: 1600, height: 900 });
    expect(parseMedicineImageHeader(vp8(1024, 768), 'image/webp')).toMatchObject({ width: 1024, height: 768 });
    expect(parseMedicineImageHeader(vp8l(375, 667), 'image/webp')).toMatchObject({ width: 375, height: 667 });
  });

  it('rejects declared MIME mismatches and unsupported signatures safely', () => {
    expectCode(() => parseMedicineImageHeader(png(100, 100), 'image/jpeg'), 'MIME_MISMATCH');
    expectCode(() => parseMedicineImageHeader(png(100, 100), 'application/pdf'), 'UNSUPPORTED_IMAGE');
    expectCode(() => parseMedicineImageHeader(new Uint8Array([1, 2, 3]), 'image/jpeg'), 'UNSUPPORTED_IMAGE');
  });

  it('rejects truncated or malformed headers and zero dimensions', () => {
    expectCode(() => parseMedicineImageHeader(png(100, 100).slice(0, 24), 'image/png'), 'MALFORMED_IMAGE');
    const truncatedWebp = vp8x(100, 100);
    put32le(truncatedWebp, 4, 200);
    expectCode(() => parseMedicineImageHeader(truncatedWebp, 'image/webp'), 'MALFORMED_IMAGE');
    expectCode(() => parseMedicineImageHeader(png(0, 100), 'image/png'), 'MALFORMED_IMAGE');
  });

  it('accepts the exact dimension ceiling and rejects a larger edge', () => {
    expect(parseMedicineImageHeader(png(4096, 4096), 'image/png')).toMatchObject({ width: 4096, height: 4096 });
    expectCode(() => parseMedicineImageHeader(png(4097, 1), 'image/png'), 'IMAGE_DIMENSIONS_TOO_LARGE');
  });

  it('checks File size before reading and validates the File MIME', async () => {
    const valid = png(320, 240);
    const file = {
      size: valid.length,
      type: 'image/png',
      arrayBuffer: async () => valid.slice().buffer as ArrayBuffer,
    } as File;
    await expect(preflightMedicineImage(file)).resolves.toMatchObject({
      mimeType: 'image/png', width: 320, height: 240, byteLength: valid.length,
    });

    let read = false;
    const oversized = {
      size: MEDICINE_IMAGE_MAX_SOURCE_BYTES + 1,
      type: 'image/png',
      arrayBuffer: async () => {
        read = true;
        return new ArrayBuffer(0);
      },
    } as File;
    await expect(preflightMedicineImage(oversized)).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' });
    expect(read).toBe(false);
  });
});
