'use strict'

const baseConfig = require('./webpack.base.config')();
const utils = require('./utils');
const { merge } = require('webpack-merge');
const vueLoaderConfig = require('./vue-loader.config');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const VueLoaderPlugin = require('vue-loader/lib/plugin');

const isProduction = process.env.NODE_ENV === 'production' ?
  !0 : !!0;

module.exports = env => {
  let platform = env ? (env.platform || 'chrome') : 'chrome';

  return merge(baseConfig, {
    entry: {
      app: './src/content_scripts/main.js',
    },
    output: {
      path: utils.resolve(`dist/${platform}/content_scripts`),
      filename: '[name].js',
      publicPath: './'
    },
    module: {
      rules: [
        {
          test: /\.vue$/,
          loader: 'vue-loader',
          options: vueLoaderConfig
        },
        ...utils.assetRules(),
        ...utils.styleLoaders({
          sourceMap: !isProduction,
          extract: true,
          usePostCSS: true
        })
      ]
    },
    plugins: [
      new BundleAnalyzerPlugin({
        analyzerMode: isProduction && (env && env.analyzer) ? 'static' : 'disabled',
        reportFilename: '../bundleAnalyzer/content-script.html'
      }),

      // extract css into its own file
      new MiniCssExtractPlugin({
        filename: utils.assetsPath('css/[name].css'),
      }),

      new VueLoaderPlugin()
    ],
    externals: {
      EpubMaker: 'EpubMaker',
      browser: 'browser'
    }
  });
}
