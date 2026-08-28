/**
 * Puts the extension API fake where non-module code expects to find it, and
 * hands every test a clean copy of it.
 *
 * Most of the source imports `@/modules/Extension/browser`, which
 * `moduleNameMapper` already points at the fake. The rest reaches for the
 * globals directly — `chrome.i18n.getUILanguage()` in `UIApplication.js` and
 * `downloads.js`, `window.chrome` in `modules/Browser/Browser.js` — and the
 * real `browser.js` itself dereferences `self`. Under the `node` test
 * environment none of those exist, so they are defined here against the same
 * fake instance the mapped imports get.
 */
import browser from '../doubles/browser';

globalThis.chrome = browser;
globalThis.browser = browser;
globalThis.self = globalThis;
globalThis.window = globalThis;

beforeEach(() => {
  browser._fake.reset();
});
