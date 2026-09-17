import browser from "@/modules/Extension/browser";
import Application from "./DownloadsApplication";

class DownloadsBootstrap {
  static __main__() {
    const application = Application.createApp();

    DownloadsBootstrap.bindEvents(application);

    DownloadsBootstrap.initialApplication(application);

    application.onBooted.call(application);
  }

  static bindableRuntimeEvents = [
    'onMessage'
  ];

  static bindEvents(bindableInstance) {
    DownloadsBootstrap.bindableRuntimeEvents.forEach(event => {
      if (typeof bindableInstance[event] === 'function') {
        browser.runtime[event].addListener(function() {
          const handlerResult = bindableInstance[event].apply(bindableInstance, arguments);

          /**
           * Only keep the message channel open when the handler actually
           * promised an async sendResponse. See background/Bootstrap.js for
           * why this must not happen unconditionally.
           */
          if (event === 'onMessage' && handlerResult === true) {
            return true;
          }
        });
      }
    });
  }

  static initialApplication(application) {
    if (typeof application.onBeforeBoot === 'function') {
      application.onBeforeBoot.call(application);
    }
  }
}

export default DownloadsBootstrap;
