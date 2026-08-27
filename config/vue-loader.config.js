'use strict'

/**
 * vue-loader v15 resolves the loaders for a SFC's <style> block from the
 * top-level module rules (see utils.styleLoaders), so the v14-era `loaders`,
 * `cssSourceMap` and `cacheBusting` options that used to live here are gone.
 * `transformToRequire` is the v14 name for `transformAssetUrls`.
 */
module.exports = {
  transformAssetUrls: {
    video: ['src', 'poster'],
    source: 'src',
    img: 'src',
    image: 'xlink:href'
  }
}
