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
import { shallowMount } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import SuperMixin from '@/mixins/SuperMixin';

const vuetify = createVuetify();

export function shallowMountOption(Component, { browserItems = {}, mocks = {}, ...options } = {}) {
  const browserItemsMixin = {
    data() {
      return { globalBrowserItems: browserItems };
    }
  };

  return shallowMount(Component, {
    global: {
      plugins: [vuetify],
      mixins: [SuperMixin, browserItemsMixin],
      mocks: {
        $t: key => key,
        ...mocks
      }
    },
    ...options
  });
}
