<template>
  <div class="option-section">
    <span class="option-card-title">{{ tl('Search') }}</span>

    <v-card>
      <v-list lines="two">
        <v-list-item>
          <template #title>{{ tl('Enable_search_suffix') }}</template>
          <template #subtitle>{{ tl('Add_a_search_suffix_for_searching_popular_works_probably') }}</template>
          <template #append>
            <v-switch v-model="enablePtkSearch"></v-switch>
          </template>
        </v-list-item>
      </v-list>
    </v-card>
  </div>
</template>

<script>
export default {
  data() {
    return {
      enablePtkSearch: true
    }
  },

  beforeMount() {
    this.enablePtkSearch = this.browserItems.enablePtkSearch;
  },

  watch: {
    enablePtkSearch(val) {
      browser.storage.local.set({
        enablePtkSearch: !!val
      });
    }
  }
}
</script>
