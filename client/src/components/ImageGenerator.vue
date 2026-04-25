<script setup lang="ts">
import { ref, onUnmounted } from 'vue'

const props = defineProps<{ apiKey: string; baseUrl: string }>()
const emit = defineEmits<{ settings: [] }>()

const prompt = ref('')
const isLoading = ref(false)
const imageUrl = ref('')
const errorMsg = ref('')
const progress = ref(0)
const currentMsgIndex = ref(0)

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

const generate = async () => {
  if (!prompt.value.trim() || isLoading.value) return
  errorMsg.value = ''
  imageUrl.value = ''
  isLoading.value = true
  startLoading()
  try {
    const res = await fetch('/api/generate-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': props.apiKey,
        'x-base-url': props.baseUrl,
      },
      body: JSON.stringify({ prompt: prompt.value.trim() }),
    })
    const data = await res.json()
    if (data.imageBase64) {
      imageUrl.value = `data:image/png;base64,${data.imageBase64}`
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
      <button class="btn-icon" @click="emit('settings')" title="API Key 设置">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
    </header>

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
          <textarea
            v-model="prompt"
            :disabled="isLoading"
            placeholder="例如：一位戴草帽的女孩坐在麦田边，金色夕阳光，胶片质感，16:9..."
            rows="4"
            @keydown.meta.enter="generate"
          />
          <div class="input-footer">
            <span class="shortcut">⌘ + Enter 发送</span>
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
          <!-- 旋转圆环 -->
          <div class="rings">
            <div class="ring-outer" />
            <div class="ring-inner" />
            <div class="ring-dot" />
          </div>

          <!-- 提示语切换 -->
          <Transition name="txt" mode="out-in">
            <p :key="currentMsgIndex" class="loader-msg">{{ loadingMessages[currentMsgIndex] }}</p>
          </Transition>

          <!-- 进度条 -->
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
.brand-name { font-size: 15px; font-weight: 700; color: var(--text); letter-spacing: -0.2px; }

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

/* ── Main ── */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  gap: 36px;
}

/* ── Hero ── */
.hero { text-align: center; }
.eyebrow {
  display: inline-block;
  font-size: 11px;
  color: var(--accent);
  letter-spacing: 1.4px;
  text-transform: uppercase;
  margin-bottom: 16px;
  padding: 4px 12px;
  border: 1px solid rgba(196,129,58,0.25);
  border-radius: 99px;
}
.title {
  font-size: 34px;
  font-weight: 700;
  line-height: 1.25;
  color: var(--text);
  margin-bottom: 12px;
  letter-spacing: -0.5px;
}
.subtitle { font-size: 14px; color: var(--text-2); }

/* ── Input ── */
.input-wrap {
  width: 100%;
  max-width: 660px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 16px;
  overflow: hidden;
  transition: border-color 0.2s;
}
.input-wrap:focus-within { border-color: rgba(196,129,58,0.45); }

textarea {
  width: 100%;
  background: transparent;
  border: none;
  color: var(--text);
  font-size: 15px;
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

/* 三层圆环 */
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
  font-size: 15px;
  color: var(--text);
  font-weight: 500;
  margin-bottom: 28px;
  min-height: 22px;
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
.loader-tip { font-size: 12px; color: var(--text-3); }

/* ── Transitions ── */
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.txt-enter-active, .txt-leave-active { transition: all 0.38s ease; }
.txt-enter-from { opacity: 0; transform: translateY(8px); }
.txt-leave-to { opacity: 0; transform: translateY(-8px); }

@keyframes spin    { to { transform: rotate(360deg); } }
@keyframes pulse   { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }
@keyframes fadeUp  { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
</style>
