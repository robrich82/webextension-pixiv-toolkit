'use strict'

/**
 * vue-loader (v15 through v17) resolves the loaders for a SFC's <style> block
 * from the top-level module rules (see utils.styleLoaders), so the v14-era
 * `loaders`, `cssSourceMap` and `cacheBusting` options that used to live here
 * are gone. `transformToRequire` is the v14 name for `transformAssetUrls`.
 *
 * This mirrors @vue/compiler-sfc's own default `transformAssetUrls` map (it's
 * spelled out rather than omitted so it's one place to extend, not because it
 * differs) -- `image`/`use` need both `xlink:href` and the plain `href`
 * fallback, which a partial override would otherwise silently drop.
 */
module.exports = {
  transformAssetUrls: {
    video: ['src', 'poster'],
    source: ['src'],
    img: ['src'],
    image: ['xlink:href', 'href'],
    use: ['xlink:href', 'href']
  }
}
