<template>
  <div class="option-section">
    <span class="option-card-title">{{ tl('Others') }}</span>

    <v-card>
      <v-list lines="two">
        <v-list-item>
          <template #title>{{ tl('_export_settings') }}</template>
          <template #append>
            <v-btn variant="flat" @click="exportSettings">{{ tl('_export') }}</v-btn>
          </template>
        </v-list-item>

        <v-list-item>
          <template #title>{{ tl('_import_settings') }}</template>
          <template #append>
            <v-btn variant="flat" @click="importSettings">{{ tl('_import') }}</v-btn>
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
    exportSettings() {
      let blob = new Blob([JSON.stringify(this.browserItems)], {type: 'application/json'})

      let a = document.createElement('a')
      const url = URL.createObjectURL(blob)
      a.href = url
      a.download = 'pixiv_toolkit_settings-' + Date.now() + '.json'
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Deferred: revoking straight after the click can cancel the download.
      setTimeout(() => URL.revokeObjectURL(url));
    },

    importSettings() {
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
