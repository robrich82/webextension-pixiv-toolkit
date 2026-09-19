<template>
  <div class="option-section">
    <v-list lines="two">
      <v-list-item @click="openRenameDialog()">
        <template #title>{{ tl('_rename') }}</template>
        <template #subtitle>{{ renameRule }}</template>
        <template #append>
          <v-btn icon ripple>
            <v-icon>mdi-chevron-right</v-icon>
          </v-btn>
        </template>
      </v-list-item>

      <v-list-item>
        <template #title>{{ tl('include_novel_description') }}</template>
        <template #subtitle>{{ tl('include_novel_description_at_the_beginning') }}</template>
        <template #append>
          <v-switch v-model="novelIncludeDescription"></v-switch>
        </template>
      </v-list-item>
    </v-list>

    <rename-dialog v-model:show="showRenameDialog"
      v-model="renameRule"
      :title="tl('_novel_rename_rule')"
      :metas="renameMetas"
      :default-value="defaultRenameRule"
    ></rename-dialog>
  </div>
</template>

<script>
import RenameDialog from '@@/components/options/RenameDialog';

export default {
  components: {
    'rename-dialog': RenameDialog,
  },

  data() {
    return {
      showRenameDialog: false,

      defaultRenameRule: '{id}_{title}',

      renameRule: '',

      novelIncludeDescription: false,
    }
  },

  created() {
    this.renameRule = this.browserItems.novelRenameRule;
    this.novelIncludeDescription = this.browserItems.novelIncludeDescription;

    this.renameMetas = [
      {
        title: this.tl("id"),
        holder: "{id}"
      },
      {
        title: this.tl("title"),
        holder: "{title}"
      },
      {
        title: this.tl("author"),
        holder: "{author}"
      },
      {
        title: this.tl("author_id"),
        holder: "{authorId}"
      },
      {
        title: this.tl("year"),
        holder: "{year}"
      },
      {
        title: this.tl("month"),
        holder: "{month}"
      },
      {
        title: this.tl("day"),
        holder: "{day}"
      },
      {
        title: this.tl("_series_id"),
        holder: "{seriesId}"
      },
      {
        title: this.tl("_series_title"),
        holder: "{seriesTitle}"
      },
      {
        title: this.tl("_series_order"),
        holder: "{seriesOrder}"
      }
    ];
  },

  watch: {
    renameRule(val) {
      if (val === '') {
        val = this.renameRule = this.defaultRenameRule;
      }

      browser.storage.local.set({
        novelRenameRule: val
      });
    },

    novelIncludeDescription(val) {
      /**
       * Prevent updating setting after component is created every time
       */
      if (this.browserItems.novelIncludeDescription !== val) {
        browser.storage.local.set({
          novelIncludeDescription: !!val
        });
      }
    },
  },

  methods: {
    openRenameDialog() {
      this.showRenameDialog = true;
    }
  }
}
</script>
