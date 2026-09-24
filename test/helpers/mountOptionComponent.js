/**
 * Every options-page component reads `this.browserItems` (from SuperMixin,
 * which resolves `this.$root.globalBrowserItems`) and calls `this.tl(...)`
 * (SuperMixin again, wrapping `this.$t`). Neither is available on a bare
 * mount(): `@vue/test-utils` 2 mounts the component under an internal host,
 * so `$root` is NOT the mounted instance itself (confirmed empirically —
 * unlike a real `createApp(Component).mount()`, where a parentless
 * component is its own root), and `$root` has no setter, so
 * `global.mocks.$root` fails ("trap returned falsish"). A *global mixin*'s
 * `data()`, though, is applied app-wide — including to that internal host —
 * so seeding `globalBrowserItems` through a mixin reaches `$root` the same
 * way it would in the real app. mocks.$t is a plain passthrough stub rather
 * than a real vue-i18n instance, since these specs assert behaviour, not
 * translated text.
 *
 * `@vue/test-utils` 2 removed `createLocalVue`/`parentComponent` entirely —
 * see docs/vue3-migration.md. Plugins/mixins/mocks now live under `global`,
 * and `createVuetify()` builds its own isolated instance per call (unlike
 * Vue 2's `Vue.use`, there's no global registration to collide across
 * tests), so this can be created once at module scope.
 */
import { mount, shallowMount } from '@vue/test-utils';
import { createAppVuetify } from '@/options_page/vuetify';
import SuperMixin from '@/mixins/SuperMixin';

const vuetify = createAppVuetify();

function buildMountOptions({ browserItems = {}, mocks = {}, global: globalOverrides = {}, ...options } = {}) {
  const browserItemsMixin = {
    data() {
      return { globalBrowserItems: browserItems };
    }
  };

  // Merged rather than spread wholesale: a caller passing `global.stubs` or
  // `global.provide` (the normal VTU2 way to reach them) would otherwise
  // silently replace this whole block and lose vuetify/SuperMixin/$t.
  const {
    plugins: extraPlugins = [],
    mixins: extraMixins = [],
    mocks: extraMocks = {},
    ...restGlobal
  } = globalOverrides;

  return {
    global: {
      plugins: [vuetify, ...extraPlugins],
      mixins: [SuperMixin, browserItemsMixin, ...extraMixins],
      mocks: {
        $t: key => key,
        ...mocks,
        ...extraMocks
      },
      ...restGlobal
    },
    ...options
  };
}

export function shallowMountOption(Component, options) {
  const built = buildMountOptions(options);

  return shallowMount(Component, {
    ...built,
    global: {
      // Vuetify layout components (v-card, v-list, ...) are now really
      // registered, so shallowMount stubs them and their default slot would
      // otherwise swallow every descendant a spec needs to find. Caveat:
      // this also renders stubbed dialogs/menus regardless of visibility, so
      // a future "X is not visible" assertion needs a real mount, not this.
      renderStubDefaultSlot: true,
      ...built.global
    }
  });
}

/**
 * A real (non-shallow) mount, for the rare spec that needs to assert on
 * actual Vuetify-rendered output rather than component state -- e.g. pinning
 * that a named slot (`#title`/`#subtitle`/`#append`) or an `item-title`/
 * `item-value` prop mapping actually reaches the DOM, which `shallowMount`
 * can't see (its stub only ever renders the *default* slot).
 */
export function mountOption(Component, options) {
  return mount(Component, buildMountOptions(options));
}
