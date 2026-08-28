/**
 * `getCanvasFromDataURI` draws a data URI onto a canvas of a given size and
 * hands the canvas back. jsdom implements neither canvas nor image decoding, so
 * a run under it would need `node-canvas` to get past `getContext('2d')` — and
 * even then would be checking that the browser draws, not that this module asks
 * it to. The doubles below record what it asks for: the canvas it sizes, and
 * the `drawImage` call it makes once the image has loaded.
 */
const getCanvasFromDataURI = require('../src/modules/Util/getCanvasFromDataURI').default;

let images;
let context;
let canvases;

beforeEach(() => {
  images = [];
  canvases = [];
  context = { drawImage: jest.fn() };

  globalThis.Image = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.listeners = {};

      images.push(this);
    }

    addEventListener(name, listener) {
      (this.listeners[name] = this.listeners[name] || []).push(listener);
    }

    /** Fire `load` as the browser would, once the caller is listening. */
    load() {
      (this.listeners.load || []).forEach(listener => listener());
    }
  };

  globalThis.document = {
    createElement: jest.fn(tagName => {
      const element = {
        tagName,
        attributes: {},
        setAttribute: jest.fn((name, value) => { element.attributes[name] = value; }),
        getContext: jest.fn(() => context)
      };

      canvases.push(element);

      return element;
    })
  };
});

afterEach(() => {
  delete globalThis.Image;
  delete globalThis.document;
});

const dataURI = 'data:image/png;base64,AAAA';

/** Start a conversion and let the image finish loading. */
function convert(size = { width: 400, height: 300 }) {
  const pending = getCanvasFromDataURI(dataURI, size);

  images[images.length - 1].load();

  return pending;
}

test('resolves with a canvas sized to the size it was given', async () => {
  const canvas = await convert({ width: 400, height: 300 });

  expect(canvas).toBe(canvases[0]);
  expect(document.createElement).toHaveBeenCalledWith('canvas');
  expect(canvas.attributes).toEqual({ width: 400, height: 300 });
});

test('draws the image over the whole canvas', async () => {
  await convert({ width: 400, height: 300 });

  expect(context.drawImage).toHaveBeenCalledWith(images[0], 0, 0, 400, 300);
});

test('gives the image the same size, so a data URI of other dimensions is scaled', async () => {
  await convert({ width: 128, height: 64 });

  expect(images[0]).toMatchObject({ width: 128, height: 64 });
});

test('loads the data URI it was handed', async () => {
  await convert();

  expect(images[0].src).toBe(dataURI);
});

test('makes no canvas until the image has loaded', () => {
  getCanvasFromDataURI(dataURI, { width: 400, height: 300 });

  expect(document.createElement).not.toHaveBeenCalled();
});

test('never settles when the image does not load', async () => {
  // Only `load` is listened for: an image that errors leaves the promise
  // pending, and the caller waiting on it with nothing to catch.
  const settled = await Promise.race([
    getCanvasFromDataURI(dataURI, { width: 400, height: 300 }).then(() => 'settled', () => 'rejected'),
    new Promise(resolve => setTimeout(() => resolve('still pending'), 20))
  ]);

  expect(settled).toBe('still pending');
});
