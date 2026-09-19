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
          Import progress: {{ importCount - importItems.length }} / {{ importCount }}
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
import RendererPort from '@/modules/Ports/IllustHistoryPort/RendererPort';

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
      importItems: [],
      importCount: 0,
      maxHistoryItems: 10000,
      workCoverSize: 1,
      visitHistoryPort: null
    };
  },

  created() {
    this.visitHistoryPort = RendererPort.getInstance();
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
      return Math.floor((this.importCount - this.importItems.length) / this.importCount * 100);
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
    clearHistory() {
      this.visitHistoryPort.clearHistory();
      this.confirmDialog = false;
    },

    exportVisitHistory() {
      if (this.exporting || this.importing) {
        return
      }

      this.exporting = true;
    },

    importVisitHistoryData() {
      if (this.importItems.length > 0) {
        this.importing = true;

        let items = [];

        while (items.length < 100) {
          if (!!this.importItems[0]) {
            items.push(this.importItems[0]);
            this.importItems.splice(0, 1);
          } else {
            break;
          }
        }

        if (items.length > 0) {
          this.visitHistoryPort.saveBatchHistories({
            items
          });
        }
      } else {
        this.importing = false;
      }
    },

    importVisitHistory() {
      if (this.exporting || this.importing) {
        return
      }

      let input = document.createElement('input')
      input.type = 'file'
      input.addEventListener('change', (e) => {
        const files = e.target.files
        let fileReader = new FileReader()

        fileReader.addEventListener('load', () => {
          try {
            this.importItems = JSON.parse(fileReader.result);
            this.importVisitHistoryData();
          } catch (e) {
            this.importing = false;
            alert('Invalid import file');
          }
        });

        fileReader.addEventListener('abort', () => {
          this.importing = false;
        });

        fileReader.readAsText(files[0])
      })

      if (window.confirm(this.tl('_import_history_will_take_some_time_determine_by_how_many_history_need_to_be_imported_are_you_sure'))) {
        input.click()
      }
    },

    recoveryHistory() {
      if (!window.confirm(this.tl('_recovery_history_will_take_some_time_determine_by_how_many_history_need_to_be_recovery_are_you_sure'))) {
        return;
      }

      this.importItems = this.browserItems.historyBackup;
      this.importVisitHistoryData();
    }
  }
};
</script>
