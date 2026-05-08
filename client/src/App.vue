<script setup lang="ts">
import { ref } from 'vue'
import ApiKeySetup from './components/ApiKeySetup.vue'
import ImageGenerator from './components/ImageGenerator.vue'
import PptTool from './components/PptTool.vue'

const apiKey  = ref(localStorage.getItem('deepin_api_key') || '')
const baseUrl = ref(localStorage.getItem('deepin_base_url') || 'https://bobdong.cn/v1')
const cursorKey   = ref(localStorage.getItem('deepin_cursor_key') || '')
const cursorModel = ref(localStorage.getItem('deepin_cursor_model') || 'auto')
const showSetup   = ref(!apiKey.value)
const activePage  = ref<'image' | 'ppt'>('image')

const onSaveKey = (payload: { apiKey: string; baseUrl: string; cursorKey: string; cursorModel: string }) => {
  apiKey.value      = payload.apiKey
  baseUrl.value     = payload.baseUrl
  cursorKey.value   = payload.cursorKey
  cursorModel.value = payload.cursorModel
  localStorage.setItem('deepin_api_key',      payload.apiKey)
  localStorage.setItem('deepin_base_url',     payload.baseUrl)
  localStorage.setItem('deepin_cursor_key',   payload.cursorKey)
  localStorage.setItem('deepin_cursor_model', payload.cursorModel)
  showSetup.value = false
}

const onOpenSettings = () => { showSetup.value = true }
const onSwitchPage = (page: string) => { activePage.value = page as 'image' | 'ppt' }
</script>

<template>
  <ApiKeySetup
    v-if="showSetup"
    :initial-key="apiKey"
    :initial-url="baseUrl"
    :initial-cursor-key="cursorKey"
    :initial-cursor-model="cursorModel"
    @save="onSaveKey"
  />

  <template v-else>
    <!-- ImageGenerator has its own header with integrated tabs -->
    <ImageGenerator
      v-if="activePage === 'image'"
      :api-key="apiKey"
      :base-url="baseUrl"
      :active-page="activePage"
      @settings="onOpenSettings"
      @switch-page="onSwitchPage"
    />
    <PptTool
      v-else-if="activePage === 'ppt'"
      :api-key="apiKey"
      :base-url="baseUrl"
      :cursor-key="cursorKey"
      :cursor-model="cursorModel"
      :active-page="activePage"
      @switch-page="onSwitchPage"
      @settings="onOpenSettings"
    />
  </template>
</template>
