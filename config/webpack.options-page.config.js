'use strict'

const baseConfig = require('./webpack.base.config')();
const utils = require('./utils');
const HtmlWebpackPlugin = require('html-webpack-plugin');
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
      index: './src/options_page/index.js',
      downloads: './src/options_page/downloads.js'
    },
    output: {
      path: utils.resolve(`dist/${platform}/options_page`),
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
        reportFilename: '../bundleAnalyzer/options-page.html'
      }),

      // extract css into its own file
      new MiniCssExtractPlugin({
        filename: utils.assetsPath('css/[name].css')
      }),

      // generate dist index.html with correct asset hash for caching.
      // you can customize output by editing /index.html
      // see https://github.com/ampedandwired/html-webpack-plugin
      new HtmlWebpackPlugin({
        filename: utils.resolve(`dist/${platform}/options_page/index.html`),
        template: utils.resolve('src/options_page/index.html'),
        minify: {
          removeComments: true,
          collapseWhitespace: true,
          removeAttributeQuotes: true
          // more options:
          // https://github.com/kangax/html-minifier#options-quick-reference
        },
        chunks: ['index'],
        chunksSortMode: 'auto'
      }),

      new HtmlWebpackPlugin({
        filename: utils.resolve(`dist/${platform}/options_page/downloads.html`),
        template: utils.resolve(`src/options_page/downloads.html`),
        minify: {
          removeComments: true,
          collapseWhitespace: true,
          removeAttributeQuotes: true
        },
        chunks: ['downloads'],
        chunksSortMode: 'auto'
      }),

      new VueLoaderPlugin()
    ],
    externals: {
      common: 'common',
      browser: 'browser',
      chrome: 'chrome',
      dexie: 'Dexie'
    }
  });
};
