/**
 * src/statics/manifest.json is written for Chrome. Stamps the package version
 * and, for Firefox, rewrites the keys Firefox handles differently.
 */
export function transformManifest(manifest, { platform, version }) {
  const json = structuredClone(manifest);

  json.version_name = json.version = version;

  if (platform !== 'firefox') {
    return json;
  }

  // Firefox runs the MV3 background as an event page, not a service worker.
  if (json.background && json.background.service_worker) {
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

    // Firefox has no `downloads.shelf`.
    (json.optional_permissions || []).forEach(permission => {
      if (permission !== 'downloads.shelf') json.permissions.push(permission);
    });

    delete json.optional_permissions;
    delete json.options_page;
    delete json.version_name;
  }

  return json;
}
