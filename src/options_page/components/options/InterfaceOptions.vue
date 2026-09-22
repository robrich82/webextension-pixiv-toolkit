<template>
  <div class="option-section">
    <span class="option-card-title">{{ tl('_interface') }}</span>

    <v-card>
      <v-list lines="two">
        <v-list-item>
          <template #title>{{ tl('_language') }}</template>
          <template #append>
            <v-select
              :items="languageOptions"
              item-title="text"
              item-value="value"
              v-model="language"
              @update:model-value="onLanguageChangeHandler"
              style="width:150px"
            >
            </v-select>
          </template>
        </v-list-item>
      </v-list>

      <v-list lines="two">
        <v-list-item>
          <template #title>{{ tl('Activate_download_panel_automatically') }}</template>
          <template #subtitle>{{ tl('Download_panel_will_show_up_automatically_when_page_loaded') }}</template>
          <template #append>
            <v-switch v-model="autoActivateDownloadPanel"></v-switch>
          </template>
        </v-list-item>
      </v-list>

      <v-list lines="two">
        <v-list-item>
          <template #title>{{ tl('_download_panel_position') }}</template>
          <template #append>
            <v-select :items="downloadPanelPositionOptions"
              item-title="text"
              item-value="value"
              v-model="downloadPanelPosition"
              @update:model-value="onDownloadPanelPositionChangeHandler"
              style="width:150px"
            ></v-select>
          </template>
        </v-list-item>
      </v-list>

      <v-list lines="two">
        <v-list-item>
          <template #title>{{ tl('_download_panel_style') }}</template>
          <template #append>
            <v-select :items="downloadPanelStyleOptions"
              item-title="text"
              item-value="value"
              v-model="downloadPanelStyle"
              @update:model-value="onDownloadPanelStyleChangeHandler"
              style="width:150px"
            ></v-select>
          </template>
        </v-list-item>
      </v-list>

      <v-list lines="two">
        <v-list-item>
          <template #title>{{ tl('_show') }} Pixiv Omina</template>
          <template #append>
            <v-switch v-model="showPixivOmina"></v-switch>
          </template>
        </v-list-item>
      </v-list>

      <v-list lines="two">
        <v-list-item>
          <template #title>{{ tl('_show_reload_in_popup') }}</template>
          <template #append>
            <v-switch v-model="showReloadInPopup"></v-switch>
          </template>
        </v-list-item>
      </v-list>
    </v-card>
  </div>
</template>

<script>
import defaultSettings from '@/config/default';
import browser from '@/modules/Extension/browser';

export default {
  data() {
    return {
      autoActivateDownloadPanel: false,

      language: 'en',

      downloadPanelStyle: 1,

      downloadPanelPosition: 'center',

      showReloadInPopup: false,

      showPixivOmina: true,
    };
  },

  computed: {
    languageOptions() {
      return [
        {
          text: this.tl('_default'),
          value: 'default'
        }, {
          text: '简体中文',
          value: 'zh_CN',
        }, {
          text: 'English',
          value: 'en'
        }
      ];
    },

    downloadPanelPositionOptions() {
      return [
        {
          text: this.tl('_center'),
          value: 'center'
        }, {
          text: this.tl('_left'),
          value: 'left'
        }, {
          text: this.tl('_right'),
          value: 'right'
        }
      ]
    },

    downloadPanelStyleOptions() {
      return [
        {
          text: this.tl('_type') + ' 1',
          value: 1
        }, {
          text: this.tl('_type') + ' 2',
          value: 2
        }
      ]
    }
  },

  beforeMount() {
    this.autoActivateDownloadPanel = this.browserItems.autoActivateDownloadPanel;
    this.language = this.browserItems.language || 'default';
    this.downloadPanelPosition = this.browserItems.downloadPanelPosition;
    this.downloadPanelStyle = this.browserItems.downloadPanelStyle;
    this.showReloadInPopup = this.browserItems.showReloadInPopup;
    this.showPixivOmina = this.browserItems.showPixivOmina;
  },

  watch: {
    autoActivateDownloadPanel(val) {
      browser.storage.local.set({
        autoActivateDownloadPanel: !!val
      });
    },

    showReloadInPopup(val) {
      browser.storage.local.set({
        showReloadInPopup: val
      });
    },

    showPixivOmina(val) {
      browser.storage.local.set({
        showPixivOmina: val
      });
    }
  },

  methods: {
    onLanguageChangeHandler(val) {
      browser.storage.local.set({
        language: val
      });
    },

    onDownloadPanelPositionChangeHandler(val) {
      browser.storage.local.set({
        downloadPanelPosition: val
      });
    },

    onDownloadPanelStyleChangeHandler(val) {
      browser.storage.local.set({
        downloadPanelStyle: parseInt(val)
      });
    },

    exportSettings({ excludeHistoryBackup = false }) {
      let settings = Object.assign({}, this.browserItems);

      if (excludeHistoryBackup) {
        delete settings.historyBackup;
      }

      let blob = new Blob([JSON.stringify(settings)], {type: 'application/json'})

      let a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'pixiv_toolkit_settings-' + Date.now() + '.json'
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }
};
</script>
