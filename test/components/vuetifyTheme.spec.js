import { mount } from '@vue/test-utils';
import { h } from 'vue';
import { createVuetify } from 'vuetify';
import { VApp } from 'vuetify/components';
import { createAppVuetify } from '@/options_page/vuetify';

// Vuetify checks for matchMedia when it is imported, so the OS preference must be
// in place before the imports run.
vi.hoisted(() => {
  window.matchMedia = query => ({
    matches: query === '(prefers-color-scheme: dark)',
    media: query,
    addEventListener() {},
    removeEventListener() {}
  });
});

const appClasses = vuetify => mount({ render: () => h(VApp) }, { global: { plugins: [vuetify] } }).classes();

describe('options page theme, with the OS set to prefer dark', () => {
  test("Vuetify's own default follows the OS to dark", () => {
    expect(appClasses(createVuetify({ components: { VApp } }))).toContain('v-theme--dark');
  });

  test('the options pages stay light', () => {
    expect(appClasses(createAppVuetify())).toContain('v-theme--light');
  });
});
