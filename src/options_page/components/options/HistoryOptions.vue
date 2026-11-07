<template>
  <div class="option-section">
    <span class="option-card-title">{{ tl('History') }}</span>

    <v-card>
      <v-list lines="two">
        <v-list-item>
          <template #title>{{ tl('Enable_save_visit_history') }}</template>
          <template #append>
            <v-switch v-model="enableSaveVisitHistory"></v-switch>
          </template>
        </v-list-item>

        <v-list-item>
          <template #title>{{ tl('_enable_save_download_history') }}</template>
          <template #append>
            <v-select
              :items="[{
                text: this.tl('_enable'),
                value: 1
              }, {
                text: this.tl('_show_in_work_only'),
                value: 2
              }, {
                text: this.tl('_disable'),
                value: 0
              }]"
              item-title="text"
              item-value="value"
              v-model="enableSaveDownloadHistory"
              style="width:150px;"
            ></v-select>
          </template>
        </v-list-item>

        <v-list-item>
          <template #title>{{ tl('Do_not_save_NSFW_work_to_history') }}</template>
          <template #append>
            <v-switch v-model="notSaveNSFWWorkInHistory" :disabled="!enableSaveVisitHistory"></v-switch>
          </template>
        </v-list-item>

        <v-list-item>
          <template #title>{{ tl('_display_work_type_label') }}</template>
          <template #append>
            <v-switch
              v-model="displayWorkTypeLabel"
            ></v-switch>
          </template>
        </v-list-item>

        <v-list-item>
          <template #title>{{ tl('_cover_size') }}</template>
          <template #append>
            <v-select
              :items="[{
                text: this.tl('_small'),
                value: 1
              }, {
                text: this.tl('_normal'),
                value: 2
              }, {
                text: this.tl('_large'),
                value: 3
              }]"
              item-title="text"
              item-value="value"
              v-model="workCoverSize"
              style="width:150px;"
            ></v-select>
          </template>
        </v-list-item>

        <v-list-item>
          <template #title>{{ tl('_max_history_items') }}</template>
          <template #subtitle>{{ tl('_reload_to_apply_change') }}</template>
          <template #append>
            <v-text-field
              v-model="maxHistoryItems"
              reverse
              type="number"
              style="width:100px;"
            ></v-text-field>
          </template>
        </v-list-item>

        <v-list-item>
          <template #title>{{ tl('Export_visit_history') }}</template>
          <template #append>
            <v-btn
              variant="flat"
              @click="exportVisitHistory"
            >{{ tl('_export') }}</v-btn>
          </template>
        </v-list-item>

        <v-list-item>
          <template #title>{{ tl('Import_visit_history') }}</template>
          <template #append>
            <v-btn
              variant="flat"
              @click="importVisitHistory"
            >{{ tl('_import') }}</v-btn>
          </template>
        </v-list-item>

        <v-list-item>
          <template #title>{{ tl('_recovery_history') }} ({{ tl('_total_backup') }}: {{ historyBackupCount }})</template>
          <template #append>
            <v-btn
              variant="flat"
              @click="recoveryHistory"
            >{{ tl('_recovery') }}</v-btn>
          </template>
        </v-list-item>

        <v-list-item>
          <template #title>{{ tl('clear_history_data') }}</template>
          <template #subtitle>{{ tl('clear_history_data_cannot_be_reversed') }}</template>
          <template #append>
            <v-btn
              variant="flat"
              @click="confirmDialog = true"
            >{{ tl('_clear') }}</v-btn>
          </template>
        </v-list-item>
      </v-list>
    </v-card>

    <v-dialog v-model="confirmDialog" width="500">
      <v-card>
        <v-card-title>{{ tl('clear_history_data') }}</v-card-title>
        <v-card-text>
          <p style="font-size:14px;">{{ tl('_this_operation_cannot_be_reversed_are_you_sure') }}</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="clearHistory" color="error">{{ tl('_clear') }}</v-btn>
          <v-btn @click="confirmDialog = false">{{ tl('_cancel') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      v-model="importing"
      width="250"
      persistent="true"
    >
      <v-card
        color="primary"
        dark
      >
        <v-card-text
          style="font-size:14px"
        >
          Import progress: {{ importedCount }} / {{ importCount }}
          <v-progress-linear
            v-model="importProgress"
            color="white"
          ></v-progress-linear>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script>
import browser from '@/modules/Extension/browser';

/**
 * Entries per `history:importItems` message, so the progress bar moves and no
 * single message carries a whole export file.
 */
const IMPORT_BATCH_SIZE = 500;

export default {
  data() {
    return {
      enableSaveVisitHistory: true,
      enableSaveDownloadHistory: true,
      displayWorkTypeLabel: true,
      notSaveNSFWWorkInHistory: false,
      confirmDialog: false,
      importing: false,
      exporting: false,
      importedCount: 0,
      importCount: 0,
      maxHistoryItems: 10000,
      workCoverSize: 1
    };
  },

  beforeMount() {
    this.enableSaveVisitHistory = this.browserItems.enableSaveVisitHistory;
    this.enableSaveDownloadHistory = this.browserItems.enableSaveDownloadHistory;
    this.displayWorkTypeLabel = this.browserItems.displayWorkTypeLabel;
    this.notSaveNSFWWorkInHistory = this.browserItems.notSaveNSFWWorkInHistory;
    this.maxHistoryItems = this.browserItems.maxHistoryItems;
    this.workCoverSize = this.browserItems.workCoverSize;
  },

  computed: {
    historyBackupCount() {
      return this.browserItems.historyBackup ? this.browserItems.historyBackup.length : 0;
    },

    importProgress() {
      return this.importCount > 0 ? Math.floor(this.importedCount / this.importCount * 100) : 0;
    }
  },

  watch: {
    enableSaveVisitHistory(val) {
      browser.storage.local.set({
        enableSaveVisitHistory: !!val
      });
    },

    enableSaveDownloadHistory(val) {
      browser.storage.local.set({
        enableSaveDownloadHistory: val
      });
    },

    displayWorkTypeLabel(val) {
      browser.storage.local.set({
        displayWorkTypeLabel: !!val
      });
    },

    notSaveNSFWWorkInHistory(val) {
      browser.storage.local.set({
        notSaveNSFWWorkInHistory: !!val
      });
    },

    maxHistoryItems(val) {
      if (/^\d+$/.test(val) && val > 0) {
        browser.storage.local.set({
          maxHistoryItems: val
        });
      } else {
        this.maxHistoryItems = 10000;
      }
    },

    workCoverSize(val) {
      browser.storage.local.set({
        workCoverSize: val - 0
      });
    }
  },

  methods: {
    async clearHistory() {
      this.confirmDialog = false;

      let cleared;

      try {
        cleared = await browser.runtime.sendMessage({ to: 'ws', action: 'history:clear' });
      } catch (error) {
        console.error('Unable to clear history', error);
      }

      if (cleared !== true) {
        alert(this.tl('_unknown_error'));
      }
    },

    exportVisitHistory() {
      if (this.exporting || this.importing) {
        return
      }

      this.exporting = true;
    },

    /**
     * Sends the entries to the background in batches.
     *
     * @param {Array} items plain objects: Firefox can't clone a reactive proxy
     * @returns {Promise<number>} how many entries were imported
     */
    async importHistoryItems(items) {
      let imported = 0;

      this.importing = true;
      this.importCount = items.length;
      this.importedCount = 0;

      try {
        for (let i = 0; i < items.length; i += IMPORT_BATCH_SIZE) {
          let batch = items.slice(i, i + IMPORT_BATCH_SIZE);
          let result = await browser.runtime.sendMessage({
            to: 'ws',
            action: 'history:importItems',
            args: { items: batch }
          });

          if (!result) {
            throw new Error('The background did not answer history:importItems');
          }

          imported += result.imported;
          this.importedCount += batch.length;
        }
      } finally {
        this.importing = false;
      }

      return imported;
    },

    /**
     * Imports a file, and tells the user when nothing in it was usable.
     *
     * @param {Array} items
     */
    async importAndReport(items) {
      try {
        if (await this.importHistoryItems(items) === 0) {
          alert('Invalid import file');
        }
      } catch (error) {
        console.error('Unable to import history', error);
        alert(this.tl('_unknown_error'));
      }
    },

    importVisitHistory() {
      if (this.exporting || this.importing) {
        return
      }

      let input = document.createElement('input')
      input.type = 'file'
      input.addEventListener('change', async (e) => {
        let items;

        try {
          items = JSON.parse(await e.target.files[0].text());
        } catch (error) {
          items = null;
        }

        if (!Array.isArray(items)) {
          alert('Invalid import file');
          return;
        }

        await this.importAndReport(items);
      })

      if (window.confirm(this.tl('_import_history_will_take_some_time_determine_by_how_many_history_need_to_be_imported_are_you_sure'))) {
        input.click()
      }
    },

    async recoveryHistory() {
      if (this.importing) {
        return;
      }

      if (!window.confirm(this.tl('_recovery_history_will_take_some_time_determine_by_how_many_history_need_to_be_recovery_are_you_sure'))) {
        return;
      }

      let backup = JSON.parse(JSON.stringify(this.browserItems.historyBackup || []));

      if (backup.length > 0) {
        await this.importAndReport(backup);
      }
    }
  }
};
</script>
