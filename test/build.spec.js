/**
 * Runs scripts/build.mjs for real, once per platform, into a temp directory
 * and checks the output's shape. The E2E suites load the same build in a browser.
 */
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import vm from 'vm';
import { assertSafeOutDir, buildTarget, emptyDir } from '../scripts/build.mjs';
import { browserFloors } from '../scripts/manifest.mjs';
import { compatReports, newerApiUses } from './helpers/bundleApiFloor';

const run = promisify(execFile);
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/build.mjs');
const { version, browserslist } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const floors = browserFloors(browserslist);

let tmp;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptk-build-'));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
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

// Uses behind a feature check, which are fine below the floor.
const GUARDED = [
  // Dexie copies Promise.withResolvers only when it exists.
  /(?<![\w$])([\w$]+)\.withResolvers&&\([\w$]+\.withResolvers=\1\.withResolvers\)/g
];
const GUARDED_COMPAT = [/^lib\/dexie\/dexie\.js:\d+ navigator\.userAgentData\(\) /];
// Uses that degrade on the floor, accepted for now. Per file, so a new use elsewhere still fails.
const ACCEPTED = {
  chrome: [],
  // Vuetify: rules Firefox 115 drops, and a focusable-elements selector it rejects (#354).
  firefox: [
    /^options_page\/static\/router-[\w-]+\.css: css\.at-rules\.property /,
    /^options_page\/static\/router-[\w-]+\.css: css\.selectors\.has /,
    /^options_page\/static\/router-[\w-]+\.css: css\.types\.length\.lh /,
    /^options_page\/static\/router-[\w-]+\.js: css\.selectors\.has /
  ]
};

const read = (out, file) => fs.readFileSync(path.join(out, file), 'utf8');

function fakePreviousBuild(dir) {
  fs.mkdirSync(path.join(dir, 'background'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ptk-build'), '');
}

describe.each(['chrome', 'firefox'])('build for %s', platform => {
  let out;
  let manifest;

  beforeAll(async () => {
    out = path.join(tmp, platform);
    // An earlier build with a file the new one doesn't emit, which should go.
    fakePreviousBuild(out);
    fs.writeFileSync(path.join(out, 'background/stale.js'), '');

    await run(process.execPath, [SCRIPT, `--platform=${platform}`, `--out-dir=${out}`], { cwd: ROOT });
    manifest = JSON.parse(read(out, 'manifest.json'));
  }, 120000);

  it('writes the transformed manifest', () => {
    expect(manifest.version).toBe(version);

    if (platform === 'firefox') {
      expect(manifest.background).toEqual({ scripts: ['background/background.js'] });
      expect(manifest.options_ui.page).toBe('options_page/index.html');
      expect(manifest.browser_specific_settings.gecko.strict_min_version).toBe(`${floors.firefox}.0`);
    } else {
      expect(manifest.background).toEqual({ service_worker: 'background/background.js' });
      expect(manifest.version_name).toBe(version);
      expect(manifest.minimum_chrome_version).toBe(floors.chrome);
    }
  });

  it('empties the output directory first', () => {
    expect(fs.existsSync(path.join(out, 'background/stale.js'))).toBe(false);
  });

  it('marks the output as a build, so a later build may empty it', () => {
    expect(fs.statSync(path.join(out, '.ptk-build')).isFile()).toBe(true);
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

  it('sets PRESET_BROWSER to the platform', () => {
    // src/core/global.js sets window.$_browser from it.
    const expected = platform === 'firefox' ? 'firefox' : 'default';

    expect(read(out, 'content_scripts/app.js')).toMatch(new RegExp(`\\$_browser\\s*=\\s*["'\`]${expected}["'\`]`));
  });

  it('reads Vue, vue-i18n and the locales from the globals lib/ provides', () => {
    const content = read(out, 'content_scripts/app.js');

    for (const name of ['Vue', 'VueI18n', 'locales']) {
      expect(content).toMatch(new RegExp(`globalThis\\.${name}\\b`));
    }
  });

  it('reads Dexie from its global only in the options pages', () => {
    const options = fs.readdirSync(path.join(out, 'options_page/static'))
      .filter(f => f.endsWith('.js'))
      .map(f => read(out, `options_page/static/${f}`))
      .join('\n');

    expect(options).toMatch(/globalThis\.Dexie\b/);
    expect(read(out, 'background/background.js')).not.toMatch(/globalThis\.(Dexie|Vue|VueI18n|locales)\b/);
  });

  it('compiles the Vue components for production, whatever NODE_ENV the build inherits', () => {
    // The build inherits Vitest's NODE_ENV=test. A dev build embeds each
    // component's absolute source path as `__file`.
    expect(read(out, 'content_scripts/app.js')).not.toContain('__file');
  });

  it("keeps bundled dependencies' license comments", () => {
    expect(read(out, 'background/background.js')).toMatch(/^\/\/!|\/\*!/m);
  });

  it('exposes the locale messages as the `locales` global', () => {
    const context = vm.createContext({});

    vm.runInContext(read(out, 'lib/locales.js'), context);

    expect(Object.keys(context.locales)).toEqual(['localeEn', 'localeZhCN']);
    expect(context.locales.localeEn.extName.message).toEqual(expect.any(String));
  });

  it('ships the umd FFmpeg build without source maps, pointed at the packaged core', () => {
    const files = fs.readdirSync(path.join(out, 'lib/ffmpeg'));
    // The worker chunk, not ffmpeg.js, is the file that names the core.
    const ffmpeg = files.filter(f => f.endsWith('.js')).map(f => read(out, `lib/ffmpeg/${f}`)).join('\n');

    expect(files).toEqual(expect.arrayContaining(['ffmpeg.js', 'ffmpeg-core.js', 'ffmpeg-core.wasm']));
    expect(files.filter(f => f.endsWith('.map'))).toEqual([]);
    expect(ffmpeg).not.toContain('unpkg.com');
    expect(ffmpeg).toContain('"ffmpeg-core.js"');
  });

  it('leaves src/statics/remote out of the package', () => {
    expect(fs.existsSync(path.join(out, 'remote'))).toBe(false);
  });

  // The E2E suites run current browsers, so they can't catch this (#347).
  it('uses no listed JS or CSS API newer than the browserslist floor', () => {
    const found = newerApiUses(out, { browser: platform, floor: floors[platform], guarded: GUARDED });

    expect(found.filter(use => !ACCEPTED[platform].some(pattern => pattern.test(use)))).toEqual([]);
    // An entry that matches nothing would quietly accept a later use.
    expect(ACCEPTED[platform].filter(pattern => !found.some(use => pattern.test(use)))).toEqual([]);
  });

  it('calls no web API or builtin that eslint-plugin-compat finds newer than the floor', async () => {
    const reports = await compatReports(out, { browser: platform, floor: floors[platform] });

    expect(reports.filter(report => !GUARDED_COMPAT.some(pattern => pattern.test(report)))).toEqual([]);
  }, 60000);
});

it('rejects an unknown platform', async () => {
  await expect(run(process.execPath, [SCRIPT, '--platform=safari'], { cwd: ROOT }))
    .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Unknown --platform=safari') });
}, 30000);

it('leaves an unrelated --out-dir untouched and fails', async () => {
  const dir = path.join(tmp, 'unrelated');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'keep.txt'), '');

  await expect(run(process.execPath, [SCRIPT, `--out-dir=${dir}`], { cwd: ROOT }))
    .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Refusing to build into') });
  expect(fs.existsSync(path.join(dir, 'keep.txt'))).toBe(true);
}, 30000);

it('reads flags after the `--` that `pnpm run <script> -- <flags>` appends', async () => {
  const dir = path.join(tmp, 'after-dashdash');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'keep.txt'), '');

  // pnpm puts the `--` after the script's own --platform. The refusal shows --out-dir was read.
  await expect(run(process.execPath, [SCRIPT, '--platform=firefox', '--', `--out-dir=${dir}`], { cwd: ROOT }))
    .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining(`Refusing to build into ${dir}`) });
}, 30000);

describe('buildTarget', () => {
  it("targets the browserslist floors, so Vite lowers syntax to the manifest's minimum versions", () => {
    expect(buildTarget({ chrome: '123', firefox: '456' })).toEqual(['chrome123', 'firefox456']);
  });
});

describe('assertSafeOutDir', () => {
  const refuses = dir => expect(() => assertSafeOutDir(dir)).toThrow(/Refusing to build into/);
  const accepts = dir => expect(() => assertSafeOutDir(dir)).not.toThrow();

  it.each(['.', '..', 'src', 'src/statics/x', 'src/..x', 'test', '.git', 'node_modules'])(
    'refuses %s in the repo, which is outside dist/',
    dir => refuses(path.resolve(ROOT, dir))
  );

  it.each(['dist', 'dist/chrome', 'dist/anything'])('accepts %s', dir => accepts(path.resolve(ROOT, dir)));

  describe('outside the repo', () => {
    let base;

    beforeEach(() => {
      base = fs.mkdtempSync(path.join(tmp, 'guard-'));
    });

    it('accepts a missing or empty directory', () => {
      accepts(path.join(base, 'missing/nested'));
      accepts(base);
    });

    it('accepts a directory holding only files the OS adds', () => {
      for (const file of ['desktop.ini', 'Thumbs.db', '.DS_Store']) fs.writeFileSync(path.join(base, file), '');
      accepts(base);
    });

    it('accepts an earlier build, even one that stopped partway', () => {
      fs.writeFileSync(path.join(base, '.ptk-build'), '');
      accepts(base);
    });

    it('refuses a directory holding anything else', () => {
      fs.writeFileSync(path.join(base, 'notes.txt'), '');
      refuses(base);
    });

    it('refuses an unrelated extension project laid out like a build', () => {
      fs.mkdirSync(path.join(base, '.git'));
      fs.mkdirSync(path.join(base, 'background'));
      fs.writeFileSync(path.join(base, 'manifest.json'), '{}');
      fs.writeFileSync(path.join(base, 'background/background.js'), '');
      refuses(base);
    });

    it('refuses a directory named like a file the OS adds', () => {
      fs.mkdirSync(path.join(base, 'desktop.ini'));
      fs.writeFileSync(path.join(base, 'desktop.ini/notes.txt'), '');
      refuses(base);
    });

    it('refuses a directory where the build marker is a directory', () => {
      fs.mkdirSync(path.join(base, '.ptk-build'));
      refuses(base);
    });

    it('refuses a file', () => {
      const file = path.join(base, 'file');
      fs.writeFileSync(file, '');
      refuses(file);
    });

    it('refuses a link into the sources', () => {
      const link = path.join(base, 'link');
      fs.symlinkSync(path.join(ROOT, 'src'), link, 'junction');

      refuses(link);
      refuses(path.join(link, 'statics/x'));
    });
  });

  it.each(['src', '.'])('refuses the sources when dist/ is a link to %s', linkTo => {
    const repo = fs.mkdtempSync(path.join(tmp, 'repo-'));
    fs.mkdirSync(path.join(repo, 'src'));
    fs.writeFileSync(path.join(repo, 'src/keep.js'), '');
    fs.symlinkSync(path.join(repo, linkTo), path.join(repo, 'dist'), 'junction');

    for (const dir of ['src', 'src/new', 'dist/new']) {
      expect(() => assertSafeOutDir(path.join(repo, dir), repo)).toThrow(/Refusing to build into/);
    }
  });

  // realpath keeps a UNC path as UNC, so only the directory's identity shows it is the repo.
  const unc = process.platform === 'win32' && /^[A-Za-z]:\\/.test(ROOT)
    ? `\\\\localhost\\${ROOT[0]}$${ROOT.slice(2)}`
    : null;

  it.skipIf(!unc || !fs.existsSync(unc))('refuses a UNC spelling of a repo directory outside dist/', () => {
    refuses(path.join(unc, 'src/new'));
    refuses(unc);
  });
});

describe('emptyDir', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the build marker when a delete fails, so the next build may retry', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'locked-'));
    fakePreviousBuild(dir);
    fs.writeFileSync(path.join(dir, 'locked.js'), '');
    // As when Windows holds a file open. Every other delete goes through.
    const rmSync = fs.rmSync;
    vi.spyOn(fs, 'rmSync').mockImplementation((p, options) => {
      if (path.basename(p) === 'locked.js') throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      rmSync(p, options);
    });

    expect(() => emptyDir(dir)).toThrow('EPERM');
    expect(() => assertSafeOutDir(dir)).not.toThrow();
  });

  it('replaces a marker that is a link instead of writing through it', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'linked-marker-'));
    const victim = path.join(tmp, `victim-${path.basename(dir)}.txt`);
    fs.writeFileSync(victim, 'keep');
    // A hard link needs no privilege on Windows, unlike a file symlink.
    fs.linkSync(victim, path.join(dir, '.ptk-build'));

    emptyDir(dir);

    expect(fs.readFileSync(victim, 'utf8')).toBe('keep');
    expect(fs.statSync(path.join(dir, '.ptk-build')).isFile()).toBe(true);
  });
});
