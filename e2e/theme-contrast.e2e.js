const { test, expect, collectErrors, seedHistory } = require('./fixtures');

// Lowest text contrast allowed. Dark gets WCAG's 3:1 for large text. Light keeps the pages'
// original #999 greys (about 2.6-2.85:1), so its floor only catches a mis-mapped colour.
const MIN_CONTRAST = { dark: 3, light: 2.5 };

const SPONSORS = [{ name: 'level one', level: 1 }, { name: 'level three', level: 3 }];

/**
 * Wait for transitions, CSS and scripted (Vuetify's dialogs), to settle. Spinners never finish.
 * @param {import('@playwright/test').Page} page
 */
async function settle(page) {
  await page.evaluate(() => Promise.allSettled(document.getAnimations()
    .filter(animation => animation.effect?.getComputedTiming().endTime !== Infinity)
    .map(animation => animation.finished)));
}

/**
 * Every visible piece of text, form value, placeholder and SVG icon whose contrast with what is
 * painted behind it is under `minContrast`, as `selector "text" ratio`.
 * @param {import('@playwright/test').Page} page
 * @param {number} minContrast
 */
function unreadableText(page, minContrast) {
  return page.evaluate(minContrast => {
    const canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const UNSET = '#010203';

    // The canvas resolves any CSS colour (color-mix, color(srgb …)) to 8-bit sRGB.
    const rgba = color => {
      canvas.clearRect(0, 0, 1, 1);
      canvas.fillStyle = UNSET;
      canvas.fillStyle = color;

      if (canvas.fillStyle === UNSET) {
        throw new Error(`The canvas can't parse the colour ${color}`);
      }

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

    // What shows where no element has an opaque background: dark under a dark color-scheme.
    const probe = document.body.appendChild(document.createElement('div'));
    probe.style.background = 'Canvas';
    const pageCanvas = rgba(getComputedStyle(probe).backgroundColor);
    probe.remove();

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

      return { base: layers.reduceRight((below, layer) => over(layer, below), pageCanvas), opacity };
    };

    const TEXT_INPUTS = ['text', 'number', 'search', 'url', 'email'];

    // The text an element paints itself, and its colour.
    const ownText = element => {
      if (element.localName === 'textarea' || (element.localName === 'input' && TEXT_INPUTS.includes(element.type))) {
        return element.value
          ? { text: element.value, color: getComputedStyle(element).color }
          : { text: element.placeholder, color: getComputedStyle(element, '::placeholder').color };
      }

      if (element.localName === 'svg') {
        const fill = getComputedStyle(element.querySelector('path') ?? element).fill;

        return { text: fill === 'none' ? '' : 'svg icon', color: fill };
      }

      const text = [...element.childNodes]
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent.trim())
        .join(' ')
        .trim();

      return { text, color: getComputedStyle(element).color };
    };

    const describe = element => {
      const id = element.id ? `#${element.id}` : '';
      const classes = [...element.classList].slice(0, 2).map(name => `.${name}`).join('');

      return `${element.localName}${id}${classes}`;
    };

    // Vuetify's disabled text sits below 3:1 by design.
    const disabled = '[disabled], .v-btn--disabled, .v-field--disabled, .v-input--disabled, '
      + '.v-selection-control--disabled, .v-list-item--disabled';
    const results = [];

    for (const element of document.querySelectorAll('body *')) {
      if (element.closest('svg') && element.localName !== 'svg') {
        continue;
      }

      const { text, color: textColor } = ownText(element);

      if (!text || !element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) {
        continue;
      }

      if (element.closest(disabled)) {
        continue;
      }

      const { base, opacity } = backdrop(element);
      const color = rgba(textColor);
      color.a *= opacity * Number(getComputedStyle(element).opacity);
      const ratio = contrast(over(color, base), base);

      if (ratio < minContrast) {
        results.push(`${describe(element)} "${text.slice(0, 40)}" ${ratio.toFixed(2)}`);
      }
    }

    return results;
  }, minContrast);
}

/**
 * Close the changelog dialog a fresh install opens on the settings pages, once it has been measured.
 * @param {import('@playwright/test').Page} page
 */
async function closeChangelog(page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

// AppSuggest only shows on Windows x64 (Index.vue), so CI on Linux never measures it.
const pages = [
  {
    name: 'settings',
    path: 'options_page/index.html#/',
    // The changelog dialog carries the sponsors list too.
    ready: ['.option-card-title', '.v-overlay .sponsor'],
    async more(page, measure) {
      await closeChangelog(page);
      const titles = page.locator('.v-expansion-panel-title');

      // One panel opens at a time.
      for (let i = 0; i < await titles.count(); i++) {
        await titles.nth(i).click();
        await settle(page);
        await measure(`with "${(await titles.nth(i).innerText()).trim()}" open`);
      }
    }
  },
  {
    name: 'history',
    path: 'options_page/index.html#/history',
    ready: ['.history-item'],
    async more(page, measure) {
      await closeChangelog(page);
      await page.locator('.history-item').first().hover();
      await settle(page);
      await measure('with a row hovered');
    }
  },
  { name: 'sponsors', path: 'options_page/index.html#/sponsors', ready: ['.v-main .sponsor'] },
  { name: 'download manager', path: 'options_page/downloads.html', ready: ['.dataset-empty-notice'] }
];

for (const theme of ['dark', 'light']) {
  for (const { name, path, ready, more } of pages) {
    test(`the ${name} page's text is readable in the ${theme} theme`, async ({ context, extensionId }) => {
      const errors = collectErrors(context);
      await context.route(/^https?:\/\//, route => (route.request().url().endsWith('/sponsors.json')
        ? route.fulfill({ json: SPONSORS })
        : route.abort()));
      const seeder = await context.newPage();
      await seeder.goto(`chrome-extension://${extensionId}/options_page/index.html`);
      // Downloaded, so the row shows its downloaded tag.
      await seedHistory(seeder, { downloaded_at: Math.floor(Date.now() / 1000) });
      await seeder.close();

      const page = await context.newPage();
      // The pages follow the OS preference.
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`chrome-extension://${extensionId}/${path}`);
      await expect(page.locator('.v-application')).toHaveClass(new RegExp(`v-theme--${theme}`));

      for (const selector of ready) {
        await expect(page.locator(selector).first()).toBeVisible();
      }

      await settle(page);

      const unreadable = [];
      const measure = async state => {
        for (const line of await unreadableText(page, MIN_CONTRAST[theme])) {
          unreadable.push(`${line} (${state})`);
        }
      };

      await measure('as loaded');
      // White pills on the blue app bar in both themes: the GitHub mark is black.
      for (const button of await page.locator('.support-btn').all()) {
        await expect(button).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      }
      await more?.(page, measure);

      expect(unreadable).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

test('the settings page follows the OS preference as it changes', async ({ context, extensionId }) => {
  const errors = collectErrors(context);
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`chrome-extension://${extensionId}/options_page/index.html#/`);
  await expect(page.locator('.v-application')).toHaveClass(/v-theme--light/);

  await page.emulateMedia({ colorScheme: 'dark' });

  await expect(page.locator('.v-application')).toHaveClass(/v-theme--dark/);
  expect(errors).toEqual([]);
});
