const { test, expect, collectErrors, seedHistory } = require('./fixtures');

// WCAG's floor for large text. Vuetify's own disabled text sits below it, so those are skipped.
const MIN_CONTRAST = 3;

/**
 * Switch the page's Vuetify theme. The pages are pinned light (#386), so the
 * test switches the instance itself rather than the OS preference.
 * @param {import('@playwright/test').Page} page
 * @param {'light'|'dark'} name
 */
async function useTheme(page, name) {
  await page.evaluate(name => {
    document.querySelector('#app-mount').__vue_app__._context.provides[Symbol.for('vuetify:theme')].change(name);
  }, name);
  await expect(page.locator('.v-application')).toHaveClass(new RegExp(`v-theme--${name}`));
  // Vuetify transitions card and button backgrounds; measure the colours they settle on.
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter(animation => animation instanceof CSSTransition)
    .map(animation => animation.finished)));
}

/**
 * Every visible piece of text whose contrast with what is painted behind it is
 * under `minContrast`, as `selector "text" ratio`.
 * @param {import('@playwright/test').Page} page
 */
function unreadableText(page) {
  return page.evaluate(minContrast => {
    const canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true });

    // The canvas resolves any CSS colour (color-mix, color(srgb …)) to 8-bit sRGB.
    const rgba = color => {
      canvas.clearRect(0, 0, 1, 1);
      canvas.fillStyle = color;
      canvas.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;

      return { r, g, b, a: a / 255 };
    };
    const over = (top, bottom) => ({
      r: top.r * top.a + bottom.r * (1 - top.a),
      g: top.g * top.a + bottom.g * (1 - top.a),
      b: top.b * top.a + bottom.b * (1 - top.a),
      a: 1
    });
    const luminance = ({ r, g, b }) => {
      const [R, G, B] = [r, g, b].map(v => {
        v /= 255;

        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });

      return 0.2126 * R + 0.7152 * G + 0.0722 * B;
    };
    const contrast = (x, y) => {
      const [hi, lo] = [luminance(x), luminance(y)].sort((a, b) => b - a);

      return (hi + 0.05) / (lo + 0.05);
    };

    // Composite the background layers from the element up to the first opaque one.
    const backdrop = element => {
      const layers = [];
      let opacity = 1;

      for (let node = element; node; node = node.parentElement) {
        const background = rgba(getComputedStyle(node).backgroundColor);

        if (background.a > 0) {
          layers.push(background);
        }

        if (background.a === 1) {
          break;
        }

        if (node !== element) {
          opacity *= Number(getComputedStyle(node).opacity);
        }
      }

      const base = layers.reduceRight((below, layer) => over(layer, below), { r: 255, g: 255, b: 255, a: 1 });

      return { base, opacity };
    };

    const describe = element => {
      const id = element.id ? `#${element.id}` : '';
      const classes = [...element.classList].slice(0, 2).map(name => `.${name}`).join('');

      return `${element.localName}${id}${classes}`;
    };

    const results = [];

    for (const element of document.querySelectorAll('body *')) {
      const text = [...element.childNodes]
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent.trim())
        .join(' ')
        .trim();

      if (!text || !element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) {
        continue;
      }

      if (element.closest('[disabled], .v-btn--disabled, .v-field--disabled')) {
        continue;
      }

      const style = getComputedStyle(element);
      const { base, opacity } = backdrop(element);
      const color = rgba(style.color);
      color.a *= opacity * Number(style.opacity);
      const ratio = contrast(over(color, base), base);

      if (ratio < minContrast) {
        results.push(`${describe(element)} "${text.slice(0, 40)}" ${ratio.toFixed(2)}`);
      }
    }

    return results;
  }, MIN_CONTRAST);
}

const pages = [
  { name: 'settings', path: 'options_page/index.html#/', ready: '.option-card-title' },
  { name: 'history', path: 'options_page/index.html#/history', ready: '.history-item' },
  { name: 'sponsors', path: 'options_page/index.html#/sponsors', ready: '#supports' },
  { name: 'download manager', path: 'options_page/downloads.html', ready: '.dataset-empty-notice' }
];

for (const { name, path, ready } of pages) {
  test(`the ${name} page's text stays readable in the dark theme`, async ({ context, extensionId }) => {
    const errors = collectErrors(context);
    const seeder = await context.newPage();
    await seeder.goto(`chrome-extension://${extensionId}/options_page/index.html`);
    // With a user and a download time, so the row shows its user link and downloaded tag.
    await seedHistory(seeder, { userName: 'someone', downloaded_at: Math.floor(Date.now() / 1000) });
    await seeder.close();

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${path}`);
    // On a fresh install the settings page also opens the changelog dialog, sponsors list and all.
    await expect(page.locator(ready).first()).toBeVisible();
    await useTheme(page, 'dark');

    expect(await unreadableText(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
}
