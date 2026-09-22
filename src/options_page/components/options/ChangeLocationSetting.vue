<template>
  <v-list-item>
    <template #title>
      {{ settingTitle }}
      <v-tooltip
        v-if="settingTip !== ''"
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
        <span>{{ settingTip }}</span>
      </v-tooltip>
    </template>
    <template #subtitle>{{ settingHint }}</template>
    <template #append>
      <change-location-btn
        :dialog-title="dialogTitle"
        :dialog-hint="dialogHint"
        v-model:location="location"
        :disabled="!browserItems.enableExtTakeOverDownloads"
      ></change-location-btn>
    </template>
  </v-list-item>
</template>

<script>
import ChangeLocationBtn from "@@/components/options/ChangeLocationBtn";

export default {
  components: {
    'change-location-btn': ChangeLocationBtn
  },

  props: {
    modelValue: {
      required: true,
      type: String
    },

    settingTitle: {
      required: true,
      type: String
    },

    settingTip: {
      required: false,
      type: String,
      default: ''
    },

    dialogTitle: {
      required: true,
      type: String
    },

    dialogHint: {
      required: true,
      type: String
    },
  },

  computed: {
    settingHint() {
      if (this.location) {
        return this.location;
      } else {
        return 'Not set';
      }
    },

    location: {
      get() {
        return this.modelValue;
      },

      set(val) {
        this.$emit('update:modelValue', val);
      }
    }
  }
}
</script>
