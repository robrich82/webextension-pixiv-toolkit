import browser from "@/modules/Extension/browser";
import Application from "./Application";

class Bootstrap {
  static initializeApplication(application) {
    Bootstrap.emitBeforeBoot(application);

    Bootstrap.bindEvents(application);
  }

  static bindableRuntimeEvents = [
    'onConnect', 'onInstalled', 'onMessage', 'onRestartRequired',
    'onStartup', 'onSuspend', 'onSuspendCanceled', 'onUpdateAvailable',
  ];

  static bindEvents(bindableInstance) {
    Bootstrap.bindableRuntimeEvents.forEach(event => {
      if (typeof bindableInstance[event] !== 'function') return;

      /**
       * Not every runtime event exists on every browser (e.g. Firefox has no
       * runtime.onRestartRequired). Skip it instead of throwing, which would
       * otherwise abort binding of every event still left in the loop.
       */
      if (!browser.runtime[event]) {
        console.warn(`runtime.${event} is not supported by this browser; handler not bound`);
        return;
      }

      browser.runtime[event].addListener(function() {
        const handlerResult = bindableInstance[event].apply(bindableInstance, arguments);

        /**
         * Only keep the message channel open when the handler actually
         * promised an async sendResponse (Application.onMessage returns
         * true for messages it routes). Doing this unconditionally kept the
         * channel open for every message this listener ignored too, which is
         * what eventually raised "Promised response from onMessage listener
         * went out of scope".
         */
        if (event === 'onMessage' && handlerResult === true) {
          return true;
        }
      });
    });
  }

  static emitBeforeBoot(application) {
    if (typeof application.onBeforeBoot === 'function') {
      application.onBeforeBoot.call(application);
    }
  }

  static boot(application) {
    if (typeof application.onBooted === 'function') {
      application.onBooted.call(application);
    }
  }
}

const application = Application.createApp();

Bootstrap.initializeApplication(application);

self.oninstall = () => {
  Bootstrap.boot(application);

  self.application = application;
};
