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

      browser.runtime.sendMessage({
        action: 'log:getTrackedErrors'
      }, errorMessages => {
        (errorMessages || []).forEach(errorMessage => {
          this.errors += errorMessage + "\r\n";
        });
      });
    });
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
