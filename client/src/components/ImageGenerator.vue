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
  '像素宇宙构建中，请耐心等待...',
  '正在为作品添加最后的细节...',
]

let progressTimer: ReturnType<typeof setInterval> | null = null
let msgTimer: ReturnType<typeof setInterval> | null = null

const startLoading = () => {
  progress.value = 0
  currentMsgIndex.value = 0

  // 假进度条：每秒推进，越接近 88% 越慢
  progressTimer = setInterval(() => {
    if (progress.value < 88) {
      const increment = Math.max(0.4, (88 - progress.value) / 25)
      progress.value = Math.min(88, progress.value + increment)
    }
  }, 1000)

  // 提示语每 4 秒切换一次
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
  a.download = `deepin6677-${Date.now()}.png`
  a.click()
}

const reset = () => {
  imageUrl.value = ''
  errorMsg.value = ''
}

onUnmounted(() => {
  if (progressTimer) clearInterval(progressTimer)
  if (msgTimer) clearInterval(msgTimer)
})
</script>

<template>
  <div class="page">
    <!-- 顶部 Header -->
    <header class="header">
      <div class="brand">
        <div class="logo">D</div>
        <span class="brand-name">Deepin6677</span>
        <span class="brand-tag">AI 图像生成</span>
      </div>
      <button class="btn-settings" @click="emit('settings')" title="设置 API Key">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
    </header>

    <!-- 主内容 -->
    <main class="main">
      <!-- 生成结果 -->
      <div v-if="imageUrl" class="result-area">
        <img :src="imageUrl" alt="AI 生成图片" class="result-image" />
        <div class="result-actions">
          <button class="btn-download" @click="downloadImage">下载图片</button>
          <button class="btn-retry" @click="reset">重新生成</button>
        </div>
      </div>

      <!-- 输入区（无图片时展示）-->
      <template v-else>
        <div class="hero">
          <h2 class="hero-title">描述你的想象，<br/>AI 帮你画出来</h2>
          <p class="hero-sub">基于 gpt-image-2 · 写一段描述，生成高质量图像</p>
        </div>

        <div class="input-area">
          <textarea
            v-model="prompt"
            placeholder="例如：一位韩系风格的女孩站在霓虹灯街头，电影感，9:16 竖幅..."
            :disabled="isLoading"
            @keydown.meta.enter="generate"
            rows="4"
          />
          <div class="input-footer">
            <span class="hint">⌘ + Enter 发送</span>
            <button class="btn-generate" :disabled="isLoading || !prompt.trim()" @click="generate">
              生成图片
            </button>
          </div>
        </div>

        <p v-if="errorMsg" class="error-msg">{{ errorMsg }}</p>
      </template>
    </main>

    <!-- 加载遮罩 -->
    <Transition name="fade">
      <div v-if="isLoading" class="loading-overlay">
        <div class="loading-card">
          <!-- 旋转光环 -->
          <div class="spinner-wrap">
            <div class="spinner" />
            <div class="spinner-inner" />
          </div>

          <!-- 切换文字 -->
          <Transition name="slide-msg" mode="out-in">
            <p :key="currentMsgIndex" class="loading-msg">
              {{ loadingMessages[currentMsgIndex] }}
            </p>
          </Transition>

          <!-- 假进度条 -->
          <div class="progress-wrap">
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: progress + '%' }" />
            </div>
            <span class="progress-text">{{ Math.floor(progress) }}%</span>
          </div>

          <p class="loading-tip">图片生成通常需要 1~3 分钟，请耐心等待</p>
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
  background: radial-gradient(ellipse at top, #1a1035 0%, #0d0d1a 70%);
}

/* Header */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 28px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea, #764ba2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 800;
  color: white;
}

.brand-name {
  font-size: 16px;
  font-weight: 700;
  color: #f0f0ff;
}

.brand-tag {
  font-size: 12px;
  color: #4b5563;
  background: rgba(255,255,255,0.05);
  padding: 3px 8px;
  border-radius: 20px;
}

.btn-settings {
  background: transparent;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  padding: 8px;
  cursor: pointer;
  color: #6b7280;
  transition: color 0.2s, border-color 0.2s;
  display: flex;
}
.btn-settings:hover { color: #e2e8f0; border-color: rgba(255,255,255,0.2); }
.btn-settings svg { width: 18px; height: 18px; }

/* Main */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
  gap: 32px;
}

/* Hero */
.hero { text-align: center; }
.hero-title {
  font-size: 32px;
  font-weight: 700;
  line-height: 1.3;
  background: linear-gradient(135deg, #c4b5fd, #818cf8, #a78bfa);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 12px;
}
.hero-sub { font-size: 14px; color: #4b5563; }

/* Input */
.input-area {
  width: 100%;
  max-width: 680px;
  background: #16162a;
  border: 1px solid rgba(102, 126, 234, 0.2);
  border-radius: 16px;
  overflow: hidden;
  transition: border-color 0.2s;
}
.input-area:focus-within { border-color: rgba(102, 126, 234, 0.5); }

textarea {
  width: 100%;
  background: transparent;
  border: none;
  color: #e2e8f0;
  font-size: 15px;
  line-height: 1.7;
  padding: 20px;
  resize: none;
  outline: none;
  font-family: inherit;
}
textarea::placeholder { color: #374151; }
textarea:disabled { opacity: 0.5; }

.input-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid rgba(255,255,255,0.05);
}

.hint { font-size: 12px; color: #374151; }

.btn-generate {
  padding: 10px 24px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  border: none;
  border-radius: 10px;
  color: white;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
}
.btn-generate:hover:not(:disabled) { opacity: 0.9; }
.btn-generate:active:not(:disabled) { transform: scale(0.97); }
.btn-generate:disabled { opacity: 0.35; cursor: not-allowed; }

.error-msg {
  color: #f87171;
  font-size: 14px;
  text-align: center;
}

/* Result */
.result-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  width: 100%;
  max-width: 600px;
}

.result-image {
  width: 100%;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.6);
  animation: fadeUp 0.4s ease;
}

.result-actions {
  display: flex;
  gap: 12px;
}

.btn-download {
  padding: 11px 28px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  border: none;
  border-radius: 10px;
  color: white;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}
.btn-download:hover { opacity: 0.9; }

.btn-retry {
  padding: 11px 28px;
  background: transparent;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 10px;
  color: #9ca3af;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s;
}
.btn-retry:hover { border-color: rgba(255,255,255,0.3); color: #e2e8f0; }

/* Loading Overlay */
.loading-overlay {
  position: fixed;
  inset: 0;
  background: rgba(13, 13, 26, 0.92);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.loading-card {
  text-align: center;
  padding: 48px 40px;
  width: 360px;
}

/* 双环旋转 */
.spinner-wrap {
  position: relative;
  width: 80px;
  height: 80px;
  margin: 0 auto 32px;
}

.spinner {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 3px solid transparent;
  border-top-color: #667eea;
  border-right-color: #764ba2;
  animation: spin 1.2s linear infinite;
}

.spinner-inner {
  position: absolute;
  inset: 12px;
  border-radius: 50%;
  border: 2px solid transparent;
  border-bottom-color: #a78bfa;
  animation: spin 0.8s linear infinite reverse;
}

.loading-msg {
  font-size: 16px;
  color: #c4b5fd;
  font-weight: 500;
  margin-bottom: 28px;
  min-height: 24px;
}

.progress-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background: rgba(255,255,255,0.08);
  border-radius: 999px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #667eea, #a78bfa);
  border-radius: 999px;
  transition: width 0.8s ease;
  box-shadow: 0 0 8px rgba(102, 126, 234, 0.6);
}

.progress-text {
  font-size: 13px;
  color: #6b7280;
  width: 36px;
  text-align: right;
}

.loading-tip {
  font-size: 12px;
  color: #374151;
}

/* Transitions */
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.slide-msg-enter-active, .slide-msg-leave-active { transition: all 0.4s ease; }
.slide-msg-enter-from { opacity: 0; transform: translateY(10px); }
.slide-msg-leave-to { opacity: 0; transform: translateY(-10px); }

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
</style>
