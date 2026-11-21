const { test, expect, mockPixiv, seedSettings } = require('./fixtures');

const UGOIRA_URL = 'https://www.pixiv.net/en/artworks/10000003';

test.beforeEach(async ({ context }) => {
  await mockPixiv(context, {
    ajax: {
      '/ajax/illust/10000003': 'pixiv/illust-ugoira.json',
      '/ajax/illust/10000003/ugoira_meta': 'pixiv/illust-ugoira-meta.json'
    },
    pximg: {
      '/img-zip-ugoira/img/2024/06/01/08/00/00/10000003_ugoira1920x1080.zip': 'pixiv/illust-ugoira-frames.zip'
    }
  });
});

/** The panel's box and its buttons' boxes, rounded. */
const measure = page => page.evaluate(() => {
  const box = element => {
    const { left, top, right, bottom } = element.getBoundingClientRect();
    return { left: Math.round(left), top: Math.round(top), right: Math.round(right), bottom: Math.round(bottom) };
  };

  return {
    panel: box(document.querySelector('.ptk__container__body-container')),
    buttons: [...document.querySelectorAll('.ptk__action__wrapper__body .button')].map(box)
  };
});

const HEIGHT = 700;

for (const position of ['left', 'center', 'right']) {
  test(`in a narrow window the ${position} panel wraps its buttons upwards, all on screen (#443)`, async ({ context, serviceWorker }) => {
    await seedSettings(serviceWorker, { downloadPanelPosition: position, showPixivOmina: true, guideShowed: true });
    const page = await context.newPage();
    await page.setViewportSize({ width: 560, height: HEIGHT });
    await page.goto(UGOIRA_URL);
    await page.getByText('DL GIF', { exact: true }).waitFor({ state: 'attached' });

    // Collapsed, the taller panel still hides below the window.
    expect((await measure(page)).panel.top).toBeGreaterThanOrEqual(HEIGHT);

    await page.locator('#ptk__new-handler').click();
    await expect.poll(async () => (await measure(page)).panel.bottom).toBeLessThan(HEIGHT);

    const { panel, buttons } = await measure(page);
    expect(buttons).toHaveLength(8);
    expect(new Set(buttons.map(button => button.top)).size).toBeGreaterThan(1);
    for (const button of buttons) {
      expect(button.left).toBeGreaterThanOrEqual(panel.left);
      expect(button.right).toBeLessThanOrEqual(panel.right);
      expect(button.top).toBeGreaterThanOrEqual(panel.top);
    }
    expect(panel.left).toBeGreaterThanOrEqual(0);
    expect(panel.right).toBeLessThanOrEqual(560);
  });
}

test('in a wide window the panel keeps its buttons on one row', async ({ context, serviceWorker }) => {
  await seedSettings(serviceWorker, { showPixivOmina: true, guideShowed: true });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1366, height: HEIGHT });
  await page.goto(UGOIRA_URL);
  await page.locator('#ptk__new-handler').click();
  await expect.poll(async () => (await measure(page)).panel.bottom).toBeLessThan(HEIGHT);

  const { buttons } = await measure(page);
  expect(new Set(buttons.map(button => button.top)).size).toBe(1);
});

// Style 2 opens and closes from its P* button: wrapping must not move it from under the cursor.
test('in a narrow window the inline P* button stays on the bottom row as the panel opens', async ({ context, serviceWorker }) => {
  await seedSettings(serviceWorker, {
    downloadPanelStyle: 2, downloadPanelPosition: 'right', showPixivOmina: true, guideShowed: true
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: HEIGHT });
  await page.goto(UGOIRA_URL);
  await page.getByText('DL GIF', { exact: true }).waitFor({ state: 'attached' });
  const handler = page.locator('.ptk__inline-handler');
  const handlerBottom = async () => Math.round((await handler.boundingBox()).y + (await handler.boundingBox()).height);
  const collapsedBottom = await handlerBottom();

  await handler.click();
  await expect.poll(async () => new Set((await measure(page)).buttons.map(button => button.top)).size).toBeGreaterThan(1);
  await page.waitForFunction(() => document.getAnimations().length === 0);

  expect(await handlerBottom()).toBe(collapsedBottom);
});
