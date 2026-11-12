#!/usr/bin/env node
/**
 * Builds the extension into dist/<platform>/ with one vite.build() per target.
 *
 *   node scripts/build.mjs [--platform=chrome|firefox] [--watch] [--out-dir=<dir>]
 *
 * --watch builds unminified with inline source maps and rebuilds on change.
 * Files copied from src/statics are copied once, so restart it after editing them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import vue from '@vitejs/plugin-vue';
import autoprefixer from 'autoprefixer';
import { build, createLogger } from 'vite';
import { localFFmpegCore } from './localFFmpegCore.mjs';
import { transformManifest } from './manifest.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const fromRoot = p => path.join(root, p);

/**
 * Loaded as classic <script>s from lib/ (see the HTML pages and the manifest's
 * content_scripts), so bundles read them from the global instead of bundling
 * a second copy. Dexie is only external in the options pages: the background
 * has no page to load lib/dexie into, so it bundles its own.
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

/**
 * Adds each options page's entry script. Temporary: the HTML templates are
 * still webpack's too, and HtmlWebpackPlugin injects its own script tag.
 */
function injectEntryScript(entries) {
  return {
    name: 'inject-entry-script',
    transformIndexHtml: {
      order: 'pre',
      handler(html, { filename }) {
        const src = entries[path.basename(filename, '.html')];
        return html.replace('</body>', `<script type="module" src="${src}"></script></body>`);
      }
    }
  };
}

/**
 * The pages load lib/ scripts as classic <script>s on purpose, and Vite warns
 * about each one on every build. Drop those warnings; keep the rest.
 */
function quietLogger() {
  const logger = createLogger('warn');
  const warn = logger.warn;
  logger.warn = (msg, options) => {
    if (!/can't be bundled without type="module" attribute/.test(msg)) warn(msg, options);
  };
  return logger;
}

function viteConfig({ platform, dev, watch, globals = SHARED_GLOBALS, plugins = [], root: viteRoot = root, outDir, build: buildOptions }) {
  return {
    configFile: false,
    envDir: false,
    root: viteRoot,
    base: './',
    publicDir: false,
    mode: dev ? 'development' : 'production',
    customLogger: quietLogger(),
    plugins: [globalExternals(globals), vue(), ...plugins],
    define: {
      PRESET_BROWSER: JSON.stringify(platform),
      'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
      // Vue's compile-time flags. Vue itself is the prebuilt global build, but
      // the bundled vue-router and Vuetify read them.
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
    // Inline, so Vite doesn't load .postcssrc.js, which is webpack's.
    css: { postcss: { plugins: [autoprefixer()] } },
    build: {
      outDir,
      emptyOutDir: false,
      target: ['chrome88', 'firefox109'],
      assetsInlineLimit: 10000,
      assetsDir: 'static',
      minify: !dev,
      sourcemap: dev ? 'inline' : false,
      reportCompressedSize: false,
      // Extension pages load from disk, so a download-size budget means nothing.
      chunkSizeWarningLimit: Infinity,
      watch: watch ? {} : null,
      ...buildOptions
    }
  };
}

/**
 * One classic script and at most one stylesheet, `static/css/<name>.css`.
 * With `globalName`, the entry's default export becomes that global.
 */
function iife(entry, fileName, globalName) {
  return {
    cssCodeSplit: false,
    rolldownOptions: {
      input: entry,
      // Vite drops an app entry's exports unless told to keep them.
      ...(globalName && { preserveEntrySignatures: 'strict' }),
      output: {
        format: 'iife',
        name: globalName,
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
      globals: {},
      outDir: path.join(out, 'lib'),
      build: iife(fromRoot('src/modules/Locales.js'), 'locales.js', 'locales')
    },
    {
      globals: {},
      outDir: path.join(out, 'background'),
      build: iife(fromRoot('src/background/Bootstrap.js'), 'background.js')
    },
    {
      outDir: path.join(out, 'content_scripts'),
      build: iife(fromRoot('src/content_scripts/main.js'), 'app.js')
    },
    {
      globals: { ...SHARED_GLOBALS, dexie: 'Dexie' },
      root: fromRoot('src/options_page'),
      outDir: path.join(out, 'options_page'),
      plugins: [injectEntryScript({ index: './index.js', downloads: './downloads.js' })],
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
      root: fromRoot('src/popup_page'),
      outDir: path.join(out, 'popup_page'),
      build: { rolldownOptions: { input: fromRoot('src/popup_page/index.html') } }
    }
  ];
}

function emptyDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
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

  const { version } = JSON.parse(fs.readFileSync(fromRoot('package.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(statics, 'manifest.json'), 'utf8'));
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(transformManifest(manifest, { platform, version })));
}

// In watch mode build() returns as soon as the watcher starts.
function firstBuild(watcher) {
  return new Promise(resolve => {
    const onEvent = event => {
      if (event.code === 'END' || event.code === 'ERROR') {
        watcher.off('event', onEvent);
        resolve();
      }
    };
    watcher.on('event', onEvent);
  });
}

export async function buildExtension({ platform = 'chrome', watch = false, outDir } = {}) {
  const out = path.resolve(outDir || fromRoot(`dist/${platform}`));

  emptyDir(out);
  copyStatics(platform, out);

  for (const target of targets(out)) {
    const result = await build(viteConfig({ platform, dev: watch, watch, ...target }));
    if (watch) await firstBuild(result);
  }

  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
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
  const out = await buildExtension({ platform: values.platform, watch: values.watch, outDir: values['out-dir'] });

  console.log(`Built ${values.platform} into ${path.relative(process.cwd(), out) || '.'} in ${Date.now() - started} ms${values.watch ? '; watching for changes' : ''}.`);
}
