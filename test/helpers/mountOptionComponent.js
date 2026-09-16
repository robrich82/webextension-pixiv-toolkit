/**
 * Every options-page component reads `this.browserItems` (from SuperMixin,
 * which resolves `this.$root.globalBrowserItems`) and calls `this.tl(...)`
 * (SuperMixin again, wrapping `this.$t`). Neither is available on a bare
 * mount(): browserItems needs a $root with the data already on it before the
 * component's created() hook runs, and $t needs vue-i18n or a stand-in.
 *
 * A `parentComponent` gives the mounted component a real $root distinct from
 * itself, which is the only way vue-test-utils lets a mounted component's
 * $root carry data. mocks.$t is a plain passthrough stub rather than a real
 * vue-i18n instance, since these specs assert behaviour, not translated text.
 */
import { createLocalVue, shallowMount } from '@vue/test-utils';
import Vuetify from 'vuetify';
import SuperMixin from '@/mixins/SuperMixin';

/**
 * Vuetify tracks the Vue constructor it was installed on and warns about
 * "multiple instances" if `.use(Vuetify)` runs again on a different
 * constructor — which a fresh `createLocalVue()` per mount would trigger on
 * every single test. One localVue, built once and reused, avoids that.
 */
const localVue = createLocalVue();
localVue.use(Vuetify);
localVue.mixin(SuperMixin);

function buildParentComponent(browserItems) {
  return {
    data() {
      return {
        globalBrowserItems: browserItems
      };
    },
    render: h => h('div')
  };
}

export function shallowMountOption(Component, { browserItems = {}, mocks = {}, ...options } = {}) {
  return shallowMount(Component, {
    localVue,
    parentComponent: buildParentComponent(browserItems),
    mocks: {
      $t: key => key,
      ...mocks
    },
    ...options
  });
}
