const fs = require('fs');
const path = require('path');
const { test, expect, collectErrors, waitForDownloads } = require('./fixtures');

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} row  the list item's title, e.g. 'Export settings'
 * @param {string} button
 */
async function openSettingsMenu(page, row, button) {
  await page.getByRole('listitem').filter({ hasText: row })
    .getByRole('button', { name: button, exact: true }).hover();

  // Vuetify's v-menu content has no menu role; only the hovered one is rendered.
  return page.locator('.v-menu').getByText('All Settings', { exact: true });
}

test('settings export and import round-trip without errors', async ({ context, extensionId, serviceWorker }, testInfo) => {
  const errors = collectErrors(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options_page/index.html`);
  // A fresh install opens the changelog dialog over the page.
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  await (await openSettingsMenu(page, 'Export settings', 'Export')).click();
  const [download] = await waitForDownloads(serviceWorker, 1);
  const exported = JSON.parse(fs.readFileSync(download.filename, 'utf8'));
  expect(exported).toHaveProperty('mangaRenameRule');

  const file = testInfo.outputPath('settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...exported, mangaRenameRule: '{id}_imported' }));

  // importSettings() alerts, then reloads the page.
  page.on('dialog', dialog => dialog.accept());
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    (await openSettingsMenu(page, 'Import settings', 'Import')).click()
  ]);
  await chooser.setFiles(file);

  await expect.poll(() => serviceWorker.evaluate(() =>
    chrome.storage.local.get('mangaRenameRule').then(items => items.mangaRenameRule)
  )).toBe('{id}_imported');
  expect(errors).toEqual([]);
});

test('the history route mounts without errors', async ({ context, extensionId }) => {
  const errors = collectErrors(context);
  const page = await context.newPage();

  await page.goto(`chrome-extension://${extensionId}/options_page/index.html#/history`);

  await expect(page.locator('.page-history')).toBeVisible();
  expect(errors).toEqual([]);
});
