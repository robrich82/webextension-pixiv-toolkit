import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Bidi } from './bidi.mjs';
import { startFakePixiv } from './fakePixiv.mjs';

const EXTENSION_PATH = path.join(import.meta.dirname, '..', 'dist', 'firefox');

const sleep = ms => delay(ms);
/** A wait that doesn't keep node alive once everything else has finished. */
const timeout = ms => delay(ms, undefined, { ref: false });

/** Run each cleanup step in turn, even if an earlier one throws, then throw the first error. */
async function cleanUp(...steps) {
  let firstError;

  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      firstError ??= error;
    }
  }

  if (firstError) {
    throw firstError;
  }
}

/**
 * Every launch not yet closed, with its Firefox, fake pixiv and download
 * folder, so `closeAll()` can reach one the test timed out on: it never got a
 * `Firefox` back to close, and the leftovers would keep `node --test` running.
 * @type {Set<{ process?: FirefoxProcess, close: () => Promise<void> }>}
 */
const launches = new Set();

/** Close every launch still open, reporting how far each got. */
export async function closeAll() {
  await cleanUp(...Array.from(launches, launch => () => {
    console.error(`Closing a Firefox left running; its launch got as far as: ${launch.process?.steps.join(' > ') ?? 'not spawned'}`);

    return launch.close();
  }));
}

/**
 * Call `fn` until it returns something truthy, and return that. A rejection
 * counts as "not yet", but the last one is kept for the timeout message.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {string|(() => string)} message Thrown on timeout
 * @returns {Promise<T>}
 */
async function poll(fn, message, limit = 20000) {
  const deadline = Date.now() + limit;
  let lastError;

  for (;;) {
    const value = await fn().catch(error => {
      // Firefox has gone (closed, or crashed): nothing to wait for.
      if (/BiDi connection (is )?closed/.test(error.message)) {
        throw error;
      }

      lastError = error;
    });

    if (value) {
      return value;
    }

    if (Date.now() > deadline) {
      const text = typeof message === 'function' ? message() : message;

      throw new Error(`Timed out: ${text}${lastError ? ` (last error: ${lastError.message})` : ''}`);
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

function extensionId() {
  const manifest = path.join(EXTENSION_PATH, 'manifest.json');

  if (!fs.existsSync(manifest)) {
    throw new Error(`No Firefox build at ${EXTENSION_PATH}; run \`pnpm run build:firefox\` first.`);
  }

  const id = JSON.parse(fs.readFileSync(manifest, 'utf8')).browser_specific_settings?.gecko?.id;

  if (!id) {
    throw new Error(`${manifest} has no gecko id; is it a Chrome build?`);
  }

  return id;
}

/**
 * A Firefox on a throwaway profile, driven over WebDriver BiDi. Started here
 * rather than through web-ext, whose launcher leaves Firefox running when it
 * gives up connecting, which keeps the test process alive.
 */
class FirefoxProcess {
  /** @param {(process: FirefoxProcess) => void} onSpawn Hands the process over before it is up */
  static async start(prefs, onSpawn) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-e2e-profile-'));
    let child;
    let port;

    try {
      fs.writeFileSync(path.join(profile, 'user.js'), Object.entries(prefs)
        .map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});\n`)
        .join(''));

      port = await freePort();
      child = spawn(firefoxBinary(), [
        '-profile', profile, '-no-remote', `--remote-debugging-port=${port}`,
        ...(process.env.HEADED ? [] : ['-headless']),
        // The Windows launcher process would otherwise exit at once, leaving
        // nothing here to wait on or kill.
        ...(process.platform === 'win32' ? ['-wait-for-browser'] : [])
      ], {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: {
          ...process.env,
          // Lets BiDi reach chrome code (to find the extension's moz-extension
          // host) and evaluate in extension pages.
          MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1',
          MOZ_CRASHREPORTER_DISABLE: '1'
        }
      });
    } catch (error) {
      fs.rmSync(profile, { recursive: true, force: true });
      throw error;
    }

    const firefox = new FirefoxProcess({ child, profile });
    onSpawn(firefox);
    const deadline = Date.now() + 60000;
    let lastError;

    firefox.step('spawned');

    // Firefox can take a while to open the port on a cold start. Only a
    // refused connection is retried; a session Firefox turns down is not.
    while (!firefox.bidi) {
      const failure = firefox.closed ? new Error('Firefox was closed while it started') : firefox.failure ??
        (Date.now() > deadline ? new Error(`No WebDriver BiDi on port ${port}: ${lastError?.message}`) : undefined);

      if (failure) {
        await firefox.close();
        throw firefox.withStderr(failure);
      }

      try {
        const bidi = await Bidi.connect(port);

        if (firefox.closed) {
          bidi.socket.close();
        } else {
          firefox.bidi = bidi;
        }
      } catch (error) {
        if (!error.retryable) {
          await firefox.close();
          throw firefox.withStderr(error);
        }

        lastError = error;
        await sleep(200);
      }
    }

    firefox.step('BiDi session');

    return firefox;
  }

  constructor({ child, profile }) {
    this.child = child;
    this.profile = profile;
    this.steps = [];
    this.started = Date.now();
    this.stderr = '';

    // Kept for error messages: a crash or a refused BiDi port says why here.
    child.stderr.setEncoding('utf8').on('data', chunk => {
      this.stderr = (this.stderr + chunk).slice(-4000);

      if (process.env.E2E_DEBUG) {
        process.stderr.write(chunk);
      }
    });

    this.exited = new Promise(resolve => {
      child.once('error', error => {
        this.failure = error;
        resolve();
      });
      child.once('exit', (code, signal) => {
        this.failure ??= new Error(`Firefox exited with ${signal ?? `code ${code}`}`);
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

  withStderr(error) {
    if (this.stderr.trim()) {
      error.message += `\nFirefox stderr (last 4000 chars):\n${this.stderr}`;
    }

    return error;
  }

  async exitedWithin(ms) {
    return Promise.race([this.exited.then(() => true), timeout(ms).then(() => false)]);
  }

  /** Kill Firefox and, on Windows, the browser the launcher process started. */
  kill() {
    if (process.env.E2E_DEBUG || this.bidi) {
      console.error(`Killing Firefox (pid ${this.child.pid})${this.bidi ? ': it did not quit when asked' : ''}`);
    }

    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/PID', String(this.child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        // It has already gone.
      }
    } else {
      this.child.kill('SIGKILL');
    }
  }

  /** Safe to call more than once: every caller waits for the same teardown. */
  close() {
    this.closed = true;

    return this.closing ??= this.quit();
  }

  async quit() {
    // Ask Firefox to quit, and kill it if it hasn't within 10s. Without a
    // session there's nothing to ask, so kill it straight away.
    await this.bidi?.send('browser.close', {}, 10000).catch(() => {});
    this.bidi?.socket.close();

    if (!this.failure && !await this.exitedWithin(this.bidi ? 10000 : 0)) {
      this.kill();
      await this.exitedWithin(10000);
    }

    // The profile is locked on Windows until Firefox has gone; a leftover temp
    // folder is better than a teardown that throws.
    try {
      fs.rmSync(this.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    } catch (error) {
      console.error(`Couldn't remove ${this.profile}: ${error.message}`);
    }
  }
}

/**
 * Start Firefox with dist/firefox as a temporary add-on, pixiv served from
 * test/fixtures (see fakePixiv.mjs) and downloads saved to a temp folder.
 *
 * @param {Parameters<typeof startFakePixiv>[0]} routes
 */
export async function launch(routes) {
  const extension = extensionId();
  const pixiv = await startFakePixiv(routes);
  // The real path: Firefox reports downloads under it, and %TEMP% can be an
  // 8.3 short path on Windows, /var a symlink on macOS.
  const downloadDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-e2e-downloads-')));
  const resources = {
    process: undefined,
    close: () => resources.closing ??= (launches.delete(resources), cleanUp(
      () => resources.process?.close(),
      () => pixiv.close(),
      () => fs.rmSync(downloadDir, { recursive: true, force: true })
    ))
  };

  launches.add(resources);

  try {
    const browserProcess = await FirefoxProcess.start({
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
    }, process => {
      resources.process = process;

      // closeAll() got here first, before there was a process to close.
      if (resources.closing) {
        process.close();
      }
    });

    const { bidi } = browserProcess;
    const logs = await bidi.collectLogs();
    // Firefox installs an unpacked extension from a path as a temporary add-on.
    await bidi.send('webExtension.install', { extensionData: { type: 'path', path: EXTENSION_PATH } });
    browserProcess.step('extension installed');
    const [chromeWindow] = (await bidi.send('browsingContext.getTree', { 'moz:scope': 'chrome' })).contexts;
    const host = await bidi.evaluate(chromeWindow.context,
      id => WebExtensionPolicy.getByID(id)?.mozExtensionHostname, extension);

    if (!host) {
      throw new Error(`${extension} isn't installed`);
    }

    browserProcess.step('extension host found');
    const firefox = new Firefox({ resources, pixiv, downloadDir, logs, origin: `moz-extension://${host}` });

    // The fresh install writes the default settings asynchronously; a page
    // opened before then misses them (#241).
    await poll(() => firefox.inExtension(() => browser.storage.local.get('version').then(items => items.version)),
      'the install never wrote the default settings');
    browserProcess.step('settings written');

    // Finished after its test timed out: don't hand a closed Firefox to the next test.
    if (resources.closing) {
      throw new Error('closeAll() closed this launch before it finished');
    }

    return firefox;
  } catch (error) {
    await resources.close().catch(cleanupError => console.error(`Cleaning up a failed launch: ${cleanupError.message}`));
    throw error;
  }
}

class Firefox {
  constructor({ resources, pixiv, downloadDir, logs, origin }) {
    this.resources = resources;
    this.bidi = resources.process.bidi;
    this.pixiv = pixiv;
    this.downloadDir = downloadDir;
    /** Uncaught errors in any tab, the download manager included; a test fails on any. */
    this.errors = logs.errors;
    /** `console.error` output, which is how the download manager reports a failed task. */
    this.consoleErrors = logs.consoleErrors;
    this.origin = origin;
  }

  /**
   * Run `fn` in an extension page, where `browser.*` is available. Uses a popup
   * page tab of its own: it doesn't write settings (the options page does),
   * and a download manager tab the extension didn't open itself isn't
   * recognised, so it would open a second one.
   */
  async inExtension(fn, ...args) {
    this.helperTab ??= await this.bidi.openTab(`${this.origin}/popup_page/index.html`);

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

  /** What the extension logged and which pixiv hosts the proxy turned away, for a failure message. */
  diagnostics() {
    const refused = this.pixiv.refused.filter(host => /pixiv\.net|pximg\.net/.test(host));

    return [
      this.consoleErrors.length ? `console errors: ${JSON.stringify(this.consoleErrors)}` : '',
      refused.length ? `refused pixiv hosts: ${JSON.stringify(refused)}` : ''
    ].filter(Boolean).join('; ');
  }

  /**
   * Wait until `count` downloads have finished and return the saved files,
   * relative to the download folder, oldest first. Fails at once on an
   * interrupted download, and if more than `count` turn up.
   * @returns {Promise<{ name: string, path: string, mime: string }[]>}
   */
  async savedFiles(count) {
    const search = () => this.inExtension(() => browser.downloads.search({})
      .then(items => items.map(({ id, filename, mime, state, error }) => ({ id, filename, mime, state, error }))));
    let items;

    await poll(async () => {
      items = await search();

      return items.some(item => item.state === 'interrupted') ||
        (items.length >= count && items.every(item => item.state !== 'in_progress'));
    }, () => `${count} completed downloads; got ${JSON.stringify(items)}; ${this.diagnostics()}`);

    // A stray extra download would otherwise pass if it came a moment later.
    await sleep(1000);
    items = await search();

    if (items.length !== count || items.some(item => item.state !== 'complete')) {
      throw new Error(`Expected ${count} completed downloads; got ${JSON.stringify(items)}; ${this.diagnostics()}`);
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
    await this.resources.close();
  }
}
