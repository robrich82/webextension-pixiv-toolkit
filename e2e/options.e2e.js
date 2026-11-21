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
  // Recorded the way the background's DownloadService records one. The schema is src/modules/Db/Db.js's.
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

  await expect(page.locator('.diagnosis-messages textarea').nth(2))
    .toHaveValue('2026-01-01T00:00:00.000Z Error: seeded error\n');
  expect(context.pages().some(p => p.url().includes('/downloads.html'))).toBe(false);
  expect(errors).toEqual([]);
});

test("each video format offers the codecs it holds, marks the ones Chromium can't encode and stores the choice", async ({ context, extensionId, serviceWorker }) => {
  const errors = collectErrors(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options_page/index.html`);
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Pixiv Ugoira' }).click();

  const webm = page.locator('.ugoira-codec-webm');
  const mp4 = page.locator('.ugoira-codec-mp4');
  await expect(mp4).toContainText('MP4 codec');
  // The rows load until WebCodecs answers, and only then mark anything.
  await expect(page.locator('[class*="ugoira-codec-"] .v-field--loading')).toHaveCount(0);

  await webm.getByRole('combobox').first().click();
  await expect(page.getByRole('option')).toHaveText(['VP9', 'AV1', 'VP8']);
  await page.keyboard.press('Escape');

  await mp4.getByRole('combobox').first().click();
  const options = page.getByRole('option');
  await expect(options).toHaveCount(5);
  const unencodable = "This browser can't encode it";
  // Playwright's Chromium encodes these, so marking one would mean its codec string is wrong.
  for (const label of ['H.264 (AVC)', 'VP9', 'AV1', 'VP8']) {
    await expect(options.filter({ hasText: label })).not.toContainText(unencodable);
  }
  // Whether H.265 encodes depends on the host's hardware: the mark follows the browser's answer.
  const hevc = await page.evaluate(() => VideoEncoder.isConfigSupported({ codec: 'hvc1.1.6.L120.B0', width: 1920, height: 1080 })
    .then(support => support.supported));
  const hevcOption = expect(options.filter({ hasText: 'H.265 (HEVC)' }));
  await (hevc ? hevcOption.not.toContainText(unencodable) : hevcOption.toContainText(unencodable));
  await options.filter({ hasText: 'VP9' }).click();

  await expect.poll(() => serviceWorker.evaluate(() =>
    chrome.storage.local.get(['ugoiraMP4Codec', 'ugoiraMOVCodec'])
  )).toEqual({ ugoiraMP4Codec: 'vp9', ugoiraMOVCodec: 'avc' });
  await expect(mp4).toContainText('VP9');
  expect(errors).toEqual([]);
});
