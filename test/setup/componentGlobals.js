/**
 * Runs after extensionGlobals.js, only for specs under test/components/.
 *
 * @vue/test-utils@1 logs a "you should use `sync: false`" deprecation notice
 * and mount() attaches nothing to document.body by default, both of which are
 * fine for these specs; Vue itself just needs the production tip silenced so
 * it doesn't clutter every run.
 */
import Vue from 'vue';

Vue.config.productionTip = false;
