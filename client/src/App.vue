<script setup lang="ts">
import { ref } from 'vue'
import ApiKeySetup from './components/ApiKeySetup.vue'
import ImageGenerator from './components/ImageGenerator.vue'

const apiKey = ref(localStorage.getItem('deepin_api_key') || '')
const baseUrl = ref(localStorage.getItem('deepin_base_url') || 'https://bobdong.cn/v1')
const showSetup = ref(!apiKey.value)

const onSaveKey = (key: string, url: string) => {
  apiKey.value = key
  baseUrl.value = url
  localStorage.setItem('deepin_api_key', key)
  localStorage.setItem('deepin_base_url', url)
  showSetup.value = false
}

const onOpenSettings = () => {
  showSetup.value = true
}
</script>

<template>
  <ApiKeySetup v-if="showSetup" :initial-key="apiKey" :initial-url="baseUrl" @save="onSaveKey" />
  <ImageGenerator v-else :api-key="apiKey" :base-url="baseUrl" @settings="onOpenSettings" />
</template>
