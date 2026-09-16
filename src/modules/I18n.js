import { createI18n } from 'vue-i18n';
import locales from 'locales';

export default class I18n {
  static i18n(locale, fallback = null) {
    if (locale) {
      locale = locale.replace('-', '_');
    }

    if (fallback) {
      fallback = fallback.replace('-', '_');
    }

    /**
     * `legacy: true` keeps `this.$t()` working for every existing Options-API
     * component (see SuperMixin.tl()) instead of requiring the Composition
     * API. Deprecated as of vue-i18n 11, removed in 12 -- revisit if/when
     * this project upgrades past 11.
     */
    let i18n = createI18n({
      legacy: true,
      locale: (!locale || locale === 'default') ? (fallback || 'en') : locale,
      messages: {
        en: locales.localeEn,
        'zh_CN': locales.localeZhCN
      }
    });

    return i18n;
  }
}
