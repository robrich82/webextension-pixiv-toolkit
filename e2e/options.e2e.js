const fs = require('fs');
const path = require('path');
const { test, expect, collectErrors, waitForDownloads } = require('./fixtures');

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} row  the list item's title, e.g. 'Export settings'
 * @param {string} button
 */
function settingsButton(page, row, button) {
  return page.getByRole('listitem').filter({ hasText: row })
    .getByRole('button', { name: button, exact: true });
}

test('settings export and import round-trip without errors', async ({ context, extensionId, serviceWorker }, testInfo) => {
  const errors = collectErrors(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options_page/index.html`);
  // A fresh install opens the changelog dialog over the page.
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  await settingsButton(page, 'Export settings', 'Export').click();
  const [download] = await waitForDownloads(serviceWorker, 1);
  const exported = JSON.parse(fs.readFileSync(download.filename, 'utf8'));
  expect(exported).toHaveProperty('mangaRenameRule');
  expect(exported).not.toHaveProperty('historyBackup');

  const file = testInfo.outputPath('settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...exported, mangaRenameRule: '{id}_imported' }));

  // importSettings() alerts, then reloads the page.
  page.on('dialog', dialog => dialog.accept());
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    settingsButton(page, 'Import settings', 'Import').click()
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

test('the diagnosis page lists tracked errors without the download manager open', async ({ context, extensionId }) => {
  const errors = collectErrors(context);
  const seeder = await context.newPage();
  await seeder.goto(`chrome-extension://${extensionId}/options_page/index.html`);
  // Recorded the way the background's DownloadService records one.
  await seeder.evaluate(async () => {
    const db = new Dexie('PixivToolkitDatabase');
    db.version(1).stores({
      histories: '++id,&uid,title,userName,cover,url,type,r,downloaded_at,visited_at',
      tracked_errors: '++id,error,created_at'
    });
    await db.tracked_errors.add({ error: new Error('seeded error'), created_at: Date.UTC(2026, 0, 1) });
    db.close();
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options_page/index.html#/diagnosis_messages`);

  expect(context.pages().some(p => p.url().includes('/downloads.html'))).toBe(false);
  await expect(page.locator('.diagnosis-messages textarea').nth(2))
    .toHaveValue('2026-01-01T00:00:00.000Z Error: seeded error\n');
  expect(errors).toEqual([]);
});
