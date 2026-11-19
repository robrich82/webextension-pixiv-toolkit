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
            style="width:220px"
          >
          </v-select>
        </template>
      </v-list-item>

      <v-list-item v-for="format in videoFormats" :key="format" :class="`ugoira-codec-${format}`">
        <template #title>{{ format.toUpperCase() }} {{ tl('ugoira_codec') }}</template>
        <template #subtitle>{{ tl('ugoira_codec_fallback') }}</template>
        <template #append>
          <v-select
            :items="codecItems(format)"
            :model-value="codecs[format]"
            :messages="encodable[codecs[format]] === false ? tl('codec_unencodable') : []"
            style="width:220px"
            @update:model-value="setCodec(format, $event)"
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
import {
  CODEC_LABELS, VIDEO_FORMAT_CODECS, codecSettingKey, encodableCodecs
} from '@@/modules/UgoiraEncoders/codecs';

export default {
  components: {
    'rename-dialog': RenameDialog,
  },

  data() {
    return {
      renameRule: "",

      defaultRenameRule: "{id}_{title}",

      animationJsonFormat: 1,

      showRenameDialog: false,

      videoFormats: Object.keys(VIDEO_FORMAT_CODECS),

      /** Each video format's codec. Unset (installs from before the setting) or unknown reads as the default, as encodeVideo does. */
      codecs: Object.fromEntries(Object.entries(VIDEO_FORMAT_CODECS)
        .map(([format, { defaultCodec }]) => [format, defaultCodec])),

      /** Filled in once WebCodecs answers; until then no codec is marked. */
      encodable: {},
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
    this.animationJsonFormat = this.browserItems.animationJsonFormat;

    for (const format of this.videoFormats) {
      const stored = this.browserItems[codecSettingKey(format)];

      if (VIDEO_FORMAT_CODECS[format].codecs.includes(stored)) {
        this.codecs[format] = stored;
      }
    }

    encodableCodecs().then(encodable => {
      this.encodable = encodable;
    });

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
    openRenameDialog() {
      this.showRenameDialog = true;
    },

    /** The codecs the format holds, each marked when this browser can't encode it. */
    codecItems(format) {
      return VIDEO_FORMAT_CODECS[format].codecs.map(codec => ({
        title: CODEC_LABELS[codec],
        value: codec,
        props: this.encodable[codec] === false ? { subtitle: this.tl('codec_unencodable') } : {}
      }));
    },

    setCodec(format, codec) {
      this.codecs[format] = codec;
      browser.storage.local.set({ [codecSettingKey(format)]: codec });
    }
  }
};
</script>

