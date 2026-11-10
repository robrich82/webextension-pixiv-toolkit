/**
 * Just enough WebDriver BiDi to drive a tab: Firefox speaks it natively on
 * --remote-debugging-port, so no geckodriver is needed.
 * https://w3c.github.io/webdriver-bidi/
 */
/** How long one command may take before it's failed, so a stalled Firefox can't hang a test. */
const COMMAND_TIMEOUT = 30000;

export class Bidi {
  nextId = 1;
  pending = new Map();
  listeners = new Map();

  /**
   * @param {number} port Firefox's --remote-debugging-port
   */
  static async connect(port) {
    const bidi = new Bidi();
    bidi.socket = new WebSocket(`ws://127.0.0.1:${port}/session`);

    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`BiDi on port ${port} never opened`)), 10000);
        bidi.socket.addEventListener('open', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
        bidi.socket.addEventListener('error', () => {
          clearTimeout(timer);
          reject(new Error(`No BiDi endpoint on port ${port}`));
        }, { once: true });
      });
      bidi.socket.addEventListener('message', event => bidi.receive(JSON.parse(event.data)));
      bidi.socket.addEventListener('close', () => bidi.failPending(new Error('the BiDi connection closed')));

      // pixiv is served by a proxy with a self-signed certificate.
      await bidi.send('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
    } catch (error) {
      bidi.socket.close();
      throw error;
    }

    return bidi;
  }

  receive(message) {
    if (message.type === 'event') {
      this.listeners.get(message.method)?.forEach(listener => listener(message.params));
      return;
    }

    const call = this.pending.get(message.id);

    if (!call) {
      return;
    }

    this.pending.delete(message.id);
    clearTimeout(call.timer);

    if (message.type === 'error') {
      call.reject(new Error(`${call.method}: ${message.error}: ${message.message}`));
    } else {
      call.resolve(message.result);
    }
  }

  send(method, params = {}, timeout = COMMAND_TIMEOUT) {
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      if (this.socket.readyState !== WebSocket.OPEN) {
        reject(new Error(`${method}: the BiDi connection is closed`));
        return;
      }

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: no answer in ${timeout}ms`));
      }, timeout);

      this.pending.set(id, { method, resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Reject every command still waiting for an answer. */
  failPending(error) {
    this.pending.forEach(call => {
      clearTimeout(call.timer);
      call.reject(new Error(`${call.method}: ${error.message}`));
    });
    this.pending.clear();
  }

  /**
   * Collect uncaught errors from every tab, extension pages included.
   * @returns {Promise<string[]>} Filled in as errors happen
   */
  async collectErrors() {
    const errors = [];
    const listeners = this.listeners.get('log.entryAdded') ?? [];

    this.listeners.set('log.entryAdded', [...listeners, entry => {
      if (entry.type === 'javascript' && entry.level === 'error') {
        errors.push(`${entry.source?.context}: ${entry.text}`);
      }
    }]);
    await this.send('session.subscribe', { events: ['log.entryAdded'] });

    return errors;
  }

  /**
   * Open a tab on `url` and wait for it to load.
   * @returns {Promise<string>} The tab's context id
   */
  async openTab(url) {
    const { context } = await this.send('browsingContext.create', { type: 'tab' });
    await this.send('browsingContext.navigate', { context, url, wait: 'complete' });

    return context;
  }

  /**
   * Run `fn` in the page and return its JSON-serialisable result.
   * @param {string} context
   * @param {Function} fn
   * @param {...any} args JSON-serialisable
   */
  async evaluate(context, fn, ...args) {
    const { result, exceptionDetails } = await this.send('script.evaluate', {
      expression: `(${fn})(...${JSON.stringify(args)})`,
      target: { context },
      awaitPromise: true,
      resultOwnership: 'none',
      serializationOptions: { maxObjectDepth: 4 }
    }).then(response => response.type === 'exception'
      ? { exceptionDetails: response.exceptionDetails }
      : { result: response.result });

    if (exceptionDetails) {
      throw new Error(`In the page: ${exceptionDetails.text}`);
    }

    return deserialize(result);
  }

  async close() {
    await this.send('session.end').catch(() => {});
    this.socket.close();
  }
}

/** A BiDi RemoteValue back to plain JSON. */
function deserialize(value) {
  switch (value.type) {
    case 'undefined':
    case 'null':
      return null;
    case 'string':
    case 'number':
    case 'boolean':
      return value.value;
    case 'array':
      return value.value.map(deserialize);
    case 'object':
      return Object.fromEntries(value.value.map(([key, entry]) => [key, deserialize(entry)]));
    default:
      return value.value ?? null;
  }
}
