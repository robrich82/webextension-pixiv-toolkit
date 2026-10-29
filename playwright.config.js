const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  // `.e2e.js`, not `.spec.js`: Jest's testRegex would otherwise pick these up.
  testMatch: '**/*.e2e.js',
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure'
  }
});
