import fs from 'fs';
import path from 'path';
import { transformManifest } from '../scripts/manifest.mjs';

const source = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/statics/manifest.json'), 'utf8'));

describe('transformManifest', () => {
  it('stamps the version for Chrome and changes nothing else', () => {
    const json = transformManifest(source, { platform: 'chrome', version: '1.2.3' });

    expect(json).toEqual({ ...source, version: '1.2.3', version_name: '1.2.3' });
  });

  it('does not mutate the source manifest', () => {
    const before = structuredClone(source);

    transformManifest(source, { platform: 'firefox', version: '1.2.3' });

    expect(source).toEqual(before);
  });

  describe('for Firefox', () => {
    const json = transformManifest(source, { platform: 'firefox', version: '1.2.3' });

    it('runs the background as event-page scripts', () => {
      expect(json.background).toEqual({ scripts: [source.background.service_worker] });
    });

    it('sets the fork add-on id and its self-hosted update manifest', () => {
      expect(json.browser_specific_settings.gecko).toEqual({
        id: 'webextension-pixiv-toolkit-fork@robrich82',
        update_url: 'https://github.com/robrich82/webextension-pixiv-toolkit/releases/latest/download/updates.json'
      });
    });

    it('opens options_ui in a tab instead of options_page', () => {
      expect(json.options_ui).toEqual({ page: source.options_page, open_in_tab: true });
      expect(json).not.toHaveProperty('options_page');
    });

    it('folds optional permissions into permissions, except downloads.shelf', () => {
      const optional = transformManifest(
        { ...source, optional_permissions: ['downloads.shelf', 'notifications'] },
        { platform: 'firefox', version: '1.2.3' }
      );

      expect(optional.permissions).toEqual([...source.permissions, 'notifications']);
      expect(optional).not.toHaveProperty('optional_permissions');
    });

    it('folds optional permissions without an options_page or a permissions list', () => {
      const { options_page, permissions, ...bare } = source;
      const json = transformManifest({ ...bare, optional_permissions: ['notifications'] }, { platform: 'firefox', version: '1.2.3' });

      expect(json.permissions).toEqual(['notifications']);
      expect(json).not.toHaveProperty('options_ui');
    });

    it('adds no permissions key when only downloads.shelf was optional', () => {
      const { permissions, ...bare } = source;
      const json = transformManifest({ ...bare, optional_permissions: ['downloads.shelf'] }, { platform: 'firefox', version: '1.2.3' });

      expect(json).not.toHaveProperty('permissions');
    });

    it('keeps version and drops version_name, even one the source sets', () => {
      const named = transformManifest({ ...source, version_name: 'x' }, { platform: 'firefox', version: '1.2.3' });

      expect(json.version).toBe('1.2.3');
      expect(json).not.toHaveProperty('version_name');
      expect(named).not.toHaveProperty('version_name');
    });
  });
});
