const { test, expect, collectErrors, seedHistory } = require('./fixtures');

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
