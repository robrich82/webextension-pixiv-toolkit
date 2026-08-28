/**
 * A `fetch` double that serves the saved fixtures in `test/fixtures/`.
 *
 * Every Pixiv parser goes through `modules/Net/Request`, which reads the
 * response as a stream of `Uint8Array` chunks and hands the concatenated bytes
 * to its `onload` listeners. So the double has to produce a real reader, not
 * just a promise of a body: the parsers decode those bytes with `TextDecoder`
 * before parsing the JSON, and a plain object would never reach them.
 *
 * Routes are matched on the request url. `Request` builds those urls itself
 * from the id it parsed, so asserting on the keys here is also how a spec
 * checks that the parser asked for the right endpoint.
 */

const encoder = new TextEncoder();

/**
 * Split the payload across two chunks so the read loop in `Request.readData`
 * actually iterates. A single-chunk body would leave the concatenation path —
 * the part that would corrupt a multi-byte character — untested.
 */
const chunksOf = body => {
  const bytes = encoder.encode(typeof body === 'string' ? body : JSON.stringify(body));
  const split = Math.floor(bytes.length / 2);

  return [bytes.slice(0, split), bytes.slice(split)];
};

const responseOf = body => {
  const chunks = chunksOf(body);
  let index = 0;

  return {
    ok: true,
    status: 200,
    headers: new Map(),
    body: {
      getReader: () => ({
        read: () => Promise.resolve(
          index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true, value: undefined }
        ),
      }),
    },
  };
};

/**
 * Install a fake `fetch` for the duration of a test.
 *
 * @param {Object.<string, any>} routes url -> response body. A body that is an
 *        `Error` is rejected instead of served, which is how the failure paths
 *        (`Request` dispatching `onerror`) get exercised.
 * @returns {jest.Mock} the installed fetch, for call assertions
 */
export const installFetch = routes => {
  const fetchFake = jest.fn(url => {
    if (!(url in routes)) {
      return Promise.reject(new Error(`No fixture registered for ${url}`));
    }

    const body = routes[url];

    return body instanceof Error ? Promise.reject(body) : Promise.resolve(responseOf(body));
  });

  globalThis.fetch = fetchFake;

  return fetchFake;
};
