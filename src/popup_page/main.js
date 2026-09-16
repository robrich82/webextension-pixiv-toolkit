import '@/core/global';
import App from './App';
import Browser from '@/modules/Browser/Browser';
import I18n from '@/modules/I18n';
import { createApp, h } from 'vue';

window.browser = Browser.getBrowser();

browser.storage.local.get(null, items => {
  const i18n = I18n.i18n(items.language, browser.i18n.getUILanguage());

  const app = createApp({
    render: () => h(App),

    data() {
      return {
        appSettings: items
      }
    },

    beforeMount() {
      let vm = this;

      browser.storage.onChanged.addListener((items) => {
        for (let key in items) {
          vm.appSettings[key] = items[key].newValue;
        }
      });
    }
  });

  app.use(i18n);
  app.mount('#app');
});
