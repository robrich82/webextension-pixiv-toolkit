/**
 * An in-memory stand-in for `@/modules/Extension/browser`.
 *
 * The real module hands back whatever `chrome`/`browser` global the extension
 * happens to be running against, so nothing that touches an extension API can
 * be tested under Jest without it. `jest.config.json` maps that module path
 * here, which means specs get this fake by importing the code under test — no
 * per-spec `jest.mock` call.
 *
 * Two properties of the real APIs are reproduced deliberately, because the
 * codebase depends on both:
 *
 * - Every async call returns a promise *and* invokes an optional trailing
 *   callback. `SettingService` wraps callbacks in promises while
 *   `DownloadService` awaits the call directly, sometimes for the same API.
 * - `runtime.onConnect` is dispatched asynchronously, as the browser does. A
 *   port that posts a message the moment it is opened must not out-run the
 *   listeners the other side attaches after `connect()` returns.
 *
 * Every API is a `jest.fn`, so calls can be asserted with the usual matchers,
 * and the stored state (`storage.local.items`, `downloads.items`, `tabs.items`,
 * `runtime.ports`) is readable for the assertions a call log can't express.
 */

const isFunction = value => typeof value === 'function';

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * A `chrome.events.Event` double.
 */
class FakeEvent {
  constructor() {
    this.listeners = [];
  }

  addListener(listener) {
    this.listeners.push(listener);
  }

  removeListener(listener) {
    const index = this.listeners.indexOf(listener);

    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  hasListener(listener) {
    return this.listeners.indexOf(listener) > -1;
  }

  hasListeners() {
    return this.listeners.length > 0;
  }

  /**
   * Dispatch to every listener, collecting what each one returned. The return
   * values matter for `runtime.onMessage`, where `true` keeps the response
   * channel open.
   */
  emit(...args) {
    return this.listeners.slice().map(listener => listener(...args));
  }

  clear() {
    this.listeners = [];
  }
}

/**
 * One end of a `runtime.connect()` pair. Posting on one end delivers to the
 * `onMessage` of the other.
 */
class FakePort {
  constructor(name, sender) {
    this.name = name;
    this.sender = sender;
    this.onMessage = new FakeEvent();
    this.onDisconnect = new FakeEvent();
    this.peer = null;
    this.disconnected = false;

    /** Everything posted *from* this end, in order. */
    this.postedMessages = [];
  }

  postMessage(message) {
    if (this.disconnected) {
      throw new Error('Attempting to use a disconnected port object');
    }

    this.postedMessages.push(message);

    if (this.peer) {
      this.peer.onMessage.emit(message, this.peer);
    }
  }

  disconnect() {
    if (this.disconnected) {
      return;
    }

    this.disconnected = true;

    if (this.peer && !this.peer.disconnected) {
      this.peer.disconnected = true;
      this.peer.onDisconnect.emit(this.peer);
    }
  }
}

function createBrowserFake() {
  /** Every `jest.fn` handed out, so `reset()` can clear the call logs. */
  const mocks = [];

  /**
   * Wrap an implementation in the shape the extension APIs have: a promise
   * back, plus an optional trailing callback called with the same value.
   */
  const api = impl => {
    const fn = jest.fn(function (...args) {
      const callback = isFunction(args[args.length - 1]) ? args.pop() : null;

      return Promise.resolve()
        .then(() => impl.apply(this, args))
        .then(result => {
          if (callback) {
            callback(result);
          }

          return result;
        });
    });

    mocks.push(fn);

    return fn;
  };

  /** Plain `jest.fn`, for the APIs that are synchronous in the browser too. */
  const syncApi = impl => {
    const fn = jest.fn(impl);

    mocks.push(fn);

    return fn;
  };

  const events = [];

  const event = () => {
    const instance = new FakeEvent();

    events.push(instance);

    return instance;
  };

  const storageOnChanged = event();

  /**
   * A `storage.StorageArea` double.
   */
  class FakeStorageArea {
    constructor(areaName) {
      this.areaName = areaName;
      this.items = {};

      this.get = api(keys => this.readItems(keys));
      this.set = api(items => this.writeItems(items));
      this.remove = api(keys => this.removeItems(keys));
      this.clear = api(() => this.removeItems(Object.keys(this.items)));
    }

    readItems(keys) {
      if (keys === undefined || keys === null) {
        return clone(this.items);
      }

      const picked = {};

      if (typeof keys === 'string') {
        keys = [keys];
      }

      if (Array.isArray(keys)) {
        keys.forEach(key => {
          if (key in this.items) {
            picked[key] = clone(this.items[key]);
          }
        });

        return picked;
      }

      /**
       * An object of defaults: stored values win, missing keys fall back.
       */
      Object.keys(keys).forEach(key => {
        picked[key] = key in this.items ? clone(this.items[key]) : clone(keys[key]);
      });

      return picked;
    }

    writeItems(items) {
      const changes = {};

      Object.keys(items).forEach(key => {
        const change = { newValue: clone(items[key]) };

        if (key in this.items) {
          change.oldValue = clone(this.items[key]);
        }

        changes[key] = change;
        this.items[key] = clone(items[key]);
      });

      this.emitChanges(changes);
    }

    removeItems(keys) {
      if (typeof keys === 'string') {
        keys = [keys];
      }

      const changes = {};

      keys.forEach(key => {
        if (key in this.items) {
          changes[key] = { oldValue: clone(this.items[key]) };
          delete this.items[key];
        }
      });

      this.emitChanges(changes);
    }

    emitChanges(changes) {
      if (Object.keys(changes).length > 0) {
        storageOnChanged.emit(changes, this.areaName);
      }
    }
  }

  const local = new FakeStorageArea('local');

  const runtimeOnMessage = event();
  const runtimeOnConnect = event();
  const downloadsOnDeterminingFilename = event();

  const defaults = () => ({
    /** Handed back by `i18n.getUILanguage()`. */
    uiLanguage: 'en-US',
    manifest: { version: '0.0.0', manifest_version: 3 },
    platformInfo: { os: 'linux', arch: 'x86-64' },
    /** Set to make `runtime.lastError` report a failure. */
    lastError: undefined,
    currentTab: undefined,
    nextTabId: 1,
    nextWindowId: 1,
    nextDownloadId: 1,
    nextNotificationId: 1,
    grantedPermissions: { permissions: [], origins: [] }
  });

  const state = defaults();

  const browser = {
    runtime: {
      id: 'pixiv-toolkit-test',

      get lastError() {
        return state.lastError;
      },

      /** The caller's end of every port opened through `connect()`. */
      ports: [],

      onMessage: runtimeOnMessage,
      onConnect: runtimeOnConnect,
      onInstalled: event(),
      onStartup: event(),
      onSuspend: event(),
      onSuspendCanceled: event(),
      onRestartRequired: event(),
      onUpdateAvailable: event(),

      /**
       * Delivered to the `onMessage` listeners. Resolves with the value the
       * first listener passes to `sendResponse`, or `undefined` when no
       * listener keeps the response channel open.
       */
      sendMessage: api(message => new Promise(resolve => {
        let responded = false;

        const sendResponse = response => {
          if (!responded) {
            responded = true;
            resolve(response);
          }
        };

        const sender = { id: browser.runtime.id };
        const returned = runtimeOnMessage.emit(message, sender, sendResponse);

        if (!returned.some(value => value === true) && !responded) {
          resolve(undefined);
        }
      })),

      /**
       * Returns the caller's end of a new port. The other end reaches
       * `onConnect` on a later tick, so the caller can attach its listeners
       * first — the same ordering the browser gives.
       */
      connect: syncApi((connectInfo = {}) => {
        const name = typeof connectInfo === 'string' ? connectInfo : connectInfo.name;
        const sender = { id: browser.runtime.id };

        const clientPort = new FakePort(name, sender);
        const serverPort = new FakePort(name, sender);

        clientPort.peer = serverPort;
        serverPort.peer = clientPort;

        browser.runtime.ports.push(clientPort);

        Promise.resolve().then(() => runtimeOnConnect.emit(serverPort));

        return clientPort;
      }),

      getURL: syncApi(path => `chrome-extension://${browser.runtime.id}/${String(path).replace(/^\//, '')}`),
      getManifest: syncApi(() => clone(state.manifest)),
      getPlatformInfo: api(() => clone(state.platformInfo)),
      reload: syncApi(() => undefined)
    },

    storage: {
      local,
      onChanged: storageOnChanged
    },

    downloads: {
      /** Every requested download, keyed by the id handed back. */
      items: new Map(),

      onDeterminingFilename: downloadsOnDeterminingFilename,
      onChanged: event(),

      download: api(options => {
        const id = state.nextDownloadId++;

        browser.downloads.items.set(id, Object.assign({ id, state: 'in_progress' }, options));

        return id;
      }),

      show: api(() => undefined),
      setShelfEnabled: syncApi(() => undefined)
    },

    tabs: {
      /** Every known tab, keyed by id. */
      items: new Map(),

      onCreated: event(),
      onUpdated: event(),
      onRemoved: event(),

      get: api(tabId => {
        if (!browser.tabs.items.has(tabId)) {
          throw new Error(`No tab with id: ${tabId}.`);
        }

        return clone(browser.tabs.items.get(tabId));
      }),

      create: api((createProperties = {}) => {
        const tab = Object.assign({
          id: state.nextTabId++,
          windowId: state.nextWindowId,
          index: browser.tabs.items.size,
          active: true
        }, createProperties);

        browser.tabs.items.set(tab.id, tab);
        browser.tabs.onCreated.emit(clone(tab));

        return clone(tab);
      }),

      update: api((tabId, updateProperties) => {
        if (!browser.tabs.items.has(tabId)) {
          throw new Error(`No tab with id: ${tabId}.`);
        }

        return clone(Object.assign(browser.tabs.items.get(tabId), updateProperties));
      }),

      /**
       * Matches on the plain-value properties of `queryInfo`. Chrome's URL
       * match patterns are not supported; a spec that needs one should assert
       * on the call instead.
       */
      query: api((queryInfo = {}) => Array.from(browser.tabs.items.values())
        .filter(tab => Object.keys(queryInfo).every(key => tab[key] === queryInfo[key]))
        .map(clone)),

      remove: api(tabId => {
        browser.tabs.items.delete(tabId);
        browser.tabs.onRemoved.emit(tabId, { windowId: state.nextWindowId, isWindowClosing: false });
      }),

      getCurrent: api(() => clone(state.currentTab)),
      executeScript: api(() => [])
    },

    windows: {
      update: api((windowId, updateInfo) => Object.assign({ id: windowId }, updateInfo))
    },

    i18n: {
      getUILanguage: syncApi(() => state.uiLanguage),
      getMessage: syncApi(messageName => messageName)
    },

    action: {
      /** The badge as the last call left it. */
      badge: { text: '', backgroundColor: '', icon: undefined },

      setBadgeText: api(({ text }) => {
        browser.action.badge.text = text;
      }),

      getBadgeText: api(() => browser.action.badge.text),

      setBadgeBackgroundColor: api(({ color }) => {
        browser.action.badge.backgroundColor = color;
      }),

      setIcon: api(details => {
        browser.action.badge.icon = details;
      })
    },

    permissions: {
      getAll: api(() => clone(state.grantedPermissions)),

      contains: api(({ permissions = [], origins = [] }) =>
        permissions.every(name => state.grantedPermissions.permissions.includes(name)) &&
        origins.every(origin => state.grantedPermissions.origins.includes(origin))),

      request: api(({ permissions = [], origins = [] }) => {
        permissions.forEach(name => {
          if (!state.grantedPermissions.permissions.includes(name)) {
            state.grantedPermissions.permissions.push(name);
          }
        });

        origins.forEach(origin => {
          if (!state.grantedPermissions.origins.includes(origin)) {
            state.grantedPermissions.origins.push(origin);
          }
        });

        return true;
      }),

      remove: api(({ permissions = [], origins = [] }) => {
        state.grantedPermissions.permissions = state.grantedPermissions.permissions
          .filter(name => !permissions.includes(name));
        state.grantedPermissions.origins = state.grantedPermissions.origins
          .filter(origin => !origins.includes(origin));

        return true;
      })
    },

    notifications: {
      /** Live notifications, keyed by id. */
      items: new Map(),

      create: api((notificationId, options) => {
        if (typeof notificationId !== 'string') {
          options = notificationId;
          notificationId = `notification-${state.nextNotificationId++}`;
        }

        browser.notifications.items.set(notificationId, options);

        return notificationId;
      }),

      clear: api(notificationId => browser.notifications.items.delete(notificationId))
    }
  };

  /**
   * Test-only controls. Not part of the extension API — everything under here
   * exists to set up or drive the fake from a spec.
   */
  browser._fake = {
    state,

    /**
     * Put the fake back to how it started: empty stores, no listeners, no
     * recorded calls. `test/setup/extensionGlobals.js` runs this before every
     * test, so specs rarely call it themselves.
     */
    reset() {
      mocks.forEach(mock => mock.mockClear());
      events.forEach(instance => instance.clear());

      local.items = {};
      browser.runtime.ports = [];
      browser.downloads.items.clear();
      browser.tabs.items.clear();
      browser.notifications.items.clear();
      browser.action.badge = { text: '', backgroundColor: '', icon: undefined };

      Object.assign(state, defaults());
    },

    /**
     * Let the queued microtasks and timers run. Needed after a `connect()`,
     * whose `onConnect` dispatch is deferred.
     */
    flush() {
      return new Promise(resolve => setTimeout(resolve, 0));
    },

    /** Seed a tab without going through `tabs.create()`. */
    addTab(tab) {
      const seeded = Object.assign({ id: state.nextTabId++, windowId: state.nextWindowId }, tab);

      browser.tabs.items.set(seeded.id, seeded);

      return clone(seeded);
    },

    /** What `tabs.getCurrent()` resolves with. */
    setCurrentTab(tab) {
      state.currentTab = tab;
    },

    setUILanguage(language) {
      state.uiLanguage = language;
    },

    setManifest(manifest) {
      state.manifest = manifest;
    },

    /** What `runtime.lastError` reports until it is cleared again. */
    setLastError(error) {
      state.lastError = error;
    },

    /**
     * Drive `downloads.onDeterminingFilename`, returning the suggestion the
     * listeners settled on — this is how a spec sees the filename a download
     * would actually be written under.
     */
    determineFilename(downloadItem) {
      let suggestion;

      downloadsOnDeterminingFilename.emit(downloadItem, value => { suggestion = value; });

      return suggestion;
    },

    /** The most recently requested download, for the common one-call case. */
    lastDownload() {
      const downloads = Array.from(browser.downloads.items.values());

      return downloads[downloads.length - 1];
    }
  };

  return browser;
}

const browserFake = createBrowserFake();

export { createBrowserFake, FakeEvent, FakePort };

export default browserFake;
