<template>
  <div class="option-section">
    <v-list lines="two">
      <v-list-item @click="showRenameDialog = true">
        <template #title>{{ tl('_rename') }}</template>
        <template #subtitle>{{ renameRule }}</template>
        <template #append>
          <v-btn icon ripple>
            <v-icon>mdi-chevron-right</v-icon>
          </v-btn>
        </template>
      </v-list-item>

      <v-list-item @click="showRenameImageDialog = true">
        <template #title>{{ tl('_rename_pixiv_comic_episode_image') }}</template>
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
      :title="tl('_rename_comic')"
      :metas="renameMetas"
      :default-value="defaultRenameRule"
    ></rename-dialog>

    <rename-dialog v-model:show="showRenameImageDialog"
      v-model="renameImageRule"
      :title="tl('_rename_pixiv_comic_image')"
      :metas="renameImageMetas"
      :default-value="defaultRenameImageRule"
    ></rename-dialog>
  </div>
</template>

<script>
import RenameDialog from '@@/components/options/RenameDialog';
import browser from '@/modules/Extension/browser';

export default {
  components: {
    'rename-dialog': RenameDialog,
  },

  data() {
    return {
      renameRule: '',

      defaultRenameRule: '{id}_{title}/{numbering_title}_{workTitle}',

      renameImageRule: '',

      defaultRenameImageRule: 'p{pageNum}',

      pageNumberStartWithOne: -2,

      pageNumberLength: -2,

      showRenameDialog: false,
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
        this.renameRule = this.defaultRenameRule;
      }

      browser.storage.local.set({
        pixivComicEpisodeRenameRule: val
      });
    },

    renameImageRule(val) {
      browser.storage.local.set({
        pixivComicEpisodeRenameImageRule: val
      });
    },

    pageNumberStartWithOne(val) {
      browser.storage.local.set({
        pixivComicEpisodePageNumberStartWithOne: val
      });
    },

    pageNumberLength(val) {
      browser.storage.local.set({
        pixivComicEpisodePageNumberLength: val
      });
    },
  },

  created() {
    this.renameMetas = [{
      holder: '{id}',
      title: this.tl('_id'),
    }, {
      holder: '{title}',
      title: this.tl('_title'),
    }, {
      holder: '{subTitle}',
      title: this.tl('_sub_title'),
    }, {
      holder: '{numberingTitle}',
      title: this.tl('_numbering_title'),
    }, {
      holder: '{workId}',
      title: this.tl('_work_id'),
    }, {
      holder: '{workTitle}',
      title: this.tl('_work_title'),
    }];

    this.renameImageMetas = this.renameMetas.concat({
      holder: '{pageNum}',
      title: this.tl('_page_num'),
    });

    this.renameRule = this.browserItems.pixivComicEpisodeRenameRule;
    this.renameImageRule = this.browserItems.pixivComicEpisodeRenameImageRule;
    this.pageNumberStartWithOne = this.browserItems.pixivComicEpisodePageNumberStartWithOne;
    this.pageNumberLength = this.browserItems.pixivComicEpisodePageNumberLength;
  }
};
</script>
