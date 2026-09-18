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
