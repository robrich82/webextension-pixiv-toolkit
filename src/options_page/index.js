import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'

import '@/core/global';
import Index from './Index.vue'
import Browser from '@/modules/Browser/Browser'
import I18n from '@/modules/I18n';
import SuperMixin from '@/mixins/SuperMixin';
import { createApp, h } from 'vue'
import { createVuetify } from 'vuetify';
import moment from 'moment';
import router from './router';

try {
  (function(browser) {
    moment.locale('zh_CN', {
      months: [
        '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'
      ],
      weekdays: [
        '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'
      ],
      meridiem : function (hour, minute, isLowercase) {
        if (hour < 9) {
            return "早上";
        } else if (hour < 11 && minute < 30) {
            return "上午";
        } else if (hour < 13 && minute < 30) {
            return "中午";
        } else if (hour < 18) {
            return "下午";
        } else {
            return "晚上";
        }
      }
    });

    window.browser = browser;

    /**
     * Update browser action badge
     */
    browser.action.getBadgeText({}, function (text) {
      if (text.toLowerCase() === 'new') {
        /**
         * If badge text is 'new', remove the badge text.
         */
        browser.action.setBadgeText({
          text: ''
        });
      }
    });

    browser.storage.local.get(null, items => {
      const i18n = I18n.i18n(items.language, browser.i18n.getUILanguage());

      moment.locale(i18n.global.locale);

      const vuetify = createVuetify();

      const app = createApp({
        render: () => h(Index),

        data() {
          return {
            plusVersion: null, // deprecated
            appSettings: items,
            isFirefox_: $_browser === 'firefox'
          }
        },

        beforeMount() {
          let vm = this;

          browser.storage.onChanged.addListener((items, scope) => {
            for (let key in items) {
              vm.appSettings[key] = items[key].newValue;

              if (key === 'language') {
                if (items[key].newValue === 'default') {
                  i18n.global.locale = chrome.i18n.getUILanguage().replace('-', '_');
                } else {
                  i18n.global.locale = items[key].newValue;
                }

                moment.locale(i18n.global.locale);
              } else if (key === 'disableDownloadsShelf') {
                browser.downloads.setShelfEnabled(!items[key].newValue);
              }
            }
          });

          /**
           * Check if the extension has the downloads permission
           */
          browser.permissions.getAll(permissions => {
            let settings = {};

            if (settings.enableExtTakeOverDownloads) {
              if (permissions.permissions.indexOf('downloads') < 0) {
                browser.enableExtTakeOverDownloads = false;
                browser.storage.local.set({ enableExtTakeOverDownloads: false });
              }
            }
          });
        }
      });

      app.mixin(SuperMixin);
      app.use(router);
      app.use(i18n);
      app.use(vuetify);
      app.mount('#app-mount');
    });
  })(Browser.getBrowser());
} catch (e) {
  console.error(e);
}
