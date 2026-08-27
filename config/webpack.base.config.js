const utils = require('./utils');
const webpack = require('webpack');

module.exports = env => {
  let config = Object.assign({}, {
    mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    // webpack 5 would otherwise infer the target from the `browserslist` field
    // in package.json. Pin it to `web` so the emitted runtime stays the same
    // shape it had under webpack 4 in every bundle, including the background
    // service worker.
    target: 'web',
    output: {
      filename: '[name].js',
    },
    resolve: {
      extensions: ['.js', '.json', '.vue'],
      alias: {
        '@': utils.resolve('src'),
        '@@': utils.resolve('src/options_page')
      },
      // webpack 5 no longer auto-polyfills node core modules. Nothing in src
      // needs them, so resolve them to nothing rather than pulling in shims.
      fallback: {
        child_process: false,
        dgram: false,
        fs: false,
        net: false,
        tls: false
      }
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          loader: 'babel-loader',
          include: [utils.resolve('src')]
        }, {
          test: /\.worker\.js$/,
          loader: 'worker-loader',
          options: {
            inline: "no-fallback"
          }
        }
      ]
    },
    plugins: [
      new webpack.DefinePlugin({
        PRESET_BROWSER: JSON.stringify(process.env.PLATFORM_ENV)
      })
    ],
    externals: {
      vue: 'Vue',
      'vue-i18n': 'VueI18n',
      pouchdb: 'PouchDB',
      'pouchdb-find': 'PouchDBFind',
      locales: 'locales',
    },
    node: {
      // prevent webpack from injecting eval / new Function through global polyfill
      global: false
    },
    // The bundles are extension pages, not pages served over a network. The
    // default 244 KiB budget is meaningless here and only produces noise.
    performance: {
      hints: false
    }
  });

  let _config;

  if (process.env.NODE_ENV === 'production') {
    _config = Object.assign({}, config);
  } else {
    _config = Object.assign({}, config, {
      devtool: 'inline-source-map'
    });
  }

  return _config;
}
