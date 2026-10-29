const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  // `.e2e.js`, not `.spec.js`: Jest's testRegex would otherwise pick these up.
  testMatch: '**/*.e2e.js',
  // Each test launches its own browser with the extension loaded, and the
  // download manager tab is a per-profile singleton, so keep them serial.
  workers: 1,
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure'
  }
});
