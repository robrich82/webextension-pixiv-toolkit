/**
 * Fake `window.XMLHttpRequest`: answers each request with `respond(url)` on a
 * microtask, calling `onload` with the request as `this`. Returns `{ urls, restore }`.
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
