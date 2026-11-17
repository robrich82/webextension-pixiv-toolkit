import browser from '@/modules/Extension/browser';
import { hasHostPermissions, requestHostPermissions } from '@/modules/Extension/hostPermissions';

/**
 * `hostPermissionsMissing` for a page's notice, kept current while the user
 * grants or revokes site access elsewhere (e.g. about:addons).
 */
export default {
  data() {
    return {
      hostPermissionsMissing: false
    };
  },

  created() {
    browser.permissions.onAdded.addListener(this.checkHostPermissions);
    browser.permissions.onRemoved.addListener(this.checkHostPermissions);
    this.checkHostPermissions();
  },

  beforeUnmount() {
    browser.permissions.onAdded.removeListener(this.checkHostPermissions);
    browser.permissions.onRemoved.removeListener(this.checkHostPermissions);
  },

  methods: {
    async checkHostPermissions() {
      this.hostPermissionsMissing = !(await hasHostPermissions());
    },

    grantHostPermissions() {
      return requestHostPermissions().then(() => this.checkHostPermissions());
    }
  }
};
