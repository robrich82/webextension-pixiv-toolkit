/**
 * Swaps `window.XMLHttpRequest` for a double that answers every request with
 * `respond(url)` on a later microtask, calling `onload` with the request as
 * `this` (SponsorsCard reads `this.responseText`). Returns the requested URLs
 * and a `restore()`.
 */
export function installFakeXhr(respond) {
  const original = window.XMLHttpRequest;
  const urls = [];

  window.XMLHttpRequest = class FakeXMLHttpRequest {
    open(method, url) {
      this.url = url;
    }

    send() {
      urls.push(this.url);

      Promise.resolve().then(() => {
        this.responseText = respond(this.url);
        this.onload && this.onload.call(this, {});
      });
    }
  };

  return {
    urls,
    restore() {
      window.XMLHttpRequest = original;
    }
  };
}
