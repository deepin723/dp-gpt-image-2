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
    <nav class="app-nav">
      <div class="nav-tabs">
        <button :class="['nav-tab', { active: activePage === 'image' }]" @click="activePage = 'image'">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" width="14" height="14">
            <rect x="1" y="3" width="14" height="10" rx="2"/>
            <circle cx="5.5" cy="7" r="1.5"/>
            <path d="M1 11l4-3 3 2.5 3-3L15 11"/>
          </svg>
          AI 图像
        </button>
        <button :class="['nav-tab', { active: activePage === 'ppt' }]" @click="activePage = 'ppt'">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" width="14" height="14">
            <rect x="1" y="2" width="14" height="12" rx="2"/>
            <path d="M5 6h3.5a1.5 1.5 0 0 1 0 3H5V6z"/>
            <line x1="5" y1="11" x2="8" y2="11"/>
          </svg>
          AI PPT
        </button>
      </div>
      <button class="nav-settings" @click="onOpenSettings" title="API 设置">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="15" height="15">
          <circle cx="8" cy="8" r="2.2"/>
          <path d="M8 2v1.2M8 12.8V14M2 8h1.2M12.8 8H14M3.5 3.5l.85.85M11.65 11.65l.85.85M12.5 3.5l-.85.85M4.35 11.65l-.85.85"/>
        </svg>
      </button>
    </nav>

    <ImageGenerator
      v-if="activePage === 'image'"
      :api-key="apiKey"
      :base-url="baseUrl"
      @settings="onOpenSettings"
    />
    <PptTool
      v-else-if="activePage === 'ppt'"
      :api-key="apiKey"
      :base-url="baseUrl"
      :cursor-key="cursorKey"
      :cursor-model="cursorModel"
    />
  </template>
</template>

<style>
.app-nav {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  height: 48px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.nav-tabs { display: flex; gap: 4px; }

.nav-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--text-2);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
.nav-tab:hover { color: var(--text); background: rgba(196,129,58,0.08); }
.nav-tab.active {
  color: var(--accent-lt);
  background: rgba(196,129,58,0.12);
  border-color: rgba(196,129,58,0.25);
}

.nav-settings {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-2);
  cursor: pointer;
  transition: all 0.15s;
}
.nav-settings:hover { color: var(--text); border-color: rgba(196,129,58,0.3); }
</style>
