#!/usr/bin/env node
/**
 * Builds the extension into dist/<platform>/ with one vite.build() per target.
 *
 *   node scripts/build.mjs [--platform=chrome|firefox] [--watch] [--out-dir=<dir>]
 *
 * --watch builds unminified with inline source maps and rebuilds on change.
 * What copyStatics() writes (src/statics, lib/ vendor files, manifest.json) is
 * written once, so restart it after editing those.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import vue from '@vitejs/plugin-vue';
import autoprefixer from 'autoprefixer';
import { build } from 'vite';
import { localFFmpegCore } from './localFFmpegCore.mjs';
import { browserFloors, transformManifest } from './manifest.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const fromRoot = p => path.join(root, p);
const pkg = JSON.parse(fs.readFileSync(fromRoot('package.json'), 'utf8'));
const floors = browserFloors(pkg.browserslist);

/**
 * The pages and the manifest's content_scripts load these from lib/ as classic
 * <script>s, so bundles read the global instead of bundling a second copy.
 * The background and locales targets have no page to load them into.
 */
const SHARED_GLOBALS = { vue: 'Vue', 'vue-i18n': 'VueI18n', locales: 'locales' };

function globalExternals(globals) {
  const prefix = '\0global-external:';

  return {
    name: 'global-externals',
    enforce: 'pre',
    resolveId(id) {
      if (Object.hasOwn(globals, id)) return prefix + id;
    },
    load(id) {
      // CommonJS, so named imports (`import { createApp } from 'vue'`) read
      // the global's properties without listing them here.
      if (id.startsWith(prefix)) return `module.exports = globalThis.${globals[id.slice(prefix.length)]};`;
    }
  };
}

function viteConfig({ platform, watch, globals = SHARED_GLOBALS, root: viteRoot = root, outDir, build: buildOptions }) {
  const rolldownOptions = buildOptions.rolldownOptions || {};

  return {
    configFile: false,
    envDir: false,
    root: viteRoot,
    base: './',
    publicDir: false,
    mode: watch ? 'development' : 'production',
    logLevel: 'warn',
    plugins: [globalExternals(globals), vue()],
    define: {
      PRESET_BROWSER: JSON.stringify(platform),
      'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production'),
      // Compile-time flags read by bundled dependencies; Vue itself is the global build.
      __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
      // @vuetify/v0 reads this at module load, and there is no `process` here.
      'process.env.VITE_LOGGER_ENABLED': 'undefined'
    },
    resolve: {
      alias: { '@@': fromRoot('src/options_page'), '@': fromRoot('src') },
      extensions: ['.mjs', '.js', '.json', '.vue']
    },
    css: { postcss: { plugins: [autoprefixer()] } },
    build: {
      outDir,
      emptyOutDir: false,
      // From package.json's browserslist, which autoprefixer reads too.
      target: [`chrome${floors.chrome}`, `firefox${floors.firefox}`],
      assetsInlineLimit: 10000,
      assetsDir: 'static',
      minify: !watch,
      sourcemap: watch ? 'inline' : false,
      reportCompressedSize: false,
      // Extension pages load from disk, so a download-size budget means nothing.
      chunkSizeWarningLimit: Infinity,
      watch: watch ? {} : null,
      ...buildOptions,
      rolldownOptions: {
        ...rolldownOptions,
        // Minifying drops bundled dependencies' license banners otherwise.
        output: { ...rolldownOptions.output, comments: { legal: true } }
      }
    }
  };
}

// One classic script and at most one stylesheet, `static/css/<name>.css`.
function iife(entry, fileName) {
  return {
    cssCodeSplit: false,
    rolldownOptions: {
      input: entry,
      output: {
        format: 'iife',
        entryFileNames: fileName,
        assetFileNames: info => info.names.some(n => n.endsWith('.css'))
          ? `static/css/${path.basename(fileName, '.js')}.css`
          : 'static/[name]-[hash][extname]'
      }
    }
  };
}

function targets(out) {
  return [
    {
      name: 'locales',
      globals: {},
      outDir: path.join(out, 'lib'),
      // Library mode, so the entry's default export becomes the `locales` global.
      build: { lib: { entry: fromRoot('src/modules/Locales.js'), formats: ['iife'], name: 'locales', fileName: () => 'locales.js' } }
    },
    {
      name: 'background',
      globals: {},
      outDir: path.join(out, 'background'),
      build: iife(fromRoot('src/background/Bootstrap.js'), 'background.js')
    },
    {
      name: 'content script',
      outDir: path.join(out, 'content_scripts'),
      build: iife(fromRoot('src/content_scripts/main.js'), 'app.js')
    },
    {
      name: 'options pages',
      globals: { ...SHARED_GLOBALS, dexie: 'Dexie' },
      root: fromRoot('src/options_page'),
      outDir: path.join(out, 'options_page'),
      build: {
        rolldownOptions: {
          input: {
            index: fromRoot('src/options_page/index.html'),
            downloads: fromRoot('src/options_page/downloads.html')
          }
        }
      }
    },
    {
      name: 'popup',
      root: fromRoot('src/popup_page'),
      outDir: path.join(out, 'popup_page'),
      build: { rolldownOptions: { input: fromRoot('src/popup_page/index.html') } }
    }
  ];
}

const isWithin = (parent, child) => {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
};

// Follows links in the existing part of the path, so a junction to src/ is seen as src/.
function realPath(p) {
  const missing = [];
  while (!fs.existsSync(p) && path.dirname(p) !== p) {
    missing.unshift(path.basename(p));
    p = path.dirname(p);
  }
  return path.join(fs.realpathSync.native(p), ...missing);
}

// Identifies a directory however it is spelled; realpath keeps a UNC path (\\localhost\C$\…) as UNC.
function dirId(p) {
  const { dev, ino } = fs.statSync(p, { bigint: true });
  return ino ? `${dev}:${ino}` : null;
}

// The ids of p and its ancestors that exist.
const ancestorIds = p => {
  const ids = [];
  for (let dir = p; ; dir = path.dirname(dir)) {
    if (fs.existsSync(dir)) ids.push(dirId(dir));
    if (path.dirname(dir) === dir) return ids.filter(Boolean);
  }
};

// Written before anything is emptied and never removed, so only a directory this script built
// counts as an earlier build, even one that stopped partway.
const BUILD_MARKER = '.ptk-build';
// Files the OS drops into any folder it shows.
const OS_FILES = new Set(['desktop.ini', 'Thumbs.db', '.DS_Store']);

const isEmpty = dir => fs.readdirSync(dir, { withFileTypes: true }).every(e => e.isFile() && OS_FILES.has(e.name));
const isPreviousBuild = dir => fs.lstatSync(path.join(dir, BUILD_MARKER), { throwIfNoEntry: false })?.isFile();
const isDisposable = dir => !fs.existsSync(dir) || (fs.statSync(dir).isDirectory() && (isEmpty(dir) || isPreviousBuild(dir)));

export class UnsafeOutDirError extends Error {}

/**
 * The output directory is emptied first. Inside the repo only dist/ qualifies;
 * elsewhere only a missing or empty directory, or an earlier build.
 */
export function assertSafeOutDir(out, repoRoot = root) {
  const target = realPath(out);
  const repo = fs.realpathSync.native(repoRoot);
  const dist = path.join(repo, 'dist');
  const targetIds = ancestorIds(target);
  const has = (ids, dir) => fs.existsSync(dir) && ids.includes(dirId(dir));
  // A dist/ link's id is whatever it points at, src/ or the repo itself.
  const distIsLink = fs.lstatSync(dist, { throwIfNoEntry: false })?.isSymbolicLink();

  const inRepo = isWithin(repo, target) || has(targetIds, repo);
  const holdsRepo = isWithin(target, repo) || has(ancestorIds(repo), target);
  const safe = inRepo
    ? isWithin(dist, target) || (!distIsLink && has(targetIds, dist))
    : !holdsRepo && isDisposable(target);

  if (!safe) {
    throw new UnsafeOutDirError(`Refusing to build into ${out}: it is emptied first. Use dist/, or an empty directory or earlier build outside the repo.`);
  }
}

// Exported for its spec: a failed delete must leave the marker, so the next build can retry.
export function emptyDir(dir) {
  const marker = path.join(dir, BUILD_MARKER);
  fs.mkdirSync(dir, { recursive: true });
  // Replaced, not rewritten, so a link planted there doesn't truncate what it points at.
  fs.rmSync(marker, { force: true });
  fs.writeFileSync(marker, '');
  for (const entry of fs.readdirSync(dir)) {
    if (entry !== BUILD_MARKER) fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

function copyStatics(platform, out) {
  const statics = fromRoot('src/statics');

  fs.cpSync(statics, out, {
    recursive: true,
    // manifest.json is written below; remote/ is linked from GitHub, not packaged.
    filter: src => {
      const rel = path.relative(statics, src);
      return rel !== 'manifest.json' && rel.split(path.sep)[0] !== 'remote';
    }
  });

  fs.copyFileSync(fromRoot('node_modules/vue/dist/vue.global.prod.js'), path.join(out, 'lib/vue.global.prod.js'));
  fs.copyFileSync(fromRoot('node_modules/vue-i18n/dist/vue-i18n.global.prod.js'), path.join(out, 'lib/vue-i18n.global.prod.js'));

  /**
   * @ffmpeg/core also ships an esm/ build of the same ~32MB core+wasm pair.
   * Only umd/ is loaded (importScripts in a classic worker), so copy only that.
   */
  const ffmpegOut = path.join(out, 'lib/ffmpeg');
  fs.cpSync(fromRoot('node_modules/@ffmpeg/core/dist/umd'), ffmpegOut, { recursive: true });

  // Source maps are skipped: their sourcesContent repeats the CDN URL.
  const ffmpegDir = fromRoot('node_modules/@ffmpeg/ffmpeg/dist/umd');
  for (const file of fs.readdirSync(ffmpegDir).filter(f => f.endsWith('.js'))) {
    fs.writeFileSync(path.join(ffmpegOut, file), localFFmpegCore(fs.readFileSync(path.join(ffmpegDir, file))));
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(statics, 'manifest.json'), 'utf8'));
  const json = transformManifest(manifest, { platform, version: pkg.version, floors });
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(json));
}

// In watch mode build() returns as soon as the watcher starts. Resolves false if the first build failed.
function firstBuild(watcher) {
  return new Promise(resolve => {
    const onEvent = event => {
      if (event.code === 'END' || event.code === 'ERROR') {
        watcher.off('event', onEvent);
        resolve(event.code === 'END');
      }
    };
    watcher.on('event', onEvent);
  });
}

/** Returns the output directory and, in watch mode, the targets whose first build failed. */
export async function buildExtension({ platform = 'chrome', watch = false, outDir } = {}) {
  const out = path.resolve(outDir || fromRoot(`dist/${platform}`));
  const failed = [];

  assertSafeOutDir(out);

  // Vite and @vitejs/plugin-vue decide dev or production from NODE_ENV, not `mode`,
  // so an inherited value (Vitest sets `test`) would change the build. This sets it
  // for the whole calling process.
  process.env.NODE_ENV = watch ? 'development' : 'production';

  emptyDir(out);
  copyStatics(platform, out);

  for (const { name, ...target } of targets(out)) {
    const result = await build(viteConfig({ platform, watch, ...target }));
    if (watch && !(await firstBuild(result))) failed.push(name);
  }

  return { out, failed };
}

if (import.meta.main) {
  // `pnpm run build:firefox -- --flag` passes the `--` through, after the script's own args.
  const args = process.argv.slice(2);
  if (args.includes('--')) args.splice(args.indexOf('--'), 1);

  const { values } = parseArgs({
    args,
    options: {
      platform: { type: 'string', default: 'chrome' },
      watch: { type: 'boolean', default: false },
      'out-dir': { type: 'string' }
    }
  });

  if (!['chrome', 'firefox'].includes(values.platform)) {
    console.error(`Unknown --platform=${values.platform}; expected chrome or firefox.`);
    process.exit(1);
  }

  const started = Date.now();
  let result;

  try {
    result = await buildExtension({ platform: values.platform, watch: values.watch, outDir: values['out-dir'] });
  } catch (error) {
    // A bundler error's message already names the file and shows the code; its stack is the bundler's.
    const expected = error instanceof UnsafeOutDirError || error.errors || error.plugin || error.loc;
    console.error(expected ? error.message : error);
    process.exit(1);
  }

  const into = path.relative(process.cwd(), result.out) || '.';

  if (result.failed.length) {
    console.error(`First build failed for: ${result.failed.join(', ')}. Watching for changes.`);
  } else {
    console.log(`Built ${values.platform} into ${into} in ${Date.now() - started} ms${values.watch ? '; watching for changes' : ''}.`);
  }
}
