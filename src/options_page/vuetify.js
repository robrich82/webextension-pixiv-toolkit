import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

/**
 * `createVuetify()` on its own registers nothing -- omitting `components`/
 * `directives` here previously shipped as a silent bug where every Vuetify
 * tag rendered as an inert unresolved element, in production and in tests
 * alike. Centralized so the two entry points and the test helper can't drift
 * out of sync with each other again.
 */
export function createAppVuetify(options) {
  return createVuetify({ components, directives, ...options });
}
