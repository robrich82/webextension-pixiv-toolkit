/**
 * Stands in for the network under `fetch`, answering each file request when a
 * spec says so. Responses are real `Response`s over a `ReadableStream`, and
 * aborting behaves as the fetch spec says: the pending `fetch` rejects, or the
 * body errors, with an AbortError. `data:` urls go to the real `fetch`, since
 * `Downloader` reads each finished file back through one.
 */
export function installFileServer() {
  const realFetch = globalThis.fetch;
  const requests = [];

  const fetchFake = vi.fn((url, init = {}) => {
    if (String(url).startsWith('data:')) {
      return realFetch(url);
    }

    return new Promise((resolve, reject) => {
      let body;

      const abortError = () => new DOMException('The operation was aborted.', 'AbortError');

      const request = {
        url,
        init,
        aborted: false,

        /**
         * Answer with `content`, split into `chunks` parts. With `stall`, only
         * the first part is sent, and the body stays open until `finish()`.
         */
        respond(content = 'file', { type = 'image/png', status = 200, statusText = '', chunks = 2, contentLength = true, stall = false } = {}) {
          const bytes = new TextEncoder().encode(content);
          const size = Math.ceil(bytes.length / chunks);
          const parts = Array.from({ length: chunks }, (_, i) => bytes.slice(i * size, (i + 1) * size));
          const headers = { 'Content-Type': type };

          if (contentLength) {
            headers['Content-Length'] = String(bytes.length);
          }

          const stream = new ReadableStream({
            start(controller) {
              body = controller;
              (stall ? parts.slice(0, 1) : parts).forEach(part => controller.enqueue(part));

              if (!stall) {
                controller.close();
              }
            }
          });

          request.finish = () => {
            parts.slice(1).forEach(part => body.enqueue(part));
            body.close();
          };

          resolve(new Response(stream, { status, statusText, headers }));
        },

        /** Drop the connection mid-body, after a stalled `respond()`. */
        drop() {
          body.error(new TypeError('network error'));
        },

        /** Fail the way a dropped connection does. */
        fail() {
          reject(new TypeError('Failed to fetch'));
        }
      };

      if (init.signal?.aborted) {
        reject(abortError());
      }

      init.signal?.addEventListener('abort', () => {
        request.aborted = true;
        reject(abortError());
        body?.error(abortError());
      });

      requests.push(request);
    });
  });

  globalThis.fetch = fetchFake;

  return {
    requests,
    uninstall() {
      globalThis.fetch = realFetch;
    }
  };
}
