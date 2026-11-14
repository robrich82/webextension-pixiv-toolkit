/**
 * The minimum Chrome and Firefox versions in package.json's browserslist,
 * e.g. `{ chrome: '110', firefox: '115' }`. The build target and the
 * manifest's minimum versions are all derived from them.
 */
export function browserFloors(browserslist) {
  const floors = {};

  for (const query of browserslist) {
    const match = /^(chrome|firefox) >= (\d+)$/.exec(query.trim());
    if (!match) throw new Error(`Unsupported browserslist query "${query}": use "chrome >= N" or "firefox >= N"`);
    floors[match[1]] = match[2];
  }

  for (const browser of ['chrome', 'firefox']) {
    if (!floors[browser]) throw new Error(`browserslist has no "${browser} >= N" query`);
  }

  return floors;
}

/**
 * src/statics/manifest.json is written for Chrome. Stamps the package version
 * and minimum browser version and, for Firefox, rewrites the keys Firefox
 * handles differently.
 */
export function transformManifest(manifest, { platform, version, floors }) {
  const json = structuredClone(manifest);

  json.version = version;

  if (platform !== 'firefox') {
    json.version_name = version;
    json.minimum_chrome_version = floors.chrome;
    return json;
  }

  delete json.version_name;

  // Firefox runs the MV3 background as an event page, not a service worker.
  if (json.background?.service_worker) {
    json.background = { scripts: [json.background.service_worker] };
  }

  /**
   * Firefox needs an explicit add-on id to install a build permanently or to
   * sign it through AMO. `update_url` is the self-hosted update manifest that
   * scripts/release-firefox.js publishes, so the unlisted build auto-updates.
   */
  json.browser_specific_settings = {
    gecko: {
      id: 'webextension-pixiv-toolkit-fork@robrich82',
      update_url: 'https://github.com/robrich82/webextension-pixiv-toolkit/releases/latest/download/updates.json',
      strict_min_version: `${floors.firefox}.0`
    }
  };

  if (json.options_page) {
    json.options_ui = { page: json.options_page, open_in_tab: true };
    delete json.options_page;
  }

  // Firefox has no `downloads.shelf`.
  if (json.optional_permissions) {
    const supported = json.optional_permissions.filter(p => p !== 'downloads.shelf');
    if (supported.length) json.permissions = [...(json.permissions || []), ...supported];
    delete json.optional_permissions;
  }

  return json;
}
