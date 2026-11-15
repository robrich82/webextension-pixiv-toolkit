<template>
  <v-container>
    <span class="card-title">{{ tl('Third_Party') }}</span>

    <v-card style="margin-bottom:30px;">
      <v-list
        lines="two">
        <v-list-item
          v-for="item in thirdPartList"
          ripple
          @click="openInNew(item.url)"
          :key="item.name">
          <template #title><span class="third-party__name">{{ item.name }}</span> <span class="third-party__version" style="font-size:12px;">{{ item.version }}</span></template>
          <template #subtitle>{{ item.desc }}</template>
          <template #append>
            <v-btn variant="text" icon>
              <v-icon>mdi-open-in-new</v-icon>
            </v-btn>
          </template>
        </v-list-item>
      </v-list>
    </v-card>
  </v-container>
</template>

<script>
import cr from '@@/modules/cr'

export default {
  data () {
    // Installed versions of the npm packages, from scripts/thirdPartyVersions.mjs.
    const npm = __THIRD_PARTY_VERSIONS__;

    // The vendored copies in src/statics/lib aren't in node_modules, so their versions are
    // hardcoded from the files' headers. js-epub-maker's carries none.
    return {
      thirdPartList: [{
        name: 'ffmpeg.wasm',
        version: npm['@ffmpeg/core'],
        desc: 'ffmpeg.wasm is a pure WebAssembly / JavaScript port of FFmpeg. It enables video & audio record, convert and stream right inside browsers.',
        url: 'https://github.com/ffmpegwasm/ffmpeg.wasm'
      }, {
        name: 'JSZip',
        version: '3.1.5',
        desc: 'Create, read and edit .zip files with JavaScript',
        url: 'https://github.com/Stuk/jszip'
      }, {
        name: 'Dexie.js',
        // The background bundles the npm package; the pages load the vendored copy.
        version: `${npm.dexie}, 3.2.2`,
        desc: 'A minimalistic wrapper for IndexedDB',
        url: 'https://github.com/dexie/Dexie.js'
      }, {
        name: 'js-epub-maker',
        version: '',
        desc: 'Builds EPUB files in the browser',
        url: 'https://github.com/bbottema/js-epub-maker'
      }, {
        name: 'Handlebars',
        version: '5.0.0-alpha.1',
        desc: 'Minimal templating on steroids',
        url: 'https://github.com/handlebars-lang/handlebars.js'
      }, {
        name: 'Vue.js',
        version: npm.vue,
        desc: 'Vue.js is a progressive, incrementally-adoptable JavaScript framework for building UI on the web.',
        url: 'https://github.com/vuejs/core'
      }, {
        name: 'Vue Router',
        version: npm['vue-router'],
        desc: 'The official router for Vue.js',
        url: 'https://github.com/vuejs/router'
      }, {
        name: 'Vuetify',
        version: npm.vuetify,
        desc: 'Material Design component framework for Vue.js',
        url: 'https://github.com/vuetifyjs/vuetify'
      }, {
        name: 'vue-i18n',
        version: npm['vue-i18n'],
        desc: 'Internationalization plugin for Vue.js',
        url: 'https://github.com/intlify/vue-i18n'
      }, {
        name: 'vue-virtual-scroller',
        version: npm['vue-virtual-scroller'],
        desc: 'Smooth scrolling for any amount of data',
        url: 'https://github.com/Akryum/vue-virtual-scroller'
      }, {
        name: 'Material Design Icons',
        version: npm['@mdi/font'],
        desc: 'Icon font for the Material Design Icons set',
        url: 'https://github.com/Templarian/MaterialDesign-Webfont'
      }, {
        name: 'Moment.js',
        version: npm.moment,
        desc: 'Parse, validate, manipulate, and display dates in JavaScript',
        url: 'https://github.com/moment/moment'
      }, {
        name: 'mitt',
        version: npm.mitt,
        desc: 'Tiny functional event emitter',
        url: 'https://github.com/developit/mitt'
      }, {
        name: 'md5',
        version: npm.md5,
        desc: 'A JavaScript function for hashing messages with MD5',
        url: 'https://github.com/pvorb/node-md5'
      }]
    }
  },

  methods: {
    openInNew (url) {
      window.open(url, '_blank');
    },

    tl(string) {
      return cr._e(string);
    }
  }
}
</script>


<style lang="scss" scoped>
#app {
  .card-title {
    display: block;
    font-size: 18px;
    margin-bottom: 10px;
  }
}
</style>
