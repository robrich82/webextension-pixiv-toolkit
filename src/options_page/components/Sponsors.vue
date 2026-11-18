<template>
  <v-container>
    <sponsors-card></sponsors-card>
  </v-container>
</template>

<script>
import cr from "@@/modules/cr";
import SponsorsCard from '@/options_page/components/SponsorsCard.vue';
import sponsersData from '@@/../statics/sponsors.json';

export default {
  components: {
    'sponsors-card': SponsorsCard
  }
}
</script>
