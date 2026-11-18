const fs = require('fs');
const {
  test, expect, mockPixiv, collectErrors, openPanel, seedSettings, recordSaveNames, savedFiles
} = require('./fixtures');

const NOVEL_URL = 'https://www.pixiv.net/novel/show.php?id=40000001';

test.beforeEach(async ({ context }) => {
  await mockPixiv(context, {
    ajax: { '/ajax/novel/40000001': 'pixiv/novel-single.json' }
  });
});

test('saves a novel as a text file with its url, author, title and text', async ({ context, serviceWorker }) => {
  const errors = collectErrors(context);
  await recordSaveNames(serviceWorker);
  const page = await openPanel(context, NOVEL_URL);

  await page.getByText('Download', { exact: true }).click();

  const [file] = await savedFiles(serviceWorker, 1);
  expect(file.name).toBe('40000001_the tide comes in.txt');
  expect(fs.readFileSync(file.path, 'utf8').split('\r\n\r\n')).toEqual([
    NOVEL_URL,
    'tidewriter',
    'the tide comes in',
    // The parser turns each line break into <br />, and the book writes those as \r\n.
    'The tide comes in.\r\nIt goes out again.'
  ]);
  expect(errors).toEqual([]);
});

// The defaults above name and fill the file the same as no settings at all would.
test('names the file by the novel rename rule and adds the description when set to', async ({ context, serviceWorker }) => {
  const errors = collectErrors(context);
  await seedSettings(serviceWorker, { novelRenameRule: '{author}-{title}', novelIncludeDescription: true });
  await recordSaveNames(serviceWorker);
  const page = await openPanel(context, NOVEL_URL);

  await page.getByText('Download', { exact: true }).click();

  const [file] = await savedFiles(serviceWorker, 1);
  expect(file.name).toBe('tidewriter-the tide comes in.txt');
  expect(fs.readFileSync(file.path, 'utf8').split('\r\n\r\n')).toEqual([
    NOVEL_URL,
    'tidewriter',
    'the tide comes in',
    'a short one',
    'The tide comes in.\r\nIt goes out again.'
  ]);
  expect(errors).toEqual([]);
});
