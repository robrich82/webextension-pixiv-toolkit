import browser from '@/modules/Extension/browser';

/**
 * The manifest's `host_permissions`. Firefox MV3 treats them as optional, so
 * they can be missing on a fresh install (#390); Chrome grants them at install.
 * @returns {string[]}
 */
export function hostOrigins() {
  return browser.runtime.getManifest().host_permissions || [];
}

/** @returns {Promise<boolean>} */
export function hasHostPermissions() {
  return browser.permissions.contains({ origins: hostOrigins() });
}

/**
 * Call it straight from a click handler, before any await: the browser only
 * shows the prompt in response to a user gesture.
 * @returns {Promise<boolean>}
 */
export function requestHostPermissions() {
  return browser.permissions.request({ origins: hostOrigins() });
}
