import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Bidi } from './bidi.mjs';
import { startFakePixiv } from './fakePixiv.mjs';

const EXTENSION_PATH = path.join(import.meta.dirname, '..', 'dist', 'firefox');
const EXTENSION_ID = JSON.parse(fs.readFileSync(path.join(EXTENSION_PATH, 'manifest.json'), 'utf8'))
  .browser_specific_settings?.gecko?.id;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Every Firefox started and not yet closed. A test that times out inside
 * `launch()` never gets a `Firefox` to close, and the process it left would
 * keep `node --test` from exiting; `closeAll()` reaches it through here.
 * @type {Set<FirefoxProcess>}
 */
const running = new Set();

/**
 * Close every Firefox still running, reporting the launch step any of them was
 * stuck at.
 */
export async function closeAll() {
  await Promise.all(Array.from(running, firefox => {
    console.error(`Closing a Firefox left running; its launch got as far as: ${firefox.steps.join(' > ')}`);

    return firefox.close();
  }));
}

/**
 * Call `fn` until it returns something truthy, and return that.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {string} message Thrown on timeout
 * @returns {Promise<T>}
 */
export async function poll(fn, message, timeout = 20000) {
  const deadline = Date.now() + timeout;

  for (;;) {
    const value = await fn().catch(() => undefined);

    if (value) {
      return value;
    }

    if (Date.now() > deadline) {
      throw new Error(`Timed out: ${message}`);
    }

    await sleep(200);
  }
}

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer().on('error', reject).listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

function firefoxBinary() {
  if (process.env.FIREFOX) {
    return process.env.FIREFOX;
  }

  return {
    win32: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    darwin: '/Applications/Firefox.app/Contents/MacOS/firefox'
  }[process.platform] ?? 'firefox';
}

/**
 * A Firefox on a throwaway profile, driven over WebDriver BiDi. Started here
 * rather than through web-ext, whose launcher leaves Firefox running when it
 * gives up connecting, which keeps the test process alive.
 */
class FirefoxProcess {
  static async start(prefs) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-e2e-profile-'));
    fs.writeFileSync(path.join(profile, 'user.js'), Object.entries(prefs)
      .map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});\n`)
      .join(''));

    const port = await freePort();
    const child = spawn(firefoxBinary(), [
      '-profile', profile, '-no-remote', `--remote-debugging-port=${port}`,
      ...(process.env.HEADED ? [] : ['-headless']),
      // The Windows launcher process would otherwise exit at once, leaving
      // nothing here to wait on or kill.
      ...(process.platform === 'win32' ? ['-wait-for-browser'] : [])
    ], {
      stdio: 'ignore',
      // Lets BiDi reach chrome code (to find the extension's moz-extension
      // host) and evaluate in extension pages.
      env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' }
    });
    const firefox = new FirefoxProcess({ child, profile });
    const deadline = Date.now() + 60000;

    firefox.step('spawned');

    // Firefox can take a while to open the port on a cold start.
    while (!firefox.bidi) {
      const failure = firefox.failure ??
        (Date.now() > deadline ? new Error(`No WebDriver BiDi on port ${port}`) : undefined);

      if (failure) {
        await firefox.close();
        throw failure;
      }

      firefox.bidi = await Bidi.connect(port).catch(() => sleep(200));
    }

    firefox.step('BiDi session');

    return firefox;
  }

  constructor({ child, profile }) {
    Object.assign(this, { child, profile, steps: [], started: Date.now() });
    running.add(this);
    this.exited = new Promise(resolve => {
      child.once('error', error => {
        this.failure = error;
        resolve();
      });
      child.once('exit', code => {
        this.failure ??= new Error(`Firefox exited with code ${code}`);
        resolve();
      });
    });
  }

  /** Record how far the launch got, and when, for a launch that never returns. */
  step(name) {
    this.steps.push(`${name} (${Date.now() - this.started}ms)`);

    if (process.env.E2E_DEBUG) {
      console.error(`[firefox] ${this.steps.at(-1)}`);
    }
  }

  async close() {
    running.delete(this);

    // Ask Firefox to quit, and kill it only if it hasn't within 10s.
    await this.bidi?.send('browser.close', {}, 10000).catch(() => {});
    this.bidi?.socket.close();

    if (await Promise.race([this.exited.then(() => true), sleep(10000)]) !== true) {
      this.child.kill();
      await Promise.race([this.exited, sleep(10000)]);
    }

    // The profile is locked on Windows until Firefox has gone.
    fs.rmSync(this.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}

/**
 * Start Firefox with dist/firefox as a temporary add-on, pixiv served from
 * test/fixtures (see fakePixiv.mjs) and downloads saved to a temp folder.
 *
 * @param {Parameters<typeof startFakePixiv>[0]} routes
 */
export async function launch(routes) {
  if (!EXTENSION_ID) {
    throw new Error(`No Firefox build at ${EXTENSION_PATH}; run \`pnpm run build:firefox\` first.`);
  }

  const pixiv = await startFakePixiv(routes);
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-e2e-downloads-'));
  let browserProcess;

  try {
    browserProcess = await FirefoxProcess.start({
      // Everything goes through the fake pixiv, which refuses other hosts.
      'network.proxy.type': 1,
      'network.proxy.http': '127.0.0.1',
      'network.proxy.http_port': pixiv.port,
      'network.proxy.ssl': '127.0.0.1',
      'network.proxy.ssl_port': pixiv.port,
      'network.proxy.no_proxies_on': '',
      'browser.download.folderList': 2,
      'browser.download.dir': downloadDir,
      'browser.download.useDownloadDir': true,
      'datareporting.policy.dataSubmissionEnabled': false,
      'datareporting.healthreport.uploadEnabled': false,
      'toolkit.telemetry.enabled': false,
      'app.normandy.enabled': false
    });

    const { bidi } = browserProcess;
    const errors = await bidi.collectErrors();
    // Firefox installs an unpacked extension from a path as a temporary add-on.
    await bidi.send('webExtension.install', { extensionData: { type: 'path', path: EXTENSION_PATH } });
    browserProcess.step('extension installed');
    const [chromeWindow] = (await bidi.send('browsingContext.getTree', { 'moz:scope': 'chrome' })).contexts;
    const host = await bidi.evaluate(chromeWindow.context,
      id => WebExtensionPolicy.getByID(id)?.mozExtensionHostname, EXTENSION_ID);

    if (!host) {
      throw new Error(`${EXTENSION_ID} isn't installed`);
    }
    browserProcess.step('extension host found');

    const firefox = new Firefox({ browserProcess, bidi, pixiv, downloadDir, errors, origin: `moz-extension://${host}` });

    // The fresh install writes the default settings asynchronously; a page
    // opened before then misses them (#241).
    await poll(() => firefox.inExtension(() => browser.storage.local.get('version').then(items => items.version)),
      'the install never wrote the default settings');
    browserProcess.step('settings written');

    return firefox;
  } catch (error) {
    await browserProcess?.close();
    await pixiv.close();
    fs.rmSync(downloadDir, { recursive: true, force: true });
    throw error;
  }
}

class Firefox {
  constructor({ browserProcess, bidi, pixiv, downloadDir, errors, origin }) {
    Object.assign(this, { browserProcess, bidi, pixiv, downloadDir, errors, origin });
  }

  /**
   * Run `fn` in an extension page, where `browser.*` is available. Uses an
   * options page tab of its own: a download manager tab the extension didn't
   * open itself isn't recognised, and it would open a second one.
   */
  async inExtension(fn, ...args) {
    this.helperTab ??= await this.bidi.openTab(`${this.origin}/options_page/index.html`);

    return this.bidi.evaluate(this.helperTab, fn, ...args);
  }

  /** Run `fn` in the download manager tab, which has the JSZip global. */
  async inDownloadManager(fn, ...args) {
    const { contexts } = await this.bidi.send('browsingContext.getTree', {});
    const manager = contexts.find(context => context.url.startsWith(`${this.origin}/options_page/downloads.html`));

    if (!manager) {
      throw new Error('The download manager is not open');
    }

    return this.bidi.evaluate(manager.context, fn, ...args);
  }

  /** Write settings the way the options page does. Pages opened afterwards read them. */
  async seedSettings(settings) {
    await this.inExtension(items => browser.storage.local.set(items), settings);
  }

  /** Open a work page and expand the collapsed panel the way a user would. */
  async openPanel(url) {
    const tab = await this.bidi.openTab(url);

    await poll(() => this.bidi.evaluate(tab, () => {
      const handler = document.querySelector('#ptk__new-handler');
      handler?.click();

      return !!handler;
    }), `no panel on ${url}`);

    return tab;
  }

  /** Click the panel button whose text is exactly `label`. */
  async clickButton(tab, label) {
    await poll(() => this.bidi.evaluate(tab, text => {
      const button = [...document.querySelectorAll('.ptk__action__wrapper__body a')]
        .find(a => a.textContent.trim() === text);
      button?.click();

      return !!button;
    }, label), `no "${label}" button`);
  }

  /**
   * Wait until `count` downloads have finished and return the saved files,
   * relative to the download folder, oldest first.
   * @returns {Promise<{ name: string, path: string, mime: string }[]>}
   */
  async savedFiles(count) {
    const search = () => this.inExtension(() => browser.downloads.search({})
      .then(items => items.map(({ id, filename, mime, state, error }) => ({ id, filename, mime, state, error }))));
    let items;

    try {
      await poll(async () => {
        items = await search();

        return items.length === count && items.every(item => item.state === 'complete');
      }, `${count} completed downloads`);
    } catch (error) {
      throw new Error(`${error.message}; got ${JSON.stringify(items)}`);
    }

    return items.sort((a, b) => a.id - b.id).map(item => {
      const name = path.relative(this.downloadDir, item.filename);

      // A file saved anywhere else means the download folder pref broke.
      if (name.startsWith('..') || path.isAbsolute(name)) {
        throw new Error(`${item.filename} was saved outside ${this.downloadDir}`);
      }

      return { name: name.split(path.sep).join('/'), path: item.filename, mime: item.mime };
    });
  }

  /** The entries of a saved zip, each with its bytes as base64. */
  async unzip(file) {
    return this.inDownloadManager(async base64 => {
      const zip = await JSZip.loadAsync(base64, { base64: true });
      const names = Object.keys(zip.files).filter(name => !zip.files[name].dir).sort();

      return Promise.all(names.map(async name => ({ name, base64: await zip.file(name).async('base64') })));
    }, fs.readFileSync(file).toString('base64'));
  }

  /** Decode a saved image in Firefox and return its dimensions. Rejects if it doesn't decode. */
  async decodeImage(file, mime) {
    return this.inDownloadManager(async (base64, type) => {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type }));
      const image = new Image();
      image.src = url;

      try {
        await image.decode();

        return { width: image.naturalWidth, height: image.naturalHeight };
      } finally {
        URL.revokeObjectURL(url);
      }
    }, fs.readFileSync(file).toString('base64'), mime);
  }

  async close() {
    await this.browserProcess.close();
    await this.pixiv.close();
    fs.rmSync(this.downloadDir, { recursive: true, force: true });
  }
}
