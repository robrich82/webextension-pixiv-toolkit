/**
 * Fake `window.XMLHttpRequest`: answers each request with `respond(url)` on a
 * microtask, with the request as `this`. `respond` returns the body (status 200),
 * `{ status, body }`, or `{ networkError: true }` to fire `onerror` instead of
 * `onload`. Returns `{ urls, mimeTypes, restore }`; `mimeTypes` holds each
 * request's `overrideMimeType()` argument, or undefined.
 */
export function installFakeXhr(respond) {
  const original = window.XMLHttpRequest;
  const urls = [];
  const mimeTypes = [];

  window.XMLHttpRequest = class FakeXMLHttpRequest {
    open(method, url) {
      this.url = url;
    }

    overrideMimeType(mimeType) {
      this.mimeType = mimeType;
    }

    send() {
      urls.push(this.url);
      mimeTypes.push(this.mimeType);

      Promise.resolve().then(() => {
        const response = respond(this.url);

        if (response && response.networkError) {
          this.status = 0;
          this.onerror && this.onerror.call(this, {});
          return;
        }

        const { status, body } = typeof response === 'string' ? { status: 200, body: response } : response;

        this.status = status;
        this.responseText = body;
        this.onload && this.onload.call(this, {});
      });
    }
  };

  return {
    urls,
    mimeTypes,
    restore() {
      window.XMLHttpRequest = original;
    }
  };
}
