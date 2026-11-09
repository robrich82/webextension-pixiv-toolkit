import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

const here = path => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [vue()],
  // webpack's DefinePlugin constant (config/webpack.base.config.js).
  define: { PRESET_BROWSER: JSON.stringify('chrome') },
  resolve: {
    // webpack resolves extensionless .vue imports; Vite needs telling.
    extensions: ['.mjs', '.js', '.json', '.vue'],
    alias: [
      // Before `@`, which would otherwise claim it.
      { find: /^@\/modules\/Extension\/browser$/, replacement: here('test/doubles/browser.js') },
      { find: /^@@\//, replacement: here('src/options_page/') },
      { find: /^@\//, replacement: here('src/') },
      // webpack resolves `locales` as an external global (config/webpack.base.config.js).
      { find: /^locales$/, replacement: here('test/doubles/locales.js') },
      { find: /^vue-virtual-scroller$/, replacement: here('test/doubles/vueVirtualScroller.js') }
    ]
  },
  test: {
    globals: true,
    // Vuetify's components import their own CSS, which Node can't load, so Vite
    // has to transform it rather than hand it to Node.
    server: { deps: { inline: ['vuetify'] } },
    setupFiles: ['test/setup/extensionGlobals.js'],
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/**/*.{js,vue}'],
      exclude: ['src/statics/lib/**'],
      reporter: ['text', 'lcov'],
      // A ratchet: each floor sits just under the measured number. A glob pools
      // its files unless it sets perFile, and every file also counts toward the
      // global numbers. Raise a floor when coverage rises; lower one
      // only with a reason in the PR. See docs/testing.md.
      thresholds: {
        statements: 77,
        branches: 75,
        functions: 78,
        lines: 77,
        'src/modules/Db/**': { statements: 99, branches: 90, functions: 100, lines: 99 },
        'src/options_page/modules/**': { statements: 62, branches: 54, functions: 70, lines: 62 },
        'src/options_page/services/**': { statements: 63, branches: 62, functions: 59, lines: 63 },
        'src/modules/Net/**': { statements: 91, branches: 75, functions: 97, lines: 91 },
        'src/modules/Util/**': { statements: 99, branches: 99, functions: 100, lines: 99 },
        'src/modules/Parser/**': { statements: 85, branches: 72, functions: 73, lines: 84 },
        'src/content_scripts/components/**': { statements: 95, branches: 90, functions: 92, lines: 95 },
        'src/content_scripts/UIApplication.js': { statements: 100, branches: 100, functions: 100, lines: 100 },
        // Per file. Options.vue's one branch is a v-if="false", and
        // DiagnosisMessages.vue sits well below the rest, so each has its own floor.
        'src/options_page/components/!(Options|DiagnosisMessages).vue': { statements: 90, branches: 85, functions: 81, lines: 90, perFile: true },
        'src/options_page/components/Options.vue': { statements: 100, branches: 0, functions: 100, lines: 100 },
        'src/options_page/components/DiagnosisMessages.vue': { statements: 76, branches: 100, functions: 62, lines: 75 },
        'src/options_page/Index.vue': { statements: 98, branches: 97, functions: 97, lines: 98 },
        'src/options_page/Downloads.vue': { statements: 83, branches: 86, functions: 87, lines: 84 },
        'src/options_page/components/options/**': { statements: 88, branches: 96, functions: 83, lines: 88 }
      }
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/**/*.spec.js'],
          exclude: ['test/components/**']
        }
      },
      {
        extends: true,
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['test/components/**/*.spec.js'],
          setupFiles: ['test/setup/jsdomGlobals.js']
        }
      }
    ]
  }
});
