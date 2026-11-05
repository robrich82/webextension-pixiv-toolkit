import Adapter from '@/content_scripts/modules/Adapter';
import Detector from "./modules/Detector";
import PageFilter from "./modules/PageFilter";
import UIApplication from "./UIApplication";
import browser from "@/modules/Extension/browser";
import { RestrictedPostError } from "@/errors";

class Application {
  /**
   * @type {Application}
   */
  static instance;

  /**
   * @type {Detector}
   */
  detector;

  /**
   * @type {PageFilter}
   */
  pageFilter;

  /**
   * @type {UIApplication}
   */
  UIApp;

  /**
   * @type {Object} Current page's resource
   */
  resource;

  /**
   * @type {any}
   */
  settings;

  constructor() {
    browser.storage.local.get(null, items => {
      this.settings = items;
      this.pageFilter = new PageFilter();
      this.detector = new Detector();
      this.detector.addListener('urlchange', this.urlchangeHandler, this);
      this.detector.observeUrl();

      /**
       * Call the urlchangeHandler at the application has been initailizatied
       */
      this.urlchangeHandler(window.location.href, null);
    });

    browser.storage.onChanged.addListener(changes => {
      for (let key in changes) {
        this.settings[key] = changes[key].newValue;
      }
    });
  }

  static app() {
    if (!Application.instance) {
      Application.instance = new Application();
    }

    return Application.instance;
  }

  async urlchangeHandler(newUrl, oldUrl) {
    try {
      let data = this.pageFilter.getData(newUrl);

      const adapter = new Adapter();
      this.resource = await adapter.getResource(data.type, data.url);

      if (!this.UIApp) {
        this.UIApp = await UIApplication.createApp();
      }

      this.UIApp.loadData(data);

      browser.runtime.sendMessage({ to: 'ws', action: 'badge:activeIcon' });
    } catch (error) {
      browser.runtime.sendMessage({ to: 'ws', action: 'badge:deactiveAction' })

      this.resource = null;

      /**
       * Keep the panel up so the user can see why there's nothing to
       * download, rather than the UI just not appearing (issue #204).
       */
      if (error instanceof RestrictedPostError) {
        if (!this.UIApp) {
          this.UIApp = await UIApplication.createApp();
        }

        this.UIApp.showUnavailable('restricted');
        return;
      }

      if (this.UIApp) {
        this.UIApp.unload();
        this.UIApp = null;
      }

      console.error(error);
    }
  }
}

export default Application;

export function app() {
  return Application.app();
}
