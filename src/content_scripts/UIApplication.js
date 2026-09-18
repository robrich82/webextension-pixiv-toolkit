import '@/core/global';
import App from './components/App';
import browser from '@/modules/Extension/browser';
import I18n from '@/modules/I18n';
import SuperMixin from '@/mixins/SuperMixin';
import { createApp, h } from 'vue';
import mitt from 'mitt';

class UIApplication {
  /**
   * The mounted root component's public instance.
   * @type {import('vue').ComponentPublicInstance}
   */
  app;

  /**
   * The Vue App instance, kept separately because `unmount()` lives on it,
   * not on the mounted component instance.
   * @type {import('vue').App}
   */
  vueApp;

  /**
   * @type {HTMLElement}
   */
  container;

  createComponent() {
    return new Promise(resolve => {
      /**
       * Load settings
       */
      browser.storage.local.get(null, items => {
        let i18n = I18n.i18n(items.language, browser.i18n.getUILanguage());

        /**
         * Create app mount point
         */
        let container = document.createElement('div');

        container.id = '__ptk-app';
        container.style.position = 'fixed';
        container.style.left = '0';
        container.style.bottom = '0';
        container.style.width = '100%';
        container.style.height = '0';
        container.style.overflow = 'visible';
        // container.style.display = 'none';

        document.body.appendChild(container);

        /**
         * A bare `new Vue()` instance no longer works as an event bus under
         * Vue 3 (no `$on`/`$off`/`$emit`). This shim covers only the two
         * current callers below and `App.vue`'s single `$on` -- unlike Vue
         * 2's bus, there's no `$once`, `$off()` with no arguments is a
         * silent no-op (mitt's `all.get(undefined)`), and `$emit` forwards
         * only its first payload argument (mitt is single-payload; Vue 2's
         * `$emit` was variadic). Widen this if a future caller needs more.
         */
        const emitter = mitt();
        window.$eventBus = {
          $on: emitter.on,
          $off: emitter.off,
          $emit: emitter.emit
        };

        const vueApp = createApp({
          data() {
            return {
              globalBrowserItems: items,
              isFirefox_: navigator.userAgent.toLowerCase().indexOf('firefox') > -1
            }
          },

          beforeMount() {
            let vm = this;

            this.$browser.storage.onChanged.addListener(changes => {
              for (let key in changes) {
                vm.globalBrowserItems[key] = changes[key].newValue;

                if (key === 'language') {
                  if (changes[key].newValue === 'default') {
                    i18n.global.locale = chrome.i18n.getUILanguage().replace('-', '_');
                  } else {
                    i18n.global.locale = changes[key].newValue;
                  }
                }
              }
            });
          },

          render: () => h(App),

          methods: {
            /**
             * Load data
             * @param {{url: string, type: string}} data
             */
            loadData(data) {
              window.$eventBus.$emit('pagechange', { url: data.url, type: data.type });
            },

            /**
             * Unload
             */
            unload() {
              window.$eventBus.$emit('pagechange', null);
            },

            /**
             * Get item
             * @param {string} offset
             * @returns
             */
            getItem(offset) {
              return this.globalBrowserItems[offset];
            },
          }
        });

        vueApp.config.globalProperties.$browser = browser;
        vueApp.mixin(SuperMixin);
        vueApp.use(i18n);

        window.$extension = this.app = vueApp.mount(container);
        this.vueApp = vueApp;
        this.container = container;

        resolve();
      });
    });
  }

  /**
   * Create ui application
   * @returns {UIApplication}
   */
  static async createApp() {
    let app = new UIApplication();
    await app.createComponent();
    return app;
  }

  /**
   * Load filtered data
   * @param {{ url: string, type: string}} data
   */
  loadData(data) {
    this.app.loadData(data);
  }

  unload() {
    const $el = this.container;
    this.vueApp.unmount();
    $el.parentElement.removeChild($el);
  }
}

export default UIApplication;
