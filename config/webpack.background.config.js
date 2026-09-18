'use strict'

const packageInfo = require('../package.json');
const baseConfig = require('./webpack.base.config')();
const utils = require('./utils');
const { merge } = require('webpack-merge');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

/**
 * Unlike webpack 4, webpack 5 runs its minimizer over *every* emitted asset,
 * including the ones copy-webpack-plugin passes through. That re-minified the
 * vendored libraries under src/statics/lib (and inflated the already-minified
 * ones, since terser cannot re-compress its own output well), while hoisting
 * their license banners out into separate .LICENSE.txt files.
 *
 * Marking the copied assets as already minimized makes terser skip them, so
 * third-party code ships byte-for-byte as vendored, attribution intact.
 */
const alreadyMinimized = { minimized: true };

module.exports = env => {
  let platform = env ? (env.platform || 'chrome') : 'chrome';
  let isProduction = process.env.NODE_ENV === 'production';

  console.log(`current target platform: ${platform}`);

  return merge(baseConfig, {
    entry: {
      // background: './src/background/main.js'
      background: './src/background/Bootstrap.js'
    },
    output: {
      path: utils.resolve(`dist/${platform}/background`),
      filename: '[name].js'
    },
    plugins: [
      new BundleAnalyzerPlugin({
        analyzerMode: isProduction && (env && env.analyzer) ? 'static' : 'disabled',
        reportFilename: '../bundleAnalyzer/background.html'
      }),

      /**
       * PouchDB is external (see webpack.base.config.js) and expected to be a
       * global, but a MV3 service worker doesn't run any HTML page that could
       * <script>-load lib/pouchdb.min.js first. On Chrome, load it via
       * importScripts() before the bundle's own module code runs (which reads
       * the global as soon as anything requires 'pouchdb'). Guarded because
       * Firefox runs this same file as an event page, not a worker, where
       * importScripts doesn't exist — Firefox instead gets pouchdb.min.js
       * prepended to manifest background.scripts below.
       */
      new webpack.BannerPlugin({
        banner: `if (typeof importScripts === 'function') { importScripts('../lib/pouchdb.min.js', '../lib/pouchdb.find.min.js'); }`,
        raw: true,
        entryOnly: true
      }),

      new CopyPlugin({
        patterns: [
          {
            from: utils.resolve('src/statics'),
            to: utils.resolve(`dist/${platform}/`),
            globOptions: {
              ignore: [
                '**/manifest.json',
                '**/remote/**/*'
              ]
            },
            info: alreadyMinimized
          }, {
            from: utils.resolve('node_modules/vue/dist/vue.global.prod.js'),
            to: utils.resolve(`dist/${platform}/lib/vue.global.prod.js`),
            info: alreadyMinimized
          }, {
            from: utils.resolve('node_modules/vue-i18n/dist/vue-i18n.global.prod.js'),
            to: utils.resolve(`dist/${platform}/lib/vue-i18n.global.prod.js`),
            info: alreadyMinimized
          }, {
            from: utils.resolve('node_modules/pouchdb/dist/pouchdb.min.js'),
            to: utils.resolve(`dist/${platform}/lib/pouchdb.min.js`),
            info: alreadyMinimized
          }, {
            from: utils.resolve('node_modules/pouchdb/dist/pouchdb.find.min.js'),
            to: utils.resolve(`dist/${platform}/lib/pouchdb.find.min.js`),
            info: alreadyMinimized
          }, {
            from: utils.resolve('node_modules/@ffmpeg/core/dist'),
            to: utils.resolve(`dist/${platform}/lib/ffmpeg`),
            info: alreadyMinimized
          }, {
            from: utils.resolve('src/statics/manifest.json'),
            to: utils.resolve(`dist/${platform}/manifest.json`),
            transform(content, path) {
              let json = JSON.parse(content.toString());

              json.version_name = json.version = packageInfo.version;

              /**
               * About manifest file, there are some differences between FireFox and browsers which based Chromium.
               * So we need do some extra works to make the target browser manifest file.
               */
              if (platform === 'firefox') {
                /**
                 * Firefox implements the manifest v3 background as an event page,
                 * it doesn't support `background.service_worker`. Convert it to
                 * `background.scripts` so the extension can be loaded on Firefox.
                 *
                 * PouchDB is external (see webpack.base.config.js) and expected
                 * to be a global. An event page loads `scripts` as ordinary
                 * <script> tags in order, so list the PouchDB libs ahead of the
                 * bundle here rather than relying on the importScripts() banner
                 * above, which only runs on a real (Chrome) service worker.
                 */
                if (json.background && json.background.service_worker) {
                  json.background = {
                    scripts: [
                      'lib/pouchdb.min.js',
                      'lib/pouchdb.find.min.js',
                      json.background.service_worker
                    ]
                  };
                }

                /**
                 * Firefox requires an explicit add-on id to install a build
                 * permanently or to sign it through AMO. This fork uses its own
                 * id so its signed builds stay distinct from the upstream add-on.
                 *
                 * `update_url` points Firefox at a self-hosted update manifest
                 * (published as a GitHub Release asset on this fork, see
                 * scripts/release.js) so a signed-but-unlisted build can still
                 * auto-update instead of requiring a manual reinstall per release.
                 */
                json.browser_specific_settings = {
                  gecko: {
                    id: 'webextension-pixiv-toolkit-fork@robrich82',
                    update_url: 'https://github.com/robrich82/webextension-pixiv-toolkit/releases/latest/download/updates.json'
                  }
                };
              }

              if (json.options_page && platform === 'firefox') {
                console.log(`rename options_page to options_ui`);

                json.options_ui = {};
                json.options_ui.page = json.options_page;
                json.options_ui.open_in_tab = true;

                json.optional_permissions && json.optional_permissions.forEach(permission => {
                  if (permission === 'downloads.shelf') {
                    return;
                  }

                  json.permissions.push(permission);
                });

                delete json.optional_permissions;
                delete json.options_page;

                console.log(`remove version_name property from manifest`);
                delete json.version_name;
              }

              return JSON.stringify(json);
            }
          }
        ]
      })
    ],
    externals: {
      browser: 'browser',
      chrome: 'chrome',
      FFmpeg: 'FFmpeg'
    }
  });
};
