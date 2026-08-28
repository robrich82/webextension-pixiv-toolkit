/**
 * `getImageSize` loads a URL into an `Image` and reports the dimensions the
 * browser decoded. There is no decoding to be had under Jest — jsdom stops at
 * the `Image` object and never loads anything, so a jsdom run would need
 * `node-canvas` before it told us anything a stub does not. The `Image` double
 * below is that stub, kept honest about the one thing this module depends on:
 * `width`/`height` are only trustworthy once `load` has fired.
 */
const getImageSize = require('../src/modules/Util/getImageSize').default;

/** Sources this double knows how to "load", keyed by URL. */
let images;

beforeEach(() => {
  images = new Map();

  globalThis.Image = class {
    constructor() {
      this.width = 0;
      this.height = 0;
      this.onload = null;
      this.onerror = null;
    }

    set src(value) {
      this._src = value;

      const image = images.get(value);

      // Decoding is asynchronous in the browser, so a handler attached on the
      // line after `src =` still gets the event.
      setTimeout(() => {
        if (!image) {
          if (this.onerror) {
            this.onerror(new Error(`Failed to load ${value}`));
          }

          return;
        }

        this.width = image.width;
        this.height = image.height;

        if (this.onload) {
          this.onload();
        }
      }, 0);
    }

    get src() {
      return this._src;
    }
  };
});

afterEach(() => {
  delete globalThis.Image;
});

test('resolves with the decoded dimensions', async () => {
  images.set('https://i.pximg.net/img/12345_p0.jpg', { width: 1200, height: 1600 });

  await expect(getImageSize('https://i.pximg.net/img/12345_p0.jpg')).resolves.toEqual({ width: 1200, height: 1600 });
});

test('reads the dimensions on load, not before', async () => {
  // The handler is attached before `src` is assigned; the other order would
  // resolve with the 0x0 an unloaded image reports.
  images.set('data:image/png;base64,AAAA', { width: 90, height: 90 });

  const pending = getImageSize('data:image/png;base64,AAAA');

  await expect(pending).resolves.toEqual({ width: 90, height: 90 });
});

test('works with a data URI, which is what the ugoira frames are', async () => {
  images.set('data:image/jpeg;base64,ZmFrZQ==', { width: 600, height: 600 });

  await expect(getImageSize('data:image/jpeg;base64,ZmFrZQ==')).resolves.toEqual({ width: 600, height: 600 });
});

test('never settles when the image fails to load', async () => {
  // Nothing is attached to `onerror` and the promise has no reject path, so a
  // bad URL leaves the caller awaiting for good rather than throwing.
  const settled = await Promise.race([
    getImageSize('https://i.pximg.net/img/gone.jpg').then(() => 'settled', () => 'rejected'),
    new Promise(resolve => setTimeout(() => resolve('still pending'), 20))
  ]);

  expect(settled).toBe('still pending');
});
