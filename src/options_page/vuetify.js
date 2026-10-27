import { createVuetify } from 'vuetify';
import {
  VAlert,
  VApp,
  VAppBar,
  VBtn,
  VCard,
  VCardActions,
  VCardText,
  VCardTitle,
  VContainer,
  VDialog,
  VDivider,
  VExpansionPanel,
  VExpansionPanelText,
  VExpansionPanelTitle,
  VExpansionPanels,
  VIcon,
  VList,
  VListItem,
  VMain,
  VMenu,
  VNavigationDrawer,
  VProgressCircular,
  VProgressLinear,
  VSelect,
  VSpacer,
  VSwitch,
  VTextField,
  VToolbar,
  VTooltip
} from 'vuetify/components';

/**
 * Only the components the options page uses, so webpack can tree-shake the
 * rest of Vuetify (#97). An unregistered tag silently renders as an inert
 * element in production; vuetifyRegistration.spec.js fails if this list
 * doesn't match the `<v-*>` tags in src.
 */
const components = {
  VAlert,
  VApp,
  VAppBar,
  VBtn,
  VCard,
  VCardActions,
  VCardText,
  VCardTitle,
  VContainer,
  VDialog,
  VDivider,
  VExpansionPanel,
  VExpansionPanelText,
  VExpansionPanelTitle,
  VExpansionPanels,
  VIcon,
  VList,
  VListItem,
  VMain,
  VMenu,
  VNavigationDrawer,
  VProgressCircular,
  VProgressLinear,
  VSelect,
  VSpacer,
  VSwitch,
  VTextField,
  VToolbar,
  VTooltip
};

export function createAppVuetify(options) {
  return createVuetify({ components, ...options });
}
