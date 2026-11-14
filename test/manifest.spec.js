import fs from 'fs';
import path from 'path';
import { browserFloors, transformManifest } from '../scripts/manifest.mjs';

const source = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/statics/manifest.json'), 'utf8'));
// Not the real floors, so a transform that ignored them would fail.
const floors = { chrome: '123', firefox: '456' };

describe('browserFloors', () => {
  it('reads the minimum Chrome and Firefox versions', () => {
    expect(browserFloors(['chrome >= 111', ' firefox >= 115 '])).toEqual({ chrome: '111', firefox: '115' });
  });

  it.each(['last 2 versions', 'chrome >= 0111'])('rejects "%s", which it cannot turn into a minimum version', query => {
    expect(() => browserFloors(['firefox >= 115', query])).toThrow(`"${query}"`);
  });

  it('rejects a second query for the same browser', () => {
    expect(() => browserFloors(['chrome >= 100', 'firefox >= 115', 'chrome >= 111'])).toThrow('more than one "chrome"');
  });

  it('requires both browsers', () => {
    expect(() => browserFloors(['chrome >= 111'])).toThrow('no "firefox >= N"');
  });

  it('requires a list', () => {
    expect(() => browserFloors(undefined)).toThrow('browserslist array');
  });

  it("keeps package.json's browserslist at or above what Vuetify needs (#347)", () => {
    // @vuetify/v0 calls Array.prototype.toSorted when Vuetify starts (Chrome 110,
    // Firefox 115), and Vuetify's CSS colours use color-mix() (Chrome 111).
    const { browserslist } = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
    const { chrome, firefox } = browserFloors(browserslist);

    expect(Number(chrome)).toBeGreaterThanOrEqual(111);
    expect(Number(firefox)).toBeGreaterThanOrEqual(115);
  });
});

describe('transformManifest', () => {
  it('stamps the version and minimum Chrome version for Chrome and changes nothing else', () => {
    const json = transformManifest(source, { platform: 'chrome', version: '1.2.3', floors });

    expect(json).toEqual({ ...source, version: '1.2.3', version_name: '1.2.3', minimum_chrome_version: '123' });
  });

  it('does not mutate the source manifest', () => {
    const before = structuredClone(source);

    transformManifest(source, { platform: 'firefox', version: '1.2.3', floors });

    expect(source).toEqual(before);
  });

  describe('for Firefox', () => {
    const json = transformManifest(source, { platform: 'firefox', version: '1.2.3', floors });

    it('runs the background as event-page scripts', () => {
      expect(json.background).toEqual({ scripts: [source.background.service_worker] });
    });

    it('sets the fork add-on id, its self-hosted update manifest and the minimum Firefox version', () => {
      expect(json.browser_specific_settings.gecko).toEqual({
        id: 'webextension-pixiv-toolkit-fork@robrich82',
        update_url: 'https://github.com/robrich82/webextension-pixiv-toolkit/releases/latest/download/updates.json',
        strict_min_version: '456.0'
      });
      expect(json).not.toHaveProperty('minimum_chrome_version');
    });

    it('opens options_ui in a tab instead of options_page', () => {
      expect(json.options_ui).toEqual({ page: source.options_page, open_in_tab: true });
      expect(json).not.toHaveProperty('options_page');
    });

    it('folds optional permissions into permissions, except downloads.shelf', () => {
      const optional = transformManifest(
        { ...source, optional_permissions: ['downloads.shelf', 'notifications'] },
        { platform: 'firefox', version: '1.2.3', floors }
      );

      expect(optional.permissions).toEqual([...source.permissions, 'notifications']);
      expect(optional).not.toHaveProperty('optional_permissions');
    });

    it('folds optional permissions without an options_page or a permissions list', () => {
      const { options_page, permissions, ...bare } = source;
      const json = transformManifest({ ...bare, optional_permissions: ['notifications'] }, { platform: 'firefox', version: '1.2.3', floors });

      expect(json.permissions).toEqual(['notifications']);
      expect(json).not.toHaveProperty('options_ui');
    });

    it('adds no permissions key when only downloads.shelf was optional', () => {
      const { permissions, ...bare } = source;
      const json = transformManifest({ ...bare, optional_permissions: ['downloads.shelf'] }, { platform: 'firefox', version: '1.2.3', floors });

      expect(json).not.toHaveProperty('permissions');
    });

    it('keeps version and drops version_name, even one the source sets', () => {
      const named = transformManifest({ ...source, version_name: 'x' }, { platform: 'firefox', version: '1.2.3', floors });

      expect(json.version).toBe('1.2.3');
      expect(json).not.toHaveProperty('version_name');
      expect(named).not.toHaveProperty('version_name');
    });
  });
});
