'use strict'
const path = require('path')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')

exports.resolve = function (dir, subdir) {
  return path.join(__dirname, '..', dir, subdir ? subdir : '.')
}

exports.assetsPath = function (_path) {
  const assetsSubDirectory = 'static';

  return path.posix.join(assetsSubDirectory, _path)
}

exports.cssLoaders = function (options) {
  options = options || {}

  // generate loader string to be used with extract text plugin
  function generateLoaders (loader, loaderOptions) {
    // css-loader needs to know how many loaders run before it so that `@import`
    // inside a stylesheet is passed back through postcss (and sass, when there
    // is a preprocessor in the chain) instead of being inlined verbatim.
    const preLoaderCount = (options.usePostCSS ? 1 : 0) + (loader ? 1 : 0)

    const loaders = [{
      loader: 'css-loader',
      options: {
        sourceMap: options.sourceMap,
        importLoaders: preLoaderCount
      }
    }]

    if (options.usePostCSS) {
      loaders.push({
        loader: 'postcss-loader',
        options: {
          sourceMap: options.sourceMap
        }
      })
    }

    if (loader) {
      loaders.push({
        loader: loader + '-loader',
        options: Object.assign({}, loaderOptions, {
          sourceMap: options.sourceMap
        })
      })
    }

    // Extract CSS when that option is specified
    // (which is the case during production build)
    if (options.extract) {
      return [MiniCssExtractPlugin.loader].concat(loaders)
    } else {
      return ['vue-style-loader'].concat(loaders)
    }
  }

  return {
    css: generateLoaders(),
    postcss: generateLoaders(),
    // sass-loader 8+ takes preprocessor options under `sassOptions` rather than
    // at the top level.
    sass: generateLoaders('sass', { sassOptions: { indentedSyntax: true } }),
    scss: generateLoaders('sass')
  }
}

/**
 * Replaces the url-loader rules the page bundles used to share. webpack 5 has
 * asset modules built in: `asset` inlines below `maxSize` and emits a file
 * above it, which is what `url-loader` with `limit` did.
 *
 * Note `[ext]` already includes the leading dot, unlike url-loader's `[ext]`.
 */
exports.assetRules = function () {
  const inlineBelow = 10000

  const rule = (test, dir) => ({
    test,
    type: 'asset',
    parser: {
      dataUrlCondition: { maxSize: inlineBelow }
    },
    generator: {
      filename: exports.assetsPath(`${dir}/[name].[hash:7][ext]`)
    }
  })

  return [
    rule(/\.(png|jpe?g|gif|svg)(\?.*)?$/, 'img'),
    rule(/\.(mp4|webm|ogg|mp3|wav|flac|aac)(\?.*)?$/, 'media'),
    rule(/\.(woff2?|eot|ttf|otf)(\?.*)?$/, 'fonts')
  ]
}

// Generate loaders for standalone style files (outside of .vue)
exports.styleLoaders = function (options) {
  const output = []
  const loaders = exports.cssLoaders(options)

  for (const extension in loaders) {
    const loader = loaders[extension]
    output.push({
      test: new RegExp('\\.' + extension + '$'),
      use: loader
    })
  }

  return output
}
