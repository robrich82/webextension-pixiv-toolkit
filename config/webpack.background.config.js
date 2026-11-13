'use strict'

const packageInfo = require('../package.json');
const baseConfig = require('./webpack.base.config')();
const utils = require('./utils');
const { localFFmpegCore } = require('../scripts/localFFmpegCore.mjs');
const { transformManifest } = require('../scripts/manifest.mjs');
const { merge } = require('webpack-merge');
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
            /**
             * @ffmpeg/core 0.12 ships both an esm/ and a umd/ build of the
             * same ~32MB core+wasm pair. Only umd/ is used (the
             * ffmpeg.js loads it via importScripts in a classic worker), so
             * copying the whole dist/ directory would double the shipped
             * wasm for no reason.
             */
            from: utils.resolve('node_modules/@ffmpeg/core/dist/umd'),
            to: utils.resolve(`dist/${platform}/lib/ffmpeg`),
            info: alreadyMinimized
          }, {
            // Source maps are skipped: their sourcesContent repeats the CDN URL.
            from: utils.resolve('node_modules/@ffmpeg/ffmpeg/dist/umd'),
            to: utils.resolve(`dist/${platform}/lib/ffmpeg`),
            globOptions: { ignore: ['**/*.map'] },
            transform: localFFmpegCore,
            info: alreadyMinimized
          }, {
            from: utils.resolve('src/statics/manifest.json'),
            to: utils.resolve(`dist/${platform}/manifest.json`),
            transform(content) {
              const json = transformManifest(JSON.parse(content.toString()), { platform, version: packageInfo.version });
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
