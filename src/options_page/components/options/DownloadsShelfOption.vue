<template>
  <v-list-item>
    <template #title>{{ tl('_disable_downloads_shelf') }}</template>
    <template #append>
      <v-switch v-model="disableDownloadsShelf"
        @update:model-value="onDisableDownloadsShelf"></v-switch>
    </template>
  </v-list-item>
</template>

<script>
export default {
  data() {
    return {
      disableDownloadsShelf: false,
    };
  },

  watch: {
    disableDownloadsShelf(val) {
      this.updateSettings({ disableDownloadsShelf: !!val });
    }
  },

  created() {
    this.disableDownloadsShelf = !!this.browserItems.disableDownloadsShelf;

    /**
     * If disableDownloadsShelf option value if true, then should check the browser has the necessary permissions.
     */
    if (this.browserItems.disableDownloadsShelf) {
      browser.permissions.contains({
        permissions: ['downloads', 'downloads.shelf']
      }, result => {
        this.disableDownloadsShelf = !!result;

        this.updateSettings({ disableDownloadsShelf: false });
      });
    }
  },

  methods: {
    updateSettings(settings) {
      browser.storage.local.set(settings);
    },

    onDisableDownloadsShelf(val) {
      if (val === true) {
        browser.permissions.request({
          permissions: ['downloads', 'downloads.shelf']
        }, result => {
          this.disableDownloadsShelf = !!result;
        });
      } else {
        this.disableDownloadsShelf = false;
      }
    }
  }
}
</script>
