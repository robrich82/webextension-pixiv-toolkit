<template>
  <div id="app">
    <v-app>
      <v-navigation-drawer
        v-model="drawer"
        :temporary="drawerTemporary"
        :scrim="false">

        <v-toolbar flat>
          <v-list>
            <v-list-item>
              <template #title>
                {{ tl('Menu') }}
              </template>
            </v-list-item>
          </v-list>
        </v-toolbar>

        <v-divider></v-divider>

        <v-list density="compact">
          <v-list-item
            v-if="browserItems.enableSaveVisitHistory === true"
            ripple
            @click="goToHistory()">
            <span>{{ tl('_history') }}</span>
          </v-list-item>

          <v-divider v-if="browserItems.enableSaveVisitHistory === true || browserItems.enableSaveDownloadHistory === 1"></v-divider>

          <v-list-item
            ripple
            @click="openDownloadManager"
          >
            <span>{{ tl('_download_manager') }} <v-icon size="small">mdi-open-in-new</v-icon></span>
          </v-list-item>

          <v-divider></v-divider>

          <v-list-item ripple @click="routeTo('Options')">
            <template #title>{{ tl('settings') }}</template>
          </v-list-item>
          <v-list-item ripple @click="routeTo('ChangeLogs')">
            <template #title>{{ tl('Change_History') }}</template>
          </v-list-item>
          <v-list-item ripple @click="routeTo('Sponsors')">
            <template #title>{{ tl('Sponsors') }}😍</template>
          </v-list-item>
          <v-divider></v-divider>
          <v-list-item ripple @click="routeTo('ThirdParty')">
            <template #title>{{ tl('Third_Party') }}</template>
          </v-list-item>
          <v-divider></v-divider>
        </v-list>
      </v-navigation-drawer>
      <v-app-bar class="v-primary" height="56">
        <v-btn variant="text" icon
          @click="drawer = !drawer" v-if="drawerTemporary">
          <v-icon>mdi-menu</v-icon>
        </v-btn>
        <span class="text-h6 v-primary header-title">
          Pixiv<strong>Toolkit</strong>
          <span style="font-size:12px">Next {{ version }}</span>
        </span>

        <v-spacer></v-spacer>

        <supports style="margin-bottom:0"
          :show-sponsors-link="false"
          :show-inline-sponsors-link="true"></supports>
      </v-app-bar>
      <v-main>
        <router-view style="max-width: 800px;" />
      </v-main>

      <update-notice></update-notice>

      <div style="height:100px;"></div>
    </v-app>

    <app-suggest
      :class="{
        'app-suggest_container': true,
        'app-suggest_container--show': showAppSuggest
      }"
      v-if="displayAppSuggest"
      icon="https://raw.githubusercontent.com/leoding86/webextension-pixiv-toolkit/master/src/statics/remote/img/pixiv-omina.png"
      title="Pixiv Omina"
      subTitle="A more powerful Pixiv downloader"
      link="https://github.com/leoding86/pixiv-omina"
    ></app-suggest>
  </div>
</template>

<script>
import Supports from '@@/components/Supports';
import AppSuggest from '@@/components/AppSuggest';
import UpdateNotice from '@@/components/UpdateNotice';
import browser from '@/modules/Extension/browser';

export default {
  name: 'App',

  components: {
    'supports': Supports,
    'app-suggest': AppSuggest,
    'update-notice': UpdateNotice
  },

  data () {
    return {
      drawer: true,
      drawerTemporary: false,
      displayAppSuggest: false,
      showAppSuggest: false
    }
  },

  computed: {
    version () {
      return 'v' + browser.runtime.getManifest().version;
    }
  },

  created() {
    this.downloadManagerOpenning = false;
  },

  beforeMount() {
    let vm = this

    window.addEventListener('resize', this.resizeHandle)

    this.resizeHandle();

    browser.runtime.getPlatformInfo(platformInfo => {
      if (platformInfo.os === 'win' && platformInfo.arch !== 'arm') {
        this.displayAppSuggest = true;

        this.$nextTick(() => {
          setTimeout(() => this.showAppSuggest = true, 1000);
        });
      }
    });
  },

  methods: {
    resizeHandle() {
      if (window.innerWidth < 1400) {
        if (!this.drawerTemporary) {
          this.drawerTemporary = true
          this.drawer = false
        }
      } else {
        if (this.drawerTemporary) {
          this.drawerTemporary = false
          this.drawer = true
        }
      }
    },

    goToHistory() {
      this.routeTo('History');
    },

    async openDownloadManager() {
      if (this.downloadManagerOpenning) {
        return;
      }

      this.downloadManagerOpenning = true;

      let response;

      let timeout = setTimeout(() => {
        window.open(browser.runtime.getURL('options_page/downloads.html'), '_blank');
        this.downloadManagerOpenning = false;
      }, 600);

      response = await browser.runtime.sendMessage({
        action: 'download:checkIfDownloadManagerOpened'
      }).catch(() => undefined);

      clearTimeout(timeout);

      if (response && response.result) {
        browser.tabs.update(response.data.tabId, { active: true });
      } else {
        window.open(browser.runtime.getURL('options_page/downloads.html'), '_blank');
      }

      this.downloadManagerOpenning = false;
    }
  }
}
</script>

<style lang="scss">
$primary-blue-color: #3367d6;
$primary-blue-text-color: #fff;

#app {
    .v-primary {
        background: $primary-blue-color;
        color: $primary-blue-text-color;
    }

    .v-toolbar {
        min-height: 56px;
    }

    .header-title {
      font-weight: 300;

      strong {
        font-weight: 700;
      }
    }

    .app-suggest_container {
      position: fixed;
      bottom: 10px;
      left: 10px;
      border-radius: 5px;
      box-shadow: 0 0 5px rgba(0, 0, 0, 0.3);
      background: rgb(255, 255, 255);
      transform: translateX(-300px);
      transition: 800ms ease all;
    }

    .app-suggest_container--show {
      transform: translateX(0px);
    }
}
</style>
