<script>
import browser from '@/modules/Extension/browser';

export default {
  name: 'CombineRenameRules',

  data() {
    return {
      showThis: false,
      value: 0
    }
  },

  computed: {
    options() {
      return [
        { text: this.tl('_enable'), value: 1 },
        { text: this.tl('_disable'), value: 0}
      ]
    }
  },

  watch: {
    value(val) {
      browser.storage.local.set({ combinWRRuleAndIRRuleWhenDontCreateWorkFolder: val });
    }
  },

  created() {
    this.value = this.browserItems.combinWRRuleAndIRRuleWhenDontCreateWorkFolder;
    this.showThis = this.browserItems.downloadSaveMode === 1;

    browser.storage.onChanged.addListener(changes => {
      if ('downloadSaveMode' in changes) {
        this.showThis = changes.downloadSaveMode.newValue === 1;
      }
    });
  }
};
</script>

<template>
  <v-list-item v-if="showThis">
    <template #title>{{ tl('_combin_work_and_image_rename_rule_when_dont_create_work_folder') }}</template>
    <template #append>
      <v-select :items="options"
        item-title="text"
        item-value="value"
        v-model="value"
        style="width:150px;"
      ></v-select>
    </template>
  </v-list-item>
</template>
