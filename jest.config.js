const base = {
  transform: {
    '\\.m?js$': 'babel-jest'
  },
  modulePathIgnorePatterns: [
    '<rootDir>/dist/'
  ],
  moduleNameMapper: {
    '^@/modules/Extension/browser$': '<rootDir>/test/doubles/browser.js',
    // Vuetify 3 components import their own co-located stylesheet (e.g.
    // VApp.js does `import './VApp.css'`), which babel-jest can't parse as JS.
    '\\.(css|s[ac]ss)$': '<rootDir>/test/doubles/styleMock.js',
    '\\.(png|svg)$': '<rootDir>/test/doubles/fileMock.js',
    '^vue-virtual-scroller$': '<rootDir>/test/doubles/vueVirtualScroller.js',
    '^@@/(.*)$': '<rootDir>/src/options_page/$1',
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  setupFilesAfterEnv: [
    '<rootDir>/test/setup/extensionGlobals.js'
  ]
};

module.exports = {
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.js',
    'src/**/*.vue',
    '!src/statics/lib/**',
    // Manual debug page: routed, but not linked from the menu.
    '!src/options_page/components/Test.vue'
  ],
  coverageThreshold: {
    global: {
      statements: 7.1,
      branches: 6.5,
      functions: 7.0,
      lines: 7.0
    },
    './src/modules/Util/': {
      statements: 95,
      branches: 86,
      functions: 100,
      lines: 99
    },
    './src/modules/Parser/': {
      statements: 77,
      branches: 66,
      functions: 67,
      lines: 76
    },
    './src/content_scripts/components/': {
      statements: 94,
      branches: 80,
      functions: 88,
      lines: 94
    },
    './src/content_scripts/UIApplication.js': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100
    },
    // A glob applies per file, so each top-level component keeps its own
    // floor; a directory key would also pool in options/.
    './src/options_page/components/*.vue': {
      statements: 67,
      branches: 59,
      functions: 85,
      lines: 67
    },
    './src/options_page/Index.vue': {
      statements: 96,
      branches: 92,
      functions: 90,
      lines: 96
    },
    './src/options_page/Downloads.vue': {
      statements: 72,
      branches: 60,
      functions: 75,
      lines: 75
    },
    './src/options_page/components/options/': {
      statements: 88,
      branches: 78,
      functions: 95,
      lines: 88
    }
  },
  projects: [
    {
      ...base,
      displayName: 'unit',
      testEnvironment: 'node',
      testRegex: '\\.spec\\.js$',
      testPathIgnorePatterns: [
        '/test/components/'
      ]
    },
    {
      ...base,
      displayName: 'components',
      testEnvironment: 'jsdom',
      // Every spec imports `.vue` files with an explicit extension, so `js`
      // resolving before `vue` is the safer default for any future
      // extension-less import.
      moduleFileExtensions: [
        'js',
        'json',
        'vue'
      ],
      transform: {
        ...base.transform,
        '\\.vue$': '@vue/vue3-jest'
      },
      // Vuetify 3 and nostics (pulled in by vue-router 5) ship ESM-only;
      // babel-jest has to transpile them like any other source file instead
      // of Jest's default of skipping node_modules.
      // pnpm resolves every package through node_modules/.pnpm/<name>@<version>/,
      // so matching on that literal segment (rather than a generic
      // `node_modules/(?!vuetify)`, which false-matches on vuetify's own
      // nested node_modules/vuetify re-export) is what actually excludes it.
      transformIgnorePatterns: [
        'node_modules[\\\\/]\\.pnpm[\\\\/](?!vuetify@|nostics@)'
      ],
      setupFilesAfterEnv: [
        ...base.setupFilesAfterEnv,
        '<rootDir>/test/setup/jsdomGlobals.js'
      ],
      testRegex: '/test/components/.*\\.spec\\.js$'
    }
  ]
};
