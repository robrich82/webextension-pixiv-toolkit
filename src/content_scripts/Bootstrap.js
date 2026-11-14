import Application from "./Application";
import browser from "@/modules/Extension/browser";

/**
 * Bootstrap
 * @class
 */
class Bootstrap {
  /**
   * Boot the application and expose the application instance to window scope
   */
  boot() {
    window.$app = Application.app();
    window.$settings = window.$app.settings;

    browser.runtime.onConnect.addListener((port) => {
      port.onMessage.addListener(message => {
        if (message.type === 'fetch-info' && window.$app.resource) {
          port.postMessage({ info: window.$app.resource.unpack() });
        }
      });
    });
  }
}

export default Bootstrap;
