import fs from 'node:fs';
import path from 'node:path';

// Shipped npm packages whose installed version the Third Party page shows. @ffmpeg/ffmpeg is a
// devDependency, but build.mjs copies its UMD build into lib/ffmpeg, and ffmpeg.wasm releases follow its version.
export const THIRD_PARTY_PACKAGES = [
  '@ffmpeg/ffmpeg', '@mdi/font', 'dexie', 'fflate', 'gifenc', 'jszip', 'md5', 'mediabunny', 'mitt', 'moment',
  'vue', 'vue-i18n', 'vue-router', 'vue-virtual-scroller', 'vuetify'
];

/**
 * Vite `define` entries exposing the installed versions as `__THIRD_PARTY_VERSIONS__`.
 * Read from node_modules rather than package.json ranges, so the page shows what shipped.
 */
export function thirdPartyVersionsDefine(root) {
  const versions = Object.fromEntries(THIRD_PARTY_PACKAGES.map(name => [
    name,
    JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version
  ]));

  return { __THIRD_PARTY_VERSIONS__: JSON.stringify(versions) };
}
