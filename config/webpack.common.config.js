'use strict'

const baseConfig = require('./webpack.base.config')();
const utils = require('./utils');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

const isProduction = process.env.NODE_ENV === 'production' ?
  !0 : !!0;

module.exports = env => {
  let platform = env ? (env.platform || 'chrome') : 'chrome';

  return Object.assign({}, baseConfig, {
    entry: {
      locales: utils.resolve('src/modules/Locales.js'),
    },
    output: {
      path: utils.resolve(`dist/${platform}/lib`),
      filename: '[name].js',
      library: {
        name: '[name]',
        type: 'umd'
      }
    },
    // This bundle is only the two locale JSON files re-exported as a UMD
    // global. webpack 5 parses both JSON and ESM natively, so it needs no
    // loaders at all -- json-loader is gone and babel was never applied here.
    module: {
      rules: []
    },
    plugins: [
      new BundleAnalyzerPlugin({
        analyzerMode: isProduction && (env && env.analyzer) ? 'static' : 'disabled',
        reportFilename: '../bundleAnalyzer/common.html'
      }),
    ]
  });
};
