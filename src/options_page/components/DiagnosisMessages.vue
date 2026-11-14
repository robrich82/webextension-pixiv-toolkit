<template>
  <div class="container diagnosis-messages">
    <h2>{{ tl('_diagnosis_messages') }}</h2>
    <h3>{{ tl('_permissions') }}</h3>
    <textarea style="width:100%" rows="10" v-model="permissions" disabled></textarea>
    <h3>{{ tl('_settings') }}</h3>
    <textarea style="width:100%" rows="30" v-model="settings" disabled></textarea>
    <h3>{{ tl('_error_messages') }}</h3>
    <textarea style="width:100%" rows="30" v-model="errors" disabled></textarea>
  </div>
</template>

<script>
import { trackedErrorLines } from '@@/modules/trackedErrors';

export default {
  data() {
    return {
      permissions     : '',
      settings        : '',
      errors          : '',
    };
  },

  mounted() {
    browser.permissions.getAll(permissions => {
      this.permissions = JSON.stringify(permissions);

      this.settings = JSON.stringify(this.browserItems);
    });

    this.loadErrors();
  },

  methods: {
    async loadErrors() {
      try {
        this.errors = (await trackedErrorLines()).map(line => line + "\r\n").join('');
      } catch (error) {
        // Not an empty box, which would read as "no errors".
        this.errors = `${this.tl('_error_messages_unavailable')}\r\n${error}`;
      }
    }
  }
}
</script>

<style lang="scss">
.diagnosis-messages {
  h3 {
    margin-top: 15px;
  }

  textarea {
    border: 1px solid gray;
  }
}
</style>
