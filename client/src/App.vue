<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAuth, useUser, useClerk, SignIn } from '@clerk/vue'
import ApiKeySetup from './components/ApiKeySetup.vue'
import ImageGenerator from './components/ImageGenerator.vue'
import PptTool from './components/PptTool.vue'

const clerkEnabled = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

// ── State ─────────────────────────────────────────────────────
const apiKey      = ref(localStorage.getItem('deepin_api_key') || '')
const baseUrl     = ref(localStorage.getItem('deepin_base_url') || 'https://bobdong.cn/v1')
const cursorKey   = ref(localStorage.getItem('deepin_cursor_key') || '')
const cursorModel = ref(localStorage.getItem('deepin_cursor_model') || 'auto')
const showSetup   = ref(!apiKey.value)
const activePage  = ref<'image' | 'ppt'>('image')
const settingsLoaded = ref(!clerkEnabled)

const apiBase = () => import.meta.env.VITE_API_BASE || 'https://dp-gpt-image-2-production.up.railway.app'

// ── Clerk composables ─────────────────────────────────────────
const { isSignedIn, getToken } = useAuth()
const { user } = useUser()
// useClerk() returns ShallowRef<Clerk | null> — access via clerk.value
const clerk = useClerk()

// Clerk initialization state: undefined = still loading, true/false = known
const clerkReady = computed(() => isSignedIn.value !== undefined)

// ── Auth state machine ────────────────────────────────────────
// 'loading'        → Clerk not yet initialized, or settings fetch in progress
// 'unauthenticated'→ Clerk loaded, not signed in
// 'ready'          → app can show (clerk disabled, or signed in + settings loaded)
const authState = computed<'loading' | 'unauthenticated' | 'ready'>(() => {
  if (!clerkEnabled) return 'ready'
  if (!clerkReady.value) return 'loading'           // undefined: Clerk still booting
  if (isSignedIn.value === false) return 'unauthenticated'
  if (isSignedIn.value === true && !settingsLoaded.value) return 'loading'
  return 'ready'
})

// ── User display info ─────────────────────────────────────────
const userDisplay = computed(() => {
  if (!clerkEnabled || !user.value) return null
  return {
    name:   user.value.fullName || user.value.primaryEmailAddress?.emailAddress || '用户',
    email:  user.value.primaryEmailAddress?.emailAddress || '',
    avatar: user.value.imageUrl || '',
  }
})

const handleSignOut = () => clerk.value?.signOut()

// ── Token helper ──────────────────────────────────────────────
// Stable wrapper — always calls the latest getToken.value, never a stale snapshot
const getTokenFn = clerkEnabled
  ? () => getToken.value?.() ?? null
  : undefined

const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (clerkEnabled) {
    try { const t = await getToken.value?.(); if (t) h['Authorization'] = `Bearer ${t}` } catch {}
  }
  return h
}

// ── Server settings sync ──────────────────────────────────────
const loadServerSettings = async () => {
  const attempt = async () => {
    const headers = await getAuthHeaders()
    const res = await fetch(`${apiBase()}/api/user-settings`, { headers })
    if (!res.ok) return false
    const data = await res.json()
    if (data.apiKey) {
      apiKey.value      = data.apiKey
      baseUrl.value     = data.baseUrl || 'https://bobdong.cn/v1'
      cursorKey.value   = data.cursorKey   || ''
      cursorModel.value = data.cursorModel || 'auto'
      showSetup.value   = false
    }
    return true
  }
  try {
    const ok = await attempt()
    if (!ok) {
      await new Promise(r => setTimeout(r, 1500))
      await attempt()
    }
  } catch { /* silent */ }
  settingsLoaded.value = true
}

const saveServerSettings = async (payload: { apiKey: string; baseUrl: string; cursorKey: string; cursorModel: string }) => {
  if (!clerkEnabled || !isSignedIn.value) return
  try {
    const headers = await getAuthHeaders()
    await fetch(`${apiBase()}/api/user-settings`, { method: 'PUT', headers, body: JSON.stringify(payload) })
  } catch { /* silent */ }
}

if (clerkEnabled) {
  let loadedOnce = false
  watch(isSignedIn, async (signed) => {
    if (signed === undefined || signed === null) return
    if (signed) {
      if (loadedOnce) return  // prevent duplicate calls on token refresh
      loadedOnce = true
      await loadServerSettings()
    } else {
      loadedOnce = false
      settingsLoaded.value = true
    }
  }, { immediate: true })
}

// ── Handlers ──────────────────────────────────────────────────
const onSaveKey = async (payload: { apiKey: string; baseUrl: string; cursorKey: string; cursorModel: string }) => {
  apiKey.value      = payload.apiKey
  baseUrl.value     = payload.baseUrl
  cursorKey.value   = payload.cursorKey
  cursorModel.value = payload.cursorModel
  localStorage.setItem('deepin_api_key',      payload.apiKey)
  localStorage.setItem('deepin_base_url',     payload.baseUrl)
  localStorage.setItem('deepin_cursor_key',   payload.cursorKey)
  localStorage.setItem('deepin_cursor_model', payload.cursorModel)
  await saveServerSettings(payload)
  showSetup.value = false
}

const onOpenSettings = () => { showSetup.value = true }
const onSwitchPage   = (page: string) => { activePage.value = page as 'image' | 'ppt' }
</script>

<template>
  <!-- Loading: Clerk booting or settings fetching -->
  <div v-if="authState === 'loading'" class="loading-screen">
    <div class="loading-spinner" />
  </div>

  <!-- Not signed in: show login -->
  <div v-else-if="authState === 'unauthenticated'" class="auth-screen">
    <div class="auth-card">
      <div class="auth-brand">
        <svg viewBox="0 0 36 36" fill="none" width="40" height="40">
          <rect width="36" height="36" rx="9" fill="#2A1A0C"/>
          <text x="8" y="26" font-size="20" font-weight="700" fill="#EAD9C0" font-family="serif">D</text>
          <rect x="8" y="28" width="20" height="1.5" rx="1" fill="#C4813A" opacity="0.7"/>
        </svg>
        <div>
          <h1 class="auth-title">Deepin Image</h1>
          <p class="auth-sub">AI 图像 & PPT 平台</p>
        </div>
      </div>
      <SignIn />
    </div>
  </div>

  <!-- Ready -->
  <template v-else>
    <ApiKeySetup
      v-if="showSetup"
      :initial-key="apiKey"
      :initial-url="baseUrl"
      :initial-cursor-key="cursorKey"
      :initial-cursor-model="cursorModel"
      @save="onSaveKey"
    />
    <template v-else>
      <ImageGenerator
        v-if="activePage === 'image'"
        :api-key="apiKey"
        :base-url="baseUrl"
        :active-page="activePage"
        :get-token="getTokenFn"
        :user-display="userDisplay"
        @settings="onOpenSettings"
        @switch-page="onSwitchPage"
        @sign-out="handleSignOut"
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
</template>

<style>
.loading-screen {
  min-height: 100vh;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg);
}
.loading-spinner {
  width: 32px; height: 32px; border-radius: 50%;
  border: 2px solid rgba(196,129,58,0.2); border-top-color: #C4813A;
  animation: _spin 1s linear infinite;
}
@keyframes _spin { to { transform: rotate(360deg); } }

.auth-screen {
  min-height: 100vh;
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  background: radial-gradient(ellipse at 50% 0%, #2A1A0C 0%, #120E09 60%);
}
.auth-card { display: flex; flex-direction: column; align-items: center; gap: 28px; }
.auth-brand { display: flex; align-items: center; gap: 12px; }
.auth-title { font-size: 20px; font-weight: 700; color: #EAD9C0; letter-spacing: -0.3px; }
.auth-sub   { font-size: 13px; color: #8A6B50; margin-top: 2px; }
</style>
