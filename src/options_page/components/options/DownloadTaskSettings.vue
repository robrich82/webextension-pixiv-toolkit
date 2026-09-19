<template>
  <div class="option-section download-task-settings">
    <span class="option-card-title">{{ tl('_download_task_settings') }}</span>

    <v-expansion-panels>
      <v-expansion-panel>
        <v-expansion-panel-title>
          <div class="download-task-settings__title">{{ tl('_global_settings') }}</div>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <global-task-settings></global-task-settings>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel>
        <v-expansion-panel-title>
          <div class="download-task-settings__title">Pixiv {{ tl('Ugoira') }}</div>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <ugoria-options></ugoria-options>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel>
        <v-expansion-panel-title>
          <div class="download-task-settings__title">Pixiv {{ tl('Illustration') }}</div>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <illust-options></illust-options>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel>
        <v-expansion-panel-title>
          <div class="download-task-settings__title">Pixiv {{ tl('Manga') }}</div>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <manga-options></manga-options>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel>
        <v-expansion-panel-title>
          <div class="download-task-settings__title">Pixiv {{ tl('Novel') }}</div>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <novel-options></novel-options>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel>
        <v-expansion-panel-title>
          <div class="download-task-settings__title">Pixiv Comic</div>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <pixiv-comic-options></pixiv-comic-options>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel>
        <v-expansion-panel-title>
          <div class="download-task-settings__title">Fanbox</div>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <fanbox-post-settings></fanbox-post-settings>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </div>
</template>

<script>
import GlobalTaskSettings from '@@/components/options/GlobalTaskSettings';
import UgoiraOptions from '@@/components/options/UgoiraOptions';
import IllustrationOptions from '@@/components/options/IllustrationOptions';
import MangaOptions from '@@/components/options/MangaOptions';
import NovelOptions from '@@/components/options/NovelOptions';
import PixivComicOptions from '@@/components/options/PixivComicOptions';
import FanboxPostSettings from '@@/components/options/FanboxPostSettings';

export default {
  name: 'download-task-settings',

  components: {
    'global-task-settings': GlobalTaskSettings,
    'ugoria-options': UgoiraOptions,
    'illust-options': IllustrationOptions,
    'manga-options': MangaOptions,
    'novel-options': NovelOptions,
    'pixiv-comic-options': PixivComicOptions,
    'fanbox-post-settings': FanboxPostSettings,
  },
};
</script>

<style lang="scss">
.download-task-settings {
  .v-list__tile {
    padding: 0 24px;
  }
}

.download-task-settings__title {
  font-size: 18px;
}
</style>
