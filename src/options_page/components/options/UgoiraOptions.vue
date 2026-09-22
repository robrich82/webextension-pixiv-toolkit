<template>
  <div class="option-section">
    <v-list lines="two">
      <v-list-item @click="openRenameDialog">
        <template #title>{{ tl('rename_ugoira_file') }}</template>
        <template #subtitle>{{ renameRule }}</template>
        <template #append>
          <v-btn icon ripple>
            <v-icon>mdi-chevron-right</v-icon>
          </v-btn>
        </template>
      </v-list-item>

      <v-list-item class="option-section__auto-height">
        <template #title>{{ tl('_ffmpeg_custom_convert_command') }} (<a href="https://github.com/leoding86/webextension-pixiv-toolkit/blob/master/docs/help.md#about-ffmpeg-custom-convert-command-en_us" target="_blank"><strong>{{ tl('_more_info') }}</strong></a>)</template>
        <template #subtitle>
          <textarea class="option-section__input-text"
            v-model="ugoiraCustomFFmpegCommand"
            :placeholder="tl('_not_set')"
            @blur="onUgoiraCustomFFmpegCommandChangeHandler"
          ></textarea>
        </template>
      </v-list-item>

      <v-list-item>
        <template #title>
          {{ tl('pack_ugoira_frames_info') }}
          <v-tooltip
            location="bottom"
          >
            <template
              v-slot:activator="{ props }"
            >
              <v-icon
                v-bind="props"
                size="small"
              >mdi-information</v-icon>
            </template>
            <span>{{ tl('pack_ugoira_frames_info_into_tip') }}</span>
          </v-tooltip>
        </template>
        <template #subtitle>{{ tl('pack_ugoira_frames_info_into_zip') }}</template>
        <template #append>
          <v-select
            :items="animationJsonFormatOptions"
            item-title="text"
            item-value="value"
            v-model="animationJsonFormat"
            style="width:150px"
          >
          </v-select>
        </template>
      </v-list-item>
    </v-list>

    <rename-dialog v-model:show="showRenameDialog"
      v-model="renameRule"
      :title="tl('rename_ugoira')"
      :metas="renameMetas"
      :default-value="defaultRenameRule"
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
      renameRule: "",

      defaultRenameRule: "{id}_{title}",

      ugoiraCustomFFmpegCommand: '',

      animationJsonFormat: 1,

      showRenameDialog: false,
    };
  },

  computed: {
    animationJsonFormatOptions() {
      return [
        {
          text: this.tl('_do_not_pack'),
          value: 0
        }, {
          text: this.tl('_type') + ' 1',
          value: 1,
        }, {
          text: this.tl('_type') + ' 2',
          value: 2
        }
      ];
    }
  },

  watch: {
    renameRule(val) {
      if (val === '') {
        val = this.defaultRenameRule;
        this.renameRule = val;
      }

      browser.storage.local.set({
        ugoiraRenameRule: val
      });
    },

    animationJsonFormat(val) {
      browser.storage.local.set({
        animationJsonFormat: val
      });
    }
  },

  created() {
    this.renameRule = this.browserItems.ugoiraRenameRule;
    this.ugoiraCustomFFmpegCommand = this.browserItems.ugoiraCustomFFmpegCommand || '';
    this.animationJsonFormat = this.browserItems.animationJsonFormat;

    this.renameMetas = [
      {
        title: this.tl("_id"),
        holder: "{id}"
      },
      {
        title: this.tl("_title"),
        holder: "{title}"
      },
      {
        title: this.tl("_author"),
        holder: "{author}"
      },
      {
        title: this.tl("_author_id"),
        holder: "{authorId}"
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
    ]
  },

  methods: {
    onUgoiraCustomFFmpegCommandChangeHandler() {
      browser.storage.local.set({
        ugoiraCustomFFmpegCommand: this.ugoiraCustomFFmpegCommand.trim()
      });
    },

    openRenameDialog() {
      this.showRenameDialog = true;
    }
  }
};
</script>

<style lang="scss">
.option-section__input-text {
  width: 100%;
  padding: 5px 5px;
  background: #efefef;
  border-radius: 5px;
}

.option-section__auto-height {
  .v-list-item {
    height: auto;
  }

  // The ffmpeg command textarea lives in the #subtitle slot, which Vuetify 3
  // clamps to 2 lines and fades via v-list's `lines="two"` -- undo both so
  // the textarea stays fully visible and legible.
  .v-list-item-subtitle {
    display: block;
    overflow: visible;
    opacity: 1;
  }
}
</style>
