/** png.js's fflate fallback, counting what it pushes; in its own file because it mocks fflate. */
import zlib from 'node:zlib';
import { pngChunk } from './helpers/probeApng.mjs';

vi.mock('fflate', async importOriginal => {
  const actual = await importOriginal();
  const pushes = [];

  class Inflate extends actual.Inflate {
    push(chunk, final) {
      pushes.push({ length: chunk.length, final });
      return super.push(chunk, final);
    }
  }

  return { ...actual, Inflate, pushes };
});

const { pushes } = await import('fflate');
const { decodePng } = await import('@/options_page/modules/UgoiraEncoders/png');

test('stops pushing once the image is filled, and never pushes as final', async () => {
  vi.stubGlobal('DecompressionStream', class {
    constructor() {
      return new TransformStream({ transform() { throw new TypeError('Junk'); } });
    }
  });
  let seed = 1;
  const noise = Uint8Array.from({ length: 100 * 1024 }, () => (seed = (seed * 1664525 + 1013904223) >>> 0) >>> 24);
  const stream = zlib.deflateSync(Buffer.concat([Buffer.from([0, 1, 2, 3]), noise]));
  const ihdr = [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0];
  const bytes = new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', stream), pngChunk('IEND', [])
  ]));

  expect(stream.length).toBeGreaterThan(5 * 16 * 1024);
  expect(Array.from((await decodePng(bytes)).pixels)).toEqual([1, 2, 3, 255]);
  // zlib stores noise in blocks of 16383 bytes plus a 5-byte header, one more than a 16 KB push, and
  // fflate gives nothing of a block until it is all in, so the first push may give nothing.
  expect(pushes.length).toBeLessThanOrEqual(2);
  expect(pushes.every(push => push.length === 16 * 1024 && !push.final)).toBe(true);

  vi.unstubAllGlobals();
});
