<template>
  <div class="option-section">
    <v-list lines="two">
      <v-list-item @click="showRenameDialog = true">
        <template #title>{{ tl('_rename_illustration') }}</template>
        <template #subtitle>{{ renameRule }}</template>
        <template #append>
          <v-btn icon ripple>
            <v-icon>mdi-chevron-right</v-icon>
          </v-btn>
        </template>
      </v-list-item>

      <v-list-item @click="showRenameImageDialog = true">
        <template #title>{{ tl('_rename_illustration_image') }}</template>
        <template #subtitle>{{ renameImageRule }}</template>
        <template #append>
          <v-btn icon ripple>
            <v-icon>mdi-chevron-right</v-icon>
          </v-btn>
        </template>
      </v-list-item>

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
    </v-list>

    <rename-dialog v-model:show="showRenameDialog"
      v-model="renameRule"
      :title="tl('_rename_illustration')"
      :metas="renameMetas"
      :default-value="defaultRenameRule"
    ></rename-dialog>

    <rename-dialog v-model:show="showRenameImageDialog"
      v-model="renameImageRule"
      :title="tl('_rename_illustration_image')"
      :metas="renameImageMetas"
      :default-value="defaultRenameImageRule"
    ></rename-dialog>
  </div>
</template>

<script>
import browser from '@/modules/Extension/browser';
import RenameDialog from '@@/components/options/RenameDialog';

export default {
  components: {
    'rename-dialog': RenameDialog,
  },

  data() {
    return {
      showRenameDialog: false,

      defaultRenameRule: '{id}_{title}',

      renameRule: "",

      showRenameImageDialog: false,

      defaultRenameImageRule: 'p{pageNum}',

      renameImageRule: "",

      pageNumberStartWithOne: -2,

      pageNumberLength: 0,

      location: '',
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
      }, {
        text: this.tl('_global_setting'),
        value: -2
      }];
    },

    pageNumberStartWithOneOptions() {
      return [{
        text: this.tl('_enable'),
        value: 1,
      }, {
        text: this.tl('_disable'),
        value: 0,
      }, {
        text: this.tl('_global_setting'),
        value: -2
      }]
    },
  },

  watch: {
    renameRule(val) {
      if (val === '') {
        val = this.defaultRenameRule;
      }

      browser.storage.local.set({
        illustRenameRule: val,
      });
    },

    renameImageRule(val) {
      if (val === '') {
        val = this.defaultRenameImageRule;
      }

      browser.storage.local.set({
        illustRenameImageRule: val,
      })
    },

    pageNumberStartWithOne(val) {
      browser.storage.local.set({
        illustrationPageNumberStartWithOne: val
      });
    },

    pageNumberLength(val) {
      browser.storage.local.set({
        illustrationPageNumberLength: val
      });
    },

    location(val) {
      browser.storage.local.set({
        illustrationRelativeLocation: val
      });
    },
  },

  created() {
    this.renameRule = this.browserItems.illustRenameRule;
    this.renameImageRule = this.browserItems.illustRenameImageRule;
    this.pageNumberStartWithOne = this.browserItems.illustrationPageNumberStartWithOne;
    this.pageNumberLength = this.browserItems.illustrationPageNumberLength;
    this.location = this.browserItems.illustrationRelativeLocation;

    this.renameMetas = [
      {
        title: this.tl("_id"),
        holder: "{id}"
      },
      {
        title: this.tl("_author_id"),
        holder: "{authorId}"
      },
      {
        title: this.tl("_title"),
        holder: '{title}'
      },
      {
        title: this.tl("_author"),
        holder: '{author}'
      },
      {
        title: this.tl("_year"),
        holder: "{year}"
      },
      {
        title: this.tl("_month"),
        holder: "{month}"
      },
      {
        title: this.tl("_day"),
        holder: "{day}"
      }
    ];

    this.renameImageMetas = this.renameMetas.concat({
      title: this.tl("_page_num"),
      holder: "{pageNum}"
    });
  },
};
</script>
