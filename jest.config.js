const base = {
  transform: {
    '\\.js$': 'babel-jest'
  },
  modulePathIgnorePatterns: [
    '<rootDir>/dist/'
  ],
  moduleNameMapper: {
    '^@/modules/Extension/browser$': '<rootDir>/test/doubles/browser.js',
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
    '!src/statics/lib/**'
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
        '\\.vue$': '@vue/vue2-jest'
      },
      testRegex: '/test/components/.*\\.spec\\.js$'
    }
  ]
};
