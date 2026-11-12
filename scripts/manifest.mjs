/**
 * src/statics/manifest.json is written for Chrome. Stamps the package version
 * and, for Firefox, rewrites the keys Firefox handles differently.
 */
export function transformManifest(manifest, { platform, version }) {
  const json = structuredClone(manifest);

  json.version = version;

  if (platform !== 'firefox') {
    json.version_name = version;
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
      update_url: 'https://github.com/robrich82/webextension-pixiv-toolkit/releases/latest/download/updates.json'
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
