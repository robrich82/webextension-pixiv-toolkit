<template>
  <div class="option-section">
    <v-list lines="two">
      <v-list-item>
        <template #title>{{ tl('_page_number_start_with_1') }}</template>
        <template #subtitle>{{ tl('_page_number_start_with_1_otherwise_start_with_0') }}</template>
        <template #append>
          <v-select :items="pageNumberStartWithOneOptions"
            item-title="text"
            item-value="value"
            v-model="pageNumberStartWithOne"
            style="width:150px;"
          ></v-select>
        </template>
      </v-list-item>

      <v-list-item>
        <template #title>{{ tl('_the_length_of_page_number') }}</template>
        <template #subtitle>{{ tl('_zeros_will_be_filled_at_the_beginning_of_page_number') }}</template>
        <template #append>
          <v-select :items="pageNumberLengthOptions"
            item-title="text"
            item-value="value"
            v-model="pageNumberLength"
            style="width:150px;"
          ></v-select>
        </template>
      </v-list-item>

      <DownloadSaveMode />

      <ZipDownloads />

      <DontCreateWorkFolder />

      <CombineRenameRules />
    </v-list>
  </div>
</template>

<script>
import DownloadSaveMode from './option-items/DownloadSaveMode.vue';
import ZipDownloads from './option-items/ZipDownloads.vue';
import DontCreateWorkFolder from './option-items/DontCreateWorkFolder.vue';
import CombineRenameRules from './option-items/CombineRenameRules.vue';

export default {
  name: 'global-task-setting',

  components: {
    DownloadSaveMode,
    ZipDownloads,
    DontCreateWorkFolder,
    CombineRenameRules
  },

  data() {
    return {
      pageNumberStartWithOne: 0,
      pageNumberLength: 0,
      combinWRRuleAndIRRuleWhenDontCreateWorkFolder: 0
    };
  },

  computed: {
    pageNumberLengthOptions() {
      return [{
        text: this.tl('_disable'),
        value: 0,
      }, {
        text: this.tl('_dynamic'),
        value: -1,
      }, {
        text: '2',
        value: 2
      }, {
        text: '3',
        value: 3
      }, {
        text: '4',
        value: 4
      }];
    },

    pageNumberStartWithOneOptions() {
      return [{
        text: this.tl('_enable'),
        value: 1,
      }, {
        text: this.tl('_disable'),
        value: 0,
      }]
    }
  },

  watch: {
    pageNumberStartWithOne(val) {
      browser.storage.local.set({
        globalTaskPageNumberStartWithOne: val
      });
    },

    pageNumberLength(val) {
      browser.storage.local.set({
        globalTaskPageNumberLength: val
      });
    },

    combinWRRuleAndIRRuleWhenDontCreateWorkFolder(val) {
      browser.storage.local.set({
        combinWRRuleAndIRRuleWhenDontCreateWorkFolder: val
      });
    }
  },

  created() {
    this.pageNumberStartWithOne = this.browserItems.globalTaskPageNumberStartWithOne;
    this.pageNumberLength = this.browserItems.globalTaskPageNumberLength;
    this.combinWRRuleAndIRRuleWhenDontCreateWorkFolder = this.browserItems.combinWRRuleAndIRRuleWhenDontCreateWorkFolder;
  },
};
</script>
