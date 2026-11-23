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
import repairMangaRenameRule from '@/config/repairMangaRenameRule';
import versionCompare from '@/modules/Util/versionCompare';

function isNumericString(value) {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
}

/**
 * The settings in a backup that can be written back. Leaves out `version`, so
 * the stored one still says which migrations have run, and keys the defaults
 * don't have. A value has to match its default's type, except that a numeric
 * string for a number setting is read as that number (`maxHistoryItems` is
 * saved as a string).
 *
 * Migrations don't run on imported values, so one that reshapes a value a
 * backup can carry needs a matching step here.
 */
function pickImportableSettings(backup) {
  const settings = {};

  Object.keys(defaultSettings).forEach(key => {
    if (key === 'version' || !(key in backup)) {
      return;
    }

    const value = backup[key];

    if (typeof value === typeof defaultSettings[key]) {
      settings[key] = value;
    } else if (typeof defaultSettings[key] === 'number' && isNumericString(value)) {
      settings[key] = Number(value);
    }
  });

  if ('mangaRenameRule' in settings) {
    settings.mangaRenameRule = repairMangaRenameRule(settings.mangaRenameRule);
  }

  return settings;
}

/**
 * update6_0_0 folds a v5 backup's naming settings into the 6.x rename rules,
 * and it can't run on an import.
 */
function isPreV6Backup(backup) {
  return typeof backup.version === 'string' && versionCompare(backup.version, '6.0.0') < 0;
}

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

        fileReader.addEventListener('load', async () => {
          try {
            const backup = JSON.parse(fileReader.result);

            if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
              alert('This file has no settings to import');
              return;
            }

            if (isPreV6Backup(backup)) {
              alert('Settings backups from before 6.0.0 cannot be imported');
              return;
            }

            const settings = pickImportableSettings(backup);

            if (Object.keys(settings).length === 0) {
              alert('This file has no settings to import');
              return;
            }

            // Only the backup's keys are written, so settings it lacks keep their current values.
            await browser.storage.local.set(settings);

            alert('Settings imported');

            window.location.reload();
          } catch (e) {
            console.error(e);
            alert('Settings could not be imported: ' + e.message);
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
