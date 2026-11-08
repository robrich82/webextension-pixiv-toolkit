import { config } from '@vue/test-utils';

/**
 * jsdom doesn't implement the global `CSS` object (used for `CSS.supports()`
 * feature detection), and Vuetify 3 references it unconditionally at import
 * time (`vuetify/src/util/globals.ts`'s `IS_WEBKIT` check) rather than
 * guarding with `typeof CSS !== 'undefined'`, so importing vuetify under
 * jsdom throws `ReferenceError: CSS is not defined` without this stub.
 */
if (typeof globalThis.CSS === 'undefined') {
  globalThis.CSS = { supports: () => false };
}

/**
 * jsdom doesn't implement ResizeObserver, which Vuetify's overlay/menu
 * machinery (used by v-select, v-dialog, v-menu, ...) reads unconditionally
 * on a real (non-shallow) mount.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

/**
 * jsdom doesn't implement `visualViewport` at all -- not even as `undefined`
 * on `window` -- so Vuetify's overlay location strategy (`v-dialog`, `v-menu`,
 * ... on a real, non-shallow mount) throws `ReferenceError: visualViewport is
 * not defined` on the bare identifier reference before its own `?.` optional
 * chaining ever gets a chance to guard against a missing implementation.
 */
if (typeof globalThis.visualViewport === 'undefined') {
  globalThis.visualViewport = null;
}

/**
 * Every Vue warning is a bug the suite would otherwise pass over (#188), so
 * fail the test that raised it. Collect, don't throw: Vue's warn() resets its
 * re-entrancy flag and resumes reactivity tracking only after the handler
 * returns, so a throw would silence every later warning in the file.
 */
const vueWarnings = [];

config.global.config.warnHandler = (msg, instance, trace) => {
  vueWarnings.push(`[Vue warn]: ${msg}\n${trace}`);
};

// Apps built with createApp (UIApplication) skip that config and warn through console.warn.
const consoleWarn = console.warn;
console.warn = (msg, ...rest) => {
  if (typeof msg === 'string' && msg.startsWith('[Vue warn]')) {
    vueWarnings.push([msg, ...rest].join(' '));
    return;
  }
  consoleWarn(msg, ...rest);
};

afterEach(() => {
  if (vueWarnings.length) {
    throw new Error(vueWarnings.splice(0).join('\n\n'));
  }
});
