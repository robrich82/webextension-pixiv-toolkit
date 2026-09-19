<template>
  <div class="option-section">
    <span class="option-card-title">{{ tl('Others') }}</span>

    <v-card>
      <v-list lines="two">
        <v-list-item>
          <template #title>{{ tl('_export_settings') }}</template>
          <template #append>
            <v-menu
              open-on-hover
              location="top"
            >
              <template
                v-slot:activator="{ props }"
              >
                <v-btn
                  variant="flat"
                  v-bind="props"
                >{{ tl('_export') }}</v-btn>
              </template>
              <v-list>
                <v-list-item
                  @click="exportSettings"
                >{{ tl('_all_settings') }}</v-list-item>
                <v-list-item
                  @click="exportSettings({ excludeHistoryBackup: true })"
                >{{ tl('_exclude_history_backup') }}</v-list-item>
              </v-list>
            </v-menu>
          </template>
        </v-list-item>

        <v-list-item>
          <template #title>{{ tl('_import_settings') }}</template>
          <template #append>
            <v-menu
              open-on-hover
              location="top"
            >
              <template
                v-slot:activator="{ props }"
              >
                <v-btn
                  variant="flat"
                  v-bind="props"
                >{{ tl('_import') }}</v-btn>
              </template>
              <v-list>
                <v-list-item
                  @click="importSettings({})"
                >{{ tl('_all_settings') }}</v-list-item>
                <v-list-item
                  @click="importSettings({ excludeHistoryBackup: true })"
                >{{ tl('_exclude_history_backup') }}</v-list-item>
              </v-list>
            </v-menu>
          </template>
        </v-list-item>
      </v-list>

      <v-list lines="two">
        <v-list-item>
          <template #title>{{ tl('Reload_extension') }}</template>
          <template #subtitle>{{ tl('Reload_extension_if_there_is_something_wrong') }}</template>
          <template #append>
            <v-btn variant="flat" @click="reload">{{ tl('Reload') }}</v-btn>
          </template>
        </v-list-item>
      </v-list>

      <v-list lines="two">
        <v-list-item>
          <template #title>{{ tl('_diagnosis_messages') }}</template>
          <template #append>
            <v-btn variant="flat" @click="viewDiagnosis">{{ tl('_view') }}</v-btn>
          </template>
        </v-list-item>
      </v-list>
    </v-card>
  </div>
</template>

<script>
import defaultSettings from '@/config/default';

export default {
  methods: {
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
    },

    importSettings({ excludeHistoryBackup = false }) {
      let input = document.createElement('input');

      input.type = 'file'
      input.addEventListener('change', (e) => {
        const files = e.target.files

        let fileReader = new FileReader()

        fileReader.addEventListener('load', () => {
          try {
            let importSettings = JSON.parse(fileReader.result);

            if (importSettings) {
              let setting;

              Object.keys(defaultSettings).forEach(key => {
                if (excludeHistoryBackup && key === 'historyBackup') {
                  return;
                }

                if (key in importSettings &&
                  (typeof defaultSettings[key] === typeof importSettings[key] || typeof importSettings[key] === 'string')
                ) {
                  defaultSettings[key] = importSettings[key];
                }
              });

              browser.storage.local.set(defaultSettings);

              alert('Settings imported');

              window.location.reload();
            }
          } catch (e) {
            console.log(e)
          }
        });

        fileReader.readAsText(files[0])
      });

      input.click();
    },


    reload() {
      browser.runtime.reload();
    },

    viewDiagnosis() {
      this.$router.push({ name: 'DiagnosisMessages'});
    }
  }
};
</script>
