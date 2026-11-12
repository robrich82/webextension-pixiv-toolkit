const fs = require('fs');
const {
  test, expect, mockPixiv, collectErrors, openPanel, seedSettings, recordSaveNames, savedFiles
} = require('./fixtures');
const { PIXEL } = require('./fakePixivRoutes');

const MANGA_URL = 'https://www.pixiv.net/en/artworks/10000002';
const original = p => `/img-original/img/2024/11/23/22/05/00/10000002_p${p}.jpg`;
// Each page's bytes end with its own marker, so a file can be matched to the page it came from.
const pageBody = p => Buffer.concat([PIXEL, Buffer.from(`page ${p}`)]);

test.beforeEach(async ({ context }) => {
  await mockPixiv(context, {
    ajax: {
      '/ajax/illust/10000002': 'pixiv/illust-manga.json',
      '/ajax/illust/10000002/pages': 'pixiv/illust-manga-pages.json'
    },
    pximg: Object.fromEntries([0, 1, 2].map(p => [original(p), { contentType: 'image/png', body: pageBody(p) }]))
  });
});

test('saves every page of a manga under its configured name', async ({ context, serviceWorker }) => {
  const errors = collectErrors(context);
  await seedSettings(serviceWorker, {
    downloadSaveMode: 1,
    mangaRenameRule: '{id}_{title}',
    mangaRenameImageRule: 'page-{pageNum}',
    globalTaskPageNumberStartWithOne: 1
  });
  await recordSaveNames(serviceWorker);
  const page = await openPanel(context, MANGA_URL);

  // The page selector has a Download button of its own.
  await page.locator('.ptk__action__wrapper__body > a').filter({ hasText: /^Download$/ }).click();

  const files = await savedFiles(serviceWorker, 3);
  const folder = '10000002_the lighthouse keeper, ch.2';
  expect(files.map(file => file.name).sort()).toEqual([1, 2, 3].map(n => `${folder}/page-${n}.png`));
  // Page n of the post is the file named page-(n+1).
  for (const file of files) {
    const n = Number(file.name.match(/page-(\d)\.png$/)[1]);
    expect(fs.readFileSync(file.path).subarray(-6).toString()).toBe(`page ${n - 1}`);
  }
  expect(errors).toEqual([]);
});
