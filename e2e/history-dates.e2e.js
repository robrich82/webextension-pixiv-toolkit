const { test, expect, collectErrors } = require('./fixtures');

/**
 * Seed one visit into the options page's Dexie history, the way the
 * download manager would.
 * @param {import('@playwright/test').Page} page
 */
async function seedHistory(page) {
  await page.evaluate(async () => {
    const db = new Dexie('PixivToolkitDatabase');
    db.version(1).stores({
      histories: '++id,&uid,title,userName,cover,url,type,r,downloaded_at,visited_at',
      tracked_errors: '++id,error,created_at'
    });
    await db.histories.add({
      uid: 'illust:10000001',
      title: 'seeded',
      cover: '',
      url: 'https://www.pixiv.net/en/artworks/10000001',
      type: 0,
      r: false,
      visited_at: Math.floor(Date.now() / 1000)
    });
    db.close();
  });
}

// moment's own locales aren't bundled (#184): en is built in and zh_CN is the
// app's own locale. Had zh_CN fallen back to en, the time would end in AM/PM.
for (const [language, format] of [
  ['en', /^\d{1,2}:\d{2}(AM|PM)$/],
  ['zh_CN', /^(凌晨|早上|上午|中午|下午|晚上) \d{1,2}:\d{2}$/]
]) {
  test(`history times format in ${language}`, async ({ context, extensionId, serviceWorker }) => {
    const errors = collectErrors(context);
    const seeder = await context.newPage();
    await seeder.goto(`chrome-extension://${extensionId}/options_page/index.html`);
    await seedHistory(seeder);
    // Set after the first page load, or first-run defaults overwrite it.
    await serviceWorker.evaluate(language =>
      chrome.storage.local.set({ language, showUpdateChangeLog: true }), language);

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options_page/index.html#/history`);
    await expect(page.locator('.page-history')).toBeVisible();

    const time = page.locator('.history-item__info-entity--sub').nth(1);
    await expect(time).toHaveText(format);
    expect(errors).toEqual([]);
  });
}
