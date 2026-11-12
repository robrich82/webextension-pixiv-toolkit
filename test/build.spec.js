/**
 * Runs scripts/build.mjs for real, once per platform, into a temp directory
 * and checks that what the manifest and pages load exists and has the right
 * shape. The E2E suites (docs/testing.md) cover the build actually running.
 */
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import vm from 'vm';

const run = promisify(execFile);
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/build.mjs');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let tmp;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-build-'));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Every extension-relative path the manifest makes the browser load. */
function manifestPaths(manifest) {
  return [
    ...(manifest.background.scripts || [manifest.background.service_worker]),
    manifest.action.default_popup,
    manifest.action.default_icon,
    manifest.options_page || manifest.options_ui.page,
    ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap(script => [...script.js, ...script.css]),
    ...manifest.web_accessible_resources.flatMap(entry => entry.resources),
    ...manifest.declarative_net_request.rule_resources.map(rule => rule.path),
    `_locales/${manifest.default_locale}/messages.json`
  ];
}

const read = (out, file) => fs.readFileSync(path.join(out, file), 'utf8');

describe.each(['chrome', 'firefox'])('build for %s', platform => {
  let out;
  let manifest;

  beforeAll(async () => {
    out = path.join(tmp, platform);
    await run(process.execPath, [SCRIPT, `--platform=${platform}`, `--out-dir=${out}`], { cwd: ROOT });
    manifest = JSON.parse(read(out, 'manifest.json'));
  }, 120000);

  it('writes the transformed manifest', () => {
    expect(manifest.version).toBe(version);

    if (platform === 'firefox') {
      expect(manifest.background).toEqual({ scripts: ['background/background.js'] });
      expect(manifest.options_ui.page).toBe('options_page/index.html');
    } else {
      expect(manifest.background).toEqual({ service_worker: 'background/background.js' });
      expect(manifest.version_name).toBe(version);
    }
  });

  it('emits every file the manifest references', () => {
    const missing = manifestPaths(manifest).filter(file => !fs.existsSync(path.join(out, file)));

    expect(missing).toEqual([]);
  });

  it.each(['options_page/index.html', 'options_page/downloads.html', 'popup_page/index.html'])(
    '%s loads one module entry, and every local file it references exists',
    page => {
      const html = read(out, page);
      const refs = [...html.matchAll(/\s(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(ref => !/^https?:/.test(ref));
      const missing = refs.filter(ref => !fs.existsSync(path.join(out, path.dirname(page), ref)));

      expect(html.match(/<script type="module"/g)).toHaveLength(1);
      expect(refs.length).toBeGreaterThan(0);
      expect(missing).toEqual([]);
    }
  );

  it.each(['background/background.js', 'content_scripts/app.js', 'lib/locales.js'])(
    '%s is a classic script, not a module',
    file => {
      // An import or export statement is a SyntaxError outside a module.
      expect(() => new vm.Script(read(out, file))).not.toThrow();
    }
  );

  it('defines PRESET_BROWSER', () => {
    expect(read(out, 'content_scripts/app.js')).not.toMatch(/\bPRESET_BROWSER\b/);
  });

  it('reads Vue, vue-i18n and the locales from the globals lib/ provides', () => {
    const content = read(out, 'content_scripts/app.js');

    for (const name of ['Vue', 'VueI18n', 'locales']) {
      expect(content).toContain(`globalThis.${name}`);
    }
  });

  it('exposes the locale messages as the `locales` global', () => {
    const context = vm.createContext({});

    vm.runInContext(read(out, 'lib/locales.js'), context);

    expect(Object.keys(context.locales)).toEqual(['localeEn', 'localeZhCN']);
    expect(context.locales.localeEn.extName.message).toEqual(expect.any(String));
  });

  it('ships the umd FFmpeg build without source maps or the CDN core URL', () => {
    const files = fs.readdirSync(path.join(out, 'lib/ffmpeg'));

    expect(files).toEqual(expect.arrayContaining(['ffmpeg.js', 'ffmpeg-core.js', 'ffmpeg-core.wasm']));
    expect(files.filter(f => f.endsWith('.map'))).toEqual([]);
    expect(read(out, 'lib/ffmpeg/ffmpeg.js')).not.toContain('unpkg.com');
  });

  it('leaves src/statics/remote out of the package', () => {
    expect(fs.existsSync(path.join(out, 'remote'))).toBe(false);
  });
});

it('rejects an unknown platform', async () => {
  await expect(run(process.execPath, [SCRIPT, '--platform=safari'], { cwd: ROOT }))
    .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Unknown --platform=safari') });
});
