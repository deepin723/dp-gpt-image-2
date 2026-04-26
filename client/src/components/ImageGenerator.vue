<script setup lang="ts">
import { ref, onUnmounted } from 'vue'

const props = defineProps<{ apiKey: string; baseUrl: string }>()
const emit = defineEmits<{ settings: [] }>()

interface HistoryItem {
  id: string
  prompt: string
  imageUrl: string
  ts: number
}

const prompt = ref('')
const isLoading = ref(false)
const imageUrl = ref('')
const errorMsg = ref('')
const progress = ref(0)
const currentMsgIndex = ref(0)

// History
const showHistory = ref(false)
const history = ref<HistoryItem[]>([])

// Reference image upload
const refImagePreview = ref('')
const refImageBase64 = ref('')
const refImageMime = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)

const loadingMessages = [
  '正在唤醒 AI 画师...',
  '像素世界构建中，请耐心等待...',
  '正在为作品添加最后的细节...',
]

let progressTimer: ReturnType<typeof setInterval> | null = null
let msgTimer: ReturnType<typeof setInterval> | null = null

const startLoading = () => {
  progress.value = 0
  currentMsgIndex.value = 0
  progressTimer = setInterval(() => {
    if (progress.value < 88) {
      const inc = Math.max(0.4, (88 - progress.value) / 25)
      progress.value = Math.min(88, progress.value + inc)
    }
  }, 1000)
  msgTimer = setInterval(() => {
    currentMsgIndex.value = (currentMsgIndex.value + 1) % loadingMessages.length
  }, 4000)
}

const stopLoading = async (success: boolean) => {
  if (progressTimer) clearInterval(progressTimer)
  if (msgTimer) clearInterval(msgTimer)
  if (success) {
    progress.value = 100
    await new Promise(r => setTimeout(r, 500))
  }
  progress.value = 0
  isLoading.value = false
}

const onFileChange = (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => {
    const result = ev.target?.result as string
    refImagePreview.value = result
    refImageBase64.value = result.split(',')[1]
    refImageMime.value = result.match(/data:([^;]+);/)?.[1] || 'image/jpeg'
  }
  reader.readAsDataURL(file)
}

const clearRefImage = () => {
  refImagePreview.value = ''
  refImageBase64.value = ''
  refImageMime.value = ''
  if (fileInputRef.value) fileInputRef.value.value = ''
}

const generate = async () => {
  if (!prompt.value.trim() || isLoading.value) return
  errorMsg.value = ''
  imageUrl.value = ''
  isLoading.value = true
  startLoading()
  try {
    const apiBase = import.meta.env.VITE_API_BASE || 'https://dp-gpt-image-2-production.up.railway.app'
    const body: Record<string, string> = { prompt: prompt.value.trim() }
    if (refImageBase64.value) {
      body.referenceImageBase64 = refImageBase64.value
      body.referenceImageMime = refImageMime.value
    }
    const res = await fetch(`${apiBase}/api/generate-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': props.apiKey,
        'x-base-url': props.baseUrl,
      },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (data.imageBase64) {
      imageUrl.value = `data:image/png;base64,${data.imageBase64}`
      history.value.unshift({
        id: Date.now().toString(),
        prompt: prompt.value.trim(),
        imageUrl: imageUrl.value,
        ts: Date.now(),
      })
      await stopLoading(true)
    } else {
      errorMsg.value = data.error || '生成失败，请重试'
      await stopLoading(false)
    }
  } catch {
    errorMsg.value = '网络错误，请稍后重试'
    await stopLoading(false)
  }
}

const downloadImage = () => {
  const a = document.createElement('a')
  a.href = imageUrl.value
  a.download = `deepin-image-${Date.now()}.png`
  a.click()
}

const reset = () => { imageUrl.value = ''; errorMsg.value = '' }

const loadHistory = (item: HistoryItem) => {
  imageUrl.value = item.imageUrl
  prompt.value = item.prompt
  showHistory.value = false
}

onUnmounted(() => {
  if (progressTimer) clearInterval(progressTimer)
  if (msgTimer) clearInterval(msgTimer)
})
</script>

<template>
  <div class="page">
    <!-- Header -->
    <header class="header">
      <div class="brand">
        <svg class="logo-svg" viewBox="0 0 36 36" fill="none">
          <rect width="36" height="36" rx="9" fill="#2A1A0C"/>
          <text x="8" y="26" font-size="20" font-weight="700" fill="#EAD9C0" font-family="serif">D</text>
          <rect x="8" y="28" width="20" height="1.5" rx="1" fill="#C4813A" opacity="0.7"/>
        </svg>
        <span class="brand-name">Deepin Image</span>
      </div>
      <div class="header-actions">
        <button class="btn-hist" :class="{ active: showHistory }" @click="showHistory = !showHistory">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" width="14" height="14">
            <circle cx="10" cy="10" r="8"/>
            <polyline points="10,6 10,10 13,12"/>
          </svg>
          历史{{ history.length ? ` (${history.length})` : '' }}
        </button>
        <button class="btn-icon" @click="emit('settings')" title="API Key 设置">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>
    </header>

    <!-- Tech Hero Banner -->
    <div class="hero-banner">
      <div class="banner-grid" />
      <div class="banner-glow" />
      <div class="banner-frames">
        <div class="frame f1"><div class="frame-inner" /></div>
        <div class="frame f2"><div class="frame-inner" /></div>
        <div class="frame f3"><div class="frame-inner" /></div>
      </div>
      <div class="banner-badge">gpt-image-2 · 高清生图</div>
    </div>

    <!-- Main -->
    <main class="main">

      <!-- 结果展示 -->
      <div v-if="imageUrl" class="result">
        <img :src="imageUrl" alt="生成图片" class="result-img" />
        <div class="result-bar">
          <button class="btn-dl" @click="downloadImage">
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path d="M10 14l-5-5h3V4h4v5h3l-5 5z"/>
              <rect x="3" y="16" width="14" height="2" rx="1"/>
            </svg>
            下载图片
          </button>
          <button class="btn-ghost" @click="reset">重新生成</button>
        </div>
      </div>

      <!-- 输入区 -->
      <template v-else>
        <div class="hero">
          <p class="eyebrow">Powered by gpt-image-2</p>
          <h2 class="title">描述你的想象<br/>AI 为你呈现</h2>
          <p class="subtitle">写一段文字描述，几分钟内生成一张高质量图像</p>
        </div>

        <div class="input-wrap">
          <!-- 参考图预览 -->
          <div v-if="refImagePreview" class="ref-preview">
            <img :src="refImagePreview" class="ref-thumb" alt="参考图" />
            <div class="ref-meta">
              <span class="ref-label">参考图已上传</span>
              <button class="ref-clear" @click="clearRefImage">移除</button>
            </div>
          </div>

          <textarea
            v-model="prompt"
            :disabled="isLoading"
            placeholder="例如：一位戴草帽的女孩坐在麦田边，金色夕阳光，胶片质感，16:9..."
            rows="4"
            @keydown.meta.enter="generate"
          />
          <div class="input-footer">
            <div class="footer-left">
              <button class="btn-upload" @click="fileInputRef?.click()">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" width="14" height="14">
                  <rect x="2" y="4" width="16" height="12" rx="2"/>
                  <circle cx="7" cy="9" r="1.5" fill="currentColor" stroke="none"/>
                  <path d="M2 14l4-4 3 3 3-3 4 4"/>
                </svg>
                {{ refImagePreview ? '更换参考图' : '上传参考图' }}
              </button>
              <input ref="fileInputRef" type="file" accept="image/*" class="file-input" @change="onFileChange" />
              <span class="shortcut">⌘ + Enter 发送</span>
            </div>
            <button class="btn-gen" :disabled="isLoading || !prompt.trim()" @click="generate">
              生成图片
            </button>
          </div>
        </div>

        <p v-if="errorMsg" class="err">{{ errorMsg }}</p>
      </template>
    </main>

    <!-- 加载遮罩 -->
    <Transition name="fade">
      <div v-if="isLoading" class="overlay">
        <div class="loader-box">
          <div class="rings">
            <div class="ring-outer" />
            <div class="ring-inner" />
            <div class="ring-dot" />
          </div>
          <Transition name="txt" mode="out-in">
            <p :key="currentMsgIndex" class="loader-msg">{{ loadingMessages[currentMsgIndex] }}</p>
          </Transition>
          <div class="prog-row">
            <div class="prog-track">
              <div class="prog-fill" :style="{ width: progress + '%' }" />
            </div>
            <span class="prog-pct">{{ Math.floor(progress) }}%</span>
          </div>
          <p class="loader-tip">图片生成通常需要 1 ~ 3 分钟</p>
        </div>
      </div>
    </Transition>

    <!-- History Drawer -->
    <Transition name="drawer">
      <div v-if="showHistory" class="drawer">
        <div class="drawer-header">
          <span class="drawer-title">历史记录</span>
          <button class="drawer-close" @click="showHistory = false">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" width="16" height="16">
              <path d="M5 5l10 10M15 5l-10 10"/>
            </svg>
          </button>
        </div>
        <div class="drawer-body">
          <div v-if="!history.length" class="drawer-empty">
            <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.2" width="36" height="36" opacity="0.3">
              <rect x="6" y="8" width="28" height="24" rx="3"/>
              <circle cx="14" cy="18" r="3"/>
              <path d="M6 26l7-7 5 5 5-5 9 9"/>
            </svg>
            <p>暂无历史记录</p>
            <small>生成图片后将在这里展示</small>
          </div>
          <div
            v-for="item in history"
            :key="item.id"
            class="hist-item"
            @click="loadHistory(item)"
          >
            <img :src="item.imageUrl" class="hist-thumb" alt="历史图片" />
            <p class="hist-prompt">{{ item.prompt.length > 38 ? item.prompt.slice(0, 38) + '…' : item.prompt }}</p>
          </div>
        </div>
      </div>
    </Transition>
    <div v-if="showHistory" class="drawer-mask" @click="showHistory = false" />
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: radial-gradient(ellipse at 50% 0%, #221508 0%, #120E09 65%);
}

/* ── Header ── */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 28px;
  border-bottom: 1px solid var(--border);
}

.brand { display: flex; align-items: center; gap: 10px; }
.logo-svg { width: 32px; height: 32px; }
.brand-name { font-size: 16px; font-weight: 700; color: var(--text); letter-spacing: -0.2px; }

.header-actions { display: flex; align-items: center; gap: 8px; }

.btn-hist {
  display: flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
  color: var(--text-2);
  font-size: 13px;
  transition: color 0.2s, border-color 0.2s, background 0.2s;
}
.btn-hist:hover, .btn-hist.active {
  color: var(--accent);
  border-color: rgba(196,129,58,0.4);
  background: rgba(196,129,58,0.06);
}

.btn-icon {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 7px;
  cursor: pointer;
  color: var(--text-2);
  transition: color 0.2s, border-color 0.2s;
  display: flex;
}
.btn-icon:hover { color: var(--text); border-color: rgba(196,129,58,0.4); }
.btn-icon svg { width: 17px; height: 17px; }

/* ── Hero Banner ── */
.hero-banner {
  position: relative;
  height: 140px;
  overflow: hidden;
  border-bottom: 1px solid var(--border);
}
.banner-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(196,129,58,0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(196,129,58,0.07) 1px, transparent 1px);
  background-size: 32px 32px;
}
.banner-glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse 60% 120% at 50% 50%, rgba(196,129,58,0.13) 0%, transparent 70%);
}
.banner-frames {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
}
.frame {
  border: 1px solid rgba(196,129,58,0.35);
  border-radius: 7px;
  overflow: hidden;
  box-shadow: 0 6px 20px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04);
}
.frame-inner { width: 100%; height: 100%; }
.f1 { width: 68px; height: 52px; animation: float1 6s ease-in-out infinite; }
.f2 { width: 90px; height: 68px; animation: float2 7s ease-in-out infinite 0.4s; }
.f3 { width: 68px; height: 52px; animation: float1 5.5s ease-in-out infinite 1.1s; }
.f1 .frame-inner { background: linear-gradient(135deg, #2a1a06 0%, #5c3010 45%, #1e1408 100%); }
.f2 .frame-inner { background: linear-gradient(135deg, #12100f 0%, #3a2515 40%, #1c1408 70%, #0e0e14 100%); }
.f3 .frame-inner { background: linear-gradient(135deg, #0d1510 0%, #1a3018 45%, #0d1208 100%); }
@keyframes float1 { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
@keyframes float2 { 0%,100% { transform: translateY(0); } 50% { transform: translateY(7px); } }

.banner-badge {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  color: var(--accent);
  letter-spacing: 1.2px;
  text-transform: uppercase;
  padding: 3px 10px;
  border: 1px solid rgba(196,129,58,0.22);
  border-radius: 99px;
  background: rgba(18,14,9,0.7);
  white-space: nowrap;
}

/* ── Main ── */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: 44px 24px 60px;
  gap: 28px;
}

/* ── Hero Text ── */
.hero { text-align: center; }
.eyebrow {
  display: inline-block;
  font-size: 12px;
  color: var(--accent);
  letter-spacing: 1.4px;
  text-transform: uppercase;
  margin-bottom: 16px;
  padding: 4px 14px;
  border: 1px solid rgba(196,129,58,0.25);
  border-radius: 99px;
}
.title {
  font-size: 40px;
  font-weight: 700;
  line-height: 1.2;
  color: var(--text);
  margin-bottom: 14px;
  letter-spacing: -0.8px;
}
.subtitle { font-size: 16px; color: var(--text-2); }

/* ── Input ── */
.input-wrap {
  width: 100%;
  max-width: 680px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 16px;
  overflow: hidden;
  transition: border-color 0.2s;
}
.input-wrap:focus-within { border-color: rgba(196,129,58,0.45); }

.ref-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  background: rgba(196,129,58,0.04);
}
.ref-thumb {
  width: 52px;
  height: 52px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--border);
}
.ref-meta { display: flex; flex-direction: column; gap: 4px; }
.ref-label { font-size: 12px; color: var(--accent); }
.ref-clear {
  font-size: 12px;
  color: var(--text-3);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  text-align: left;
  transition: color 0.2s;
}
.ref-clear:hover { color: #E07050; }

textarea {
  width: 100%;
  background: transparent;
  border: none;
  color: var(--text);
  font-size: 16px;
  line-height: 1.7;
  padding: 20px;
  resize: none;
  outline: none;
  font-family: inherit;
}
textarea::placeholder { color: var(--text-3); }
textarea:disabled { opacity: 0.45; }

.input-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}
.footer-left { display: flex; align-items: center; gap: 12px; }

.btn-upload {
  display: flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 5px 10px;
  cursor: pointer;
  color: var(--text-2);
  font-size: 12px;
  transition: color 0.2s, border-color 0.2s;
}
.btn-upload:hover { color: var(--text); border-color: rgba(196,129,58,0.35); }

.file-input { display: none; }
.shortcut { font-size: 12px; color: var(--text-3); }

.btn-gen {
  padding: 9px 22px;
  background: linear-gradient(135deg, var(--accent), var(--accent-dk));
  border: none;
  border-radius: 9px;
  color: #FFF8F0;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
  box-shadow: 0 3px 12px rgba(196,129,58,0.28);
}
.btn-gen:hover:not(:disabled) { opacity: 0.88; }
.btn-gen:active:not(:disabled) { transform: scale(0.97); }
.btn-gen:disabled { opacity: 0.3; cursor: not-allowed; }

.err { font-size: 13px; color: #E07050; }

/* ── Result ── */
.result {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  width: 100%;
  max-width: 580px;
}
.result-img {
  width: 100%;
  border-radius: 14px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px var(--border);
  animation: fadeUp 0.45s ease;
}
.result-bar { display: flex; gap: 12px; }
.btn-dl {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 22px;
  background: linear-gradient(135deg, var(--accent), var(--accent-dk));
  border: none;
  border-radius: 9px;
  color: #FFF8F0;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
  box-shadow: 0 3px 12px rgba(196,129,58,0.28);
}
.btn-dl:hover { opacity: 0.88; }
.btn-ghost {
  padding: 10px 22px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 9px;
  color: var(--text-2);
  font-size: 14px;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s;
}
.btn-ghost:hover { border-color: rgba(196,129,58,0.4); color: var(--text); }

/* ── Loading Overlay ── */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(18, 14, 9, 0.9);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.loader-box {
  text-align: center;
  padding: 48px 40px;
  width: 360px;
}
.rings {
  position: relative;
  width: 76px;
  height: 76px;
  margin: 0 auto 32px;
}
.ring-outer {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2.5px solid transparent;
  border-top-color: var(--accent);
  border-right-color: var(--accent-lt);
  animation: spin 1.4s linear infinite;
}
.ring-inner {
  position: absolute;
  inset: 13px;
  border-radius: 50%;
  border: 2px solid transparent;
  border-bottom-color: var(--accent-dk);
  animation: spin 0.9s linear infinite reverse;
}
.ring-dot {
  position: absolute;
  inset: 29px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0.6;
  animation: pulse 1.4s ease-in-out infinite;
}
.loader-msg {
  font-size: 16px;
  color: var(--text);
  font-weight: 500;
  margin-bottom: 28px;
  min-height: 24px;
}
.prog-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.prog-track {
  flex: 1;
  height: 5px;
  background: rgba(255,255,255,0.06);
  border-radius: 99px;
  overflow: hidden;
}
.prog-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent-dk), var(--accent-lt));
  border-radius: 99px;
  transition: width 0.9s ease;
  box-shadow: 0 0 8px rgba(196,129,58,0.5);
}
.prog-pct { font-size: 12px; color: var(--text-2); width: 34px; text-align: right; }
.loader-tip { font-size: 13px; color: var(--text-3); }

/* ── History Drawer ── */
.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 300px;
  background: var(--bg-card);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  z-index: 90;
  box-shadow: -20px 0 60px rgba(0,0,0,0.5);
}
.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.drawer-title { font-size: 15px; font-weight: 600; color: var(--text); }
.drawer-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-2);
  display: flex;
  padding: 4px;
  border-radius: 6px;
  transition: color 0.2s, background 0.2s;
}
.drawer-close:hover { color: var(--text); background: rgba(255,255,255,0.05); }
.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.drawer-body::-webkit-scrollbar { width: 4px; }
.drawer-body::-webkit-scrollbar-track { background: transparent; }
.drawer-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; }

.drawer-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 48px 16px;
  text-align: center;
}
.drawer-empty p { font-size: 14px; color: var(--text-2); }
.drawer-empty small { font-size: 12px; color: var(--text-3); }

.hist-item {
  cursor: pointer;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  transition: border-color 0.2s, transform 0.15s;
}
.hist-item:hover { border-color: rgba(196,129,58,0.4); transform: translateY(-1px); }
.hist-thumb {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  display: block;
}
.hist-prompt {
  padding: 9px 12px;
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.5;
  border-top: 1px solid var(--border);
}

.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  z-index: 89;
}

/* ── Transitions ── */
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.txt-enter-active, .txt-leave-active { transition: all 0.38s ease; }
.txt-enter-from { opacity: 0; transform: translateY(8px); }
.txt-leave-to { opacity: 0; transform: translateY(-8px); }
.drawer-enter-active, .drawer-leave-active { transition: transform 0.3s ease; }
.drawer-enter-from, .drawer-leave-to { transform: translateX(100%); }

@keyframes spin    { to { transform: rotate(360deg); } }
@keyframes pulse   { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }
@keyframes fadeUp  { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
</style>
