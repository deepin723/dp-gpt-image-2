<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'

const props = defineProps<{ apiKey: string; baseUrl: string }>()
const emit = defineEmits<{ settings: [] }>()

// ── Types ─────────────────────────────────────────────────────
interface Task {
  id: string
  prompt: string
  size: string
  referenceImageBase64?: string
  referenceImageMime?: string
  status: 'queued' | 'generating' | 'done' | 'error'
  progress: number
  msgIndex: number
  imageUrl?: string
  error?: string
  ts: number
}

interface HistoryItem {
  id: string; prompt: string; imageUrl: string; ts: number
}

// ── Constants ─────────────────────────────────────────────────
const SIZES = [
  { label: '方形', desc: '1:1', value: '1024x1024' },
  { label: '横版', desc: '3:2', value: '1536x1024' },
  { label: '竖版', desc: '2:3', value: '1024x1536' },
] as const

const STYLES = ['电影感', '写实摄影', '水彩插画', '赛博朋克', '胶片质感', '动漫风格', '油画质感', '极简主义']

const STYLE_EN: Record<string, string> = {
  '电影感':   'cinematic lighting, film look',
  '写实摄影': 'photorealistic, DSLR photography',
  '水彩插画': 'watercolor illustration style',
  '赛博朋克': 'cyberpunk aesthetic, neon lights',
  '胶片质感': 'film grain, analog photography, vintage',
  '动漫风格': 'anime style illustration',
  '油画质感': 'oil painting texture, painterly',
  '极简主义': 'minimalist design, clean composition',
}

const LOADING_MSGS = [
  '正在唤醒 AI 画师...',
  '像素世界构建中，请耐心等待...',
  '正在为作品添加最后的细节...',
]

// ── UI state ──────────────────────────────────────────────────
const prompt        = ref('')
const isEnhancing   = ref(false)
const imageUrl      = ref('')   // currently viewed result
const genPrompt     = ref('')   // prompt of currently viewed result
const selectedSize  = ref('1024x1024')
const activeStyles  = ref<string[]>([])
const copiedImage   = ref(false)

// Reference image
const refImagePreview = ref('')
const refImageBase64  = ref('')
const refImageMime    = ref('')
const fileInputRef    = ref<HTMLInputElement | null>(null)

// Task queue
const tasks         = ref<Task[]>([])
const panelExpanded = ref(false)
let   isProcessing  = false
let   timerCleanup: (() => void) | null = null

// History drawer
const showHistory = ref(false)
const history     = ref<HistoryItem[]>([])

// ── Computed ──────────────────────────────────────────────────
const generatingTask = computed(() => tasks.value.find(t => t.status === 'generating'))
const queuedCount    = computed(() => tasks.value.filter(t => t.status === 'queued').length)
const hasDoneTasks   = computed(() => tasks.value.some(t => t.status === 'done' || t.status === 'error'))

const panelStatusText = computed(() => {
  if (generatingTask.value) {
    return queuedCount.value > 0
      ? `生成中 · 还有 ${queuedCount.value} 个排队`
      : '生成中...'
  }
  const done = tasks.value.filter(t => t.status === 'done').length
  const err  = tasks.value.filter(t => t.status === 'error').length
  if (err > 0 && done === 0) return `${err} 个任务失败`
  if (err > 0) return `${done} 个完成 · ${err} 个失败`
  return `${done} 个任务已完成`
})

const apiBase = () => import.meta.env.VITE_API_BASE || 'https://dp-gpt-image-2-production.up.railway.app'

// ── File upload ───────────────────────────────────────────────
const onFileChange = (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => {
    const result = ev.target?.result as string
    refImagePreview.value = result
    refImageBase64.value  = result.split(',')[1]
    refImageMime.value    = result.match(/data:([^;]+);/)?.[1] || 'image/jpeg'
  }
  reader.readAsDataURL(file)
}

const clearRefImage = () => {
  refImagePreview.value = ''; refImageBase64.value = ''; refImageMime.value = ''
  if (fileInputRef.value) fileInputRef.value.value = ''
}

// ── Styles ────────────────────────────────────────────────────
const toggleStyle = (style: string) => {
  const idx = activeStyles.value.indexOf(style)
  if (idx >= 0) activeStyles.value.splice(idx, 1)
  else activeStyles.value.push(style)
}

const buildPrompt = () => {
  const base = prompt.value.trim()
  if (!activeStyles.value.length) return base
  return `${base}, ${activeStyles.value.map(s => STYLE_EN[s]).join(', ')}`
}

// ── Enhance ───────────────────────────────────────────────────
const enhancePrompt = async () => {
  if (!prompt.value.trim() || isEnhancing.value) return
  isEnhancing.value = true
  try {
    const res = await fetch(`${apiBase()}/api/enhance-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': props.apiKey, 'x-base-url': props.baseUrl },
      body: JSON.stringify({ prompt: prompt.value.trim() }),
    })
    const data = await res.json()
    if (data.enhanced) prompt.value = data.enhanced
  } catch { /* silent */ }
  finally { isEnhancing.value = false }
}

// ── Submit to queue ───────────────────────────────────────────
const submit = () => {
  if (!prompt.value.trim()) return
  const task: Task = {
    id: Date.now().toString(),
    prompt: buildPrompt(),
    size: selectedSize.value,
    referenceImageBase64: refImageBase64.value || undefined,
    referenceImageMime:   refImageMime.value   || undefined,
    status: 'queued',
    progress: 0,
    msgIndex: 0,
    ts: Date.now(),
  }
  tasks.value.push(task)
  panelExpanded.value = true
  // Reset input for next task
  prompt.value = ''
  activeStyles.value = []
  clearRefImage()
  processNext()
}

// ── Queue processor ───────────────────────────────────────────
const processNext = async () => {
  if (isProcessing) return
  const task = tasks.value.find(t => t.status === 'queued')
  if (!task) return

  isProcessing = true
  task.status   = 'generating'
  task.progress = 0
  task.msgIndex = 0

  const pt = setInterval(() => {
    if (task.progress < 88) {
      const inc = Math.max(0.4, (88 - task.progress) / 25)
      task.progress = Math.min(88, task.progress + inc)
    }
  }, 1000)
  const mt = setInterval(() => {
    task.msgIndex = (task.msgIndex + 1) % LOADING_MSGS.length
  }, 4000)
  timerCleanup = () => { clearInterval(pt); clearInterval(mt) }

  try {
    const body: Record<string, string> = { prompt: task.prompt, size: task.size }
    if (task.referenceImageBase64) {
      body.referenceImageBase64 = task.referenceImageBase64
      body.referenceImageMime   = task.referenceImageMime || 'image/jpeg'
    }
    const res = await fetch(`${apiBase()}/api/generate-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': props.apiKey, 'x-base-url': props.baseUrl },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    clearInterval(pt); clearInterval(mt)

    if (data.imageBase64) {
      task.imageUrl = `data:image/png;base64,${data.imageBase64}`
      task.progress = 100
      await new Promise(r => setTimeout(r, 400))
      task.status = 'done'
      history.value.unshift({ id: task.id, prompt: task.prompt, imageUrl: task.imageUrl, ts: task.ts })
    } else {
      task.error  = data.error || '生成失败，请重试'
      task.status = 'error'
    }
  } catch {
    clearInterval(pt); clearInterval(mt)
    task.error  = '网络错误，请稍后重试'
    task.status = 'error'
  }

  timerCleanup  = null
  isProcessing  = false
  processNext()
}

// ── Task panel actions ────────────────────────────────────────
const viewTask = (task: Task) => {
  if (!task.imageUrl) return
  imageUrl.value = task.imageUrl
  genPrompt.value = task.prompt
}

const clearDone = () => {
  tasks.value = tasks.value.filter(t => t.status === 'queued' || t.status === 'generating')
  if (tasks.value.length === 0) panelExpanded.value = false
}

// ── Result actions ────────────────────────────────────────────
const downloadImage = () => {
  const a = document.createElement('a')
  a.href = imageUrl.value; a.download = `deepin-image-${Date.now()}.png`; a.click()
}

const copyImage = async () => {
  try {
    const res  = await fetch(imageUrl.value)
    const blob = await res.blob()
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  } catch { /* browser may not support */ }
  copiedImage.value = true
  setTimeout(() => { copiedImage.value = false }, 2000)
}

const editPrompt   = () => { prompt.value = genPrompt.value; imageUrl.value = '' }
const backToInput  = () => { imageUrl.value = '' }
const regenerate   = () => {
  const task: Task = {
    id: Date.now().toString(), prompt: genPrompt.value, size: selectedSize.value,
    status: 'queued', progress: 0, msgIndex: 0, ts: Date.now(),
  }
  tasks.value.push(task)
  panelExpanded.value = true
  imageUrl.value = ''
  processNext()
}

// ── History ───────────────────────────────────────────────────
const loadHistory = (item: HistoryItem) => {
  imageUrl.value  = item.imageUrl
  genPrompt.value = item.prompt
  showHistory.value = false
}

onUnmounted(() => { timerCleanup?.() })
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
            <circle cx="10" cy="10" r="8"/><polyline points="10,6 10,10 13,12"/>
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
        <div class="result-prompt">
          <span class="result-prompt-label">提示词</span>
          <p class="result-prompt-text">{{ genPrompt }}</p>
        </div>
        <div class="result-bar">
          <button class="btn-dl" @click="downloadImage">
            <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15">
              <path d="M10 14l-5-5h3V4h4v5h3l-5 5z"/>
              <rect x="3" y="16" width="14" height="2" rx="1"/>
            </svg>
            下载图片
          </button>
          <button class="btn-copy" :class="{ done: copiedImage }" @click="copyImage">
            <svg v-if="!copiedImage" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" width="15" height="15">
              <rect x="7" y="7" width="10" height="10" rx="2"/><path d="M4 13V4a1 1 0 0 1 1-1h9"/>
            </svg>
            <svg v-else viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
              <polyline points="4,10 8,14 16,6"/>
            </svg>
            {{ copiedImage ? '已复制' : '复制图片' }}
          </button>
          <button class="btn-ghost" @click="editPrompt">修改描述</button>
          <button class="btn-ghost" @click="regenerate">重新生成</button>
          <button class="btn-ghost" @click="backToInput">新建生成</button>
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
          <!-- 尺寸选择 -->
          <div class="size-row">
            <button
              v-for="s in SIZES" :key="s.value"
              class="size-btn" :class="{ active: selectedSize === s.value }"
              @click="selectedSize = s.value"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="size-icon">
                <rect v-if="s.value === '1024x1024'" x="4" y="4" width="16" height="16" rx="2"/>
                <rect v-else-if="s.value === '1536x1024'" x="2" y="6" width="20" height="12" rx="2"/>
                <rect v-else x="6" y="2" width="12" height="20" rx="2"/>
              </svg>
              <span class="size-label">{{ s.label }}</span>
              <span class="size-desc">{{ s.desc }}</span>
            </button>
          </div>

          <!-- 参考图预览 -->
          <div v-if="refImagePreview" class="ref-preview">
            <img :src="refImagePreview" class="ref-thumb" alt="参考图" />
            <div class="ref-meta">
              <span class="ref-label">参考图已上传</span>
              <button class="ref-clear" @click="clearRefImage">移除</button>
            </div>
          </div>

          <!-- 输入框 -->
          <textarea
            v-model="prompt"
            placeholder="例如：一位戴草帽的女孩坐在麦田边，金色夕阳光，胶片质感，16:9..."
            rows="4"
            @keydown.meta.enter="submit"
          />

          <!-- 风格标签 -->
          <div class="styles-row">
            <button
              v-for="style in STYLES" :key="style"
              class="style-chip" :class="{ active: activeStyles.includes(style) }"
              @click="toggleStyle(style)"
            >{{ style }}</button>
          </div>

          <!-- 底部操作栏 -->
          <div class="input-footer">
            <div class="footer-left">
              <button class="btn-enhance" :disabled="isEnhancing || !prompt.trim()" @click="enhancePrompt">
                <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13">
                  <path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5z"/>
                </svg>
                {{ isEnhancing ? '优化中...' : '优化描述' }}
              </button>
              <button class="btn-upload" @click="fileInputRef?.click()">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" width="14" height="14">
                  <rect x="2" y="4" width="16" height="12" rx="2"/>
                  <circle cx="7" cy="9" r="1.5" fill="currentColor" stroke="none"/>
                  <path d="M2 14l4-4 3 3 3-3 4 4"/>
                </svg>
                {{ refImagePreview ? '更换参考图' : '上传参考图' }}
              </button>
              <input ref="fileInputRef" type="file" accept="image/*" class="file-input" @change="onFileChange" />
              <span class="shortcut">⌘↩ 发送</span>
            </div>
            <button class="btn-gen" :disabled="!prompt.trim()" @click="submit">
              生成图片
            </button>
          </div>
        </div>
      </template>
    </main>

    <!-- ── Floating Task Panel ── -->
    <Transition name="panel-slide">
      <div v-if="tasks.length > 0" class="task-panel">
        <!-- Compact bar -->
        <div class="panel-bar" @click="panelExpanded = !panelExpanded">
          <div class="panel-bar-left">
            <!-- Spinner or check -->
            <div v-if="generatingTask" class="panel-spinner" />
            <svg v-else viewBox="0 0 16 16" fill="none" stroke="#6dc87a" stroke-width="2" width="14" height="14">
              <polyline points="2,8 6,12 14,4"/>
            </svg>
            <span class="panel-status-text">{{ panelStatusText }}</span>
          </div>
          <div class="panel-bar-right">
            <span v-if="generatingTask" class="panel-pct">{{ Math.floor(generatingTask.progress) }}%</span>
            <svg
              viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"
              width="14" height="14" class="panel-chevron" :class="{ up: panelExpanded }"
            >
              <polyline points="3,10 8,5 13,10"/>
            </svg>
          </div>
          <!-- Progress line -->
          <div v-if="generatingTask" class="panel-bar-line" :style="{ width: generatingTask.progress + '%' }" />
        </div>

        <!-- Expanded task list -->
        <Transition name="panel-expand">
          <div v-if="panelExpanded" class="panel-body">
            <div
              v-for="task in [...tasks].reverse()" :key="task.id"
              class="task-item"
              :class="[task.status, { clickable: task.status === 'done' }]"
              @click="task.status === 'done' && viewTask(task)"
            >
              <!-- Thumbnail / placeholder -->
              <div class="task-thumb">
                <img v-if="task.imageUrl" :src="task.imageUrl" alt="" />
                <div v-else class="task-thumb-ph">
                  <div v-if="task.status === 'generating'" class="task-mini-spin" />
                  <svg v-else-if="task.status === 'queued'" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" width="18" height="18" opacity="0.4">
                    <circle cx="10" cy="10" r="8"/><polyline points="10,6 10,10 13,12"/>
                  </svg>
                  <svg v-else viewBox="0 0 20 20" fill="none" stroke="#E07050" stroke-width="1.8" width="18" height="18">
                    <path d="M5 5l10 10M15 5l-10 10"/>
                  </svg>
                </div>
              </div>

              <!-- Info -->
              <div class="task-info">
                <p class="task-prompt">{{ task.prompt.length > 42 ? task.prompt.slice(0, 42) + '…' : task.prompt }}</p>
                <!-- Generating state -->
                <template v-if="task.status === 'generating'">
                  <div class="task-prog-row">
                    <div class="task-prog-track">
                      <div class="task-prog-fill" :style="{ width: task.progress + '%' }" />
                    </div>
                    <span class="task-pct">{{ Math.floor(task.progress) }}%</span>
                  </div>
                  <p class="task-msg">{{ LOADING_MSGS[task.msgIndex] }}</p>
                </template>
                <!-- Queued -->
                <span v-else-if="task.status === 'queued'" class="task-badge queued">排队中</span>
                <!-- Done -->
                <span v-else-if="task.status === 'done'" class="task-badge done">已完成 · 点击查看</span>
                <!-- Error -->
                <span v-else class="task-badge error">{{ task.error }}</span>
              </div>
            </div>

            <!-- Clear button -->
            <button v-if="hasDoneTasks" class="panel-clear" @click.stop="clearDone">
              清除已完成
            </button>
          </div>
        </Transition>
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
            v-for="item in history" :key="item.id"
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
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 28px; border-bottom: 1px solid var(--border);
}
.brand { display: flex; align-items: center; gap: 10px; }
.logo-svg { width: 32px; height: 32px; }
.brand-name { font-size: 16px; font-weight: 700; color: var(--text); letter-spacing: -0.2px; }
.header-actions { display: flex; align-items: center; gap: 8px; }

.btn-hist {
  display: flex; align-items: center; gap: 5px;
  background: transparent; border: 1px solid var(--border); border-radius: 8px;
  padding: 6px 12px; cursor: pointer; color: var(--text-2); font-size: 13px;
  transition: color 0.2s, border-color 0.2s, background 0.2s;
}
.btn-hist:hover, .btn-hist.active {
  color: var(--accent); border-color: rgba(196,129,58,0.4); background: rgba(196,129,58,0.06);
}
.btn-icon {
  background: transparent; border: 1px solid var(--border); border-radius: 8px;
  padding: 7px; cursor: pointer; color: var(--text-2);
  transition: color 0.2s, border-color 0.2s; display: flex;
}
.btn-icon:hover { color: var(--text); border-color: rgba(196,129,58,0.4); }
.btn-icon svg { width: 17px; height: 17px; }

/* ── Hero Banner ── */
.hero-banner {
  position: relative; height: 140px; overflow: hidden;
  border-bottom: 1px solid var(--border);
}
.banner-grid {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(196,129,58,0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(196,129,58,0.07) 1px, transparent 1px);
  background-size: 32px 32px;
}
.banner-glow {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse 60% 120% at 50% 50%, rgba(196,129,58,0.13) 0%, transparent 70%);
}
.banner-frames {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center; gap: 18px;
}
.frame { border: 1px solid rgba(196,129,58,0.35); border-radius: 7px; overflow: hidden; box-shadow: 0 6px 20px rgba(0,0,0,0.5); }
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
  position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%);
  font-size: 11px; color: var(--accent); letter-spacing: 1.2px; text-transform: uppercase;
  padding: 3px 10px; border: 1px solid rgba(196,129,58,0.22); border-radius: 99px;
  background: rgba(18,14,9,0.7); white-space: nowrap;
}

/* ── Main ── */
.main {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: flex-start;
  padding: 44px 24px 80px; gap: 28px;
}

/* ── Hero Text ── */
.hero { text-align: center; }
.eyebrow {
  display: inline-block; font-size: 12px; color: var(--accent);
  letter-spacing: 1.4px; text-transform: uppercase; margin-bottom: 16px;
  padding: 4px 14px; border: 1px solid rgba(196,129,58,0.25); border-radius: 99px;
}
.title { font-size: 40px; font-weight: 700; line-height: 1.2; color: var(--text); margin-bottom: 14px; letter-spacing: -0.8px; }
.subtitle { font-size: 16px; color: var(--text-2); }

/* ── Input Card ── */
.input-wrap {
  width: 100%; max-width: 680px;
  background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px;
  overflow: hidden; transition: border-color 0.2s;
}
.input-wrap:focus-within { border-color: rgba(196,129,58,0.45); }

.size-row { display: flex; gap: 8px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
.size-btn {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 8px; background: transparent; border: 1px solid var(--border);
  border-radius: 10px; cursor: pointer; color: var(--text-2); transition: all 0.2s;
}
.size-btn:hover { border-color: rgba(196,129,58,0.3); color: var(--text); }
.size-btn.active { border-color: var(--accent); color: var(--accent); background: rgba(196,129,58,0.08); }
.size-icon { width: 20px; height: 20px; }
.size-label { font-size: 13px; font-weight: 600; }
.size-desc { font-size: 11px; opacity: 0.6; }

.ref-preview {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; border-bottom: 1px solid var(--border); background: rgba(196,129,58,0.04);
}
.ref-thumb { width: 52px; height: 52px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border); }
.ref-meta { display: flex; flex-direction: column; gap: 4px; }
.ref-label { font-size: 12px; color: var(--accent); }
.ref-clear { font-size: 12px; color: var(--text-3); background: none; border: none; cursor: pointer; padding: 0; transition: color 0.2s; }
.ref-clear:hover { color: #E07050; }

textarea {
  width: 100%; background: transparent; border: none;
  color: var(--text); font-size: 16px; line-height: 1.7;
  padding: 20px; resize: none; outline: none; font-family: inherit;
}
textarea::placeholder { color: var(--text-3); }

.styles-row {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 10px 16px; border-top: 1px solid var(--border);
}
.style-chip {
  padding: 5px 12px; background: transparent;
  border: 1px solid var(--border); border-radius: 99px;
  color: var(--text-2); font-size: 12px; cursor: pointer; transition: all 0.2s;
}
.style-chip:hover { border-color: rgba(196,129,58,0.3); color: var(--text); }
.style-chip.active { border-color: var(--accent); color: var(--accent); background: rgba(196,129,58,0.1); }

.input-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-top: 1px solid var(--border);
}
.footer-left { display: flex; align-items: center; gap: 8px; }

.btn-enhance {
  display: flex; align-items: center; gap: 5px;
  background: transparent; border: 1px solid rgba(196,129,58,0.3); border-radius: 7px;
  padding: 5px 10px; cursor: pointer; color: var(--accent); font-size: 12px; font-weight: 500;
  transition: all 0.2s; white-space: nowrap;
}
.btn-enhance:hover:not(:disabled) { background: rgba(196,129,58,0.08); }
.btn-enhance:disabled { opacity: 0.35; cursor: not-allowed; }

.btn-upload {
  display: flex; align-items: center; gap: 5px;
  background: transparent; border: 1px solid var(--border); border-radius: 7px;
  padding: 5px 10px; cursor: pointer; color: var(--text-2); font-size: 12px;
  transition: all 0.2s; white-space: nowrap;
}
.btn-upload:hover { color: var(--text); border-color: rgba(196,129,58,0.35); }
.file-input { display: none; }
.shortcut { font-size: 12px; color: var(--text-3); }

.btn-gen {
  padding: 9px 22px;
  background: linear-gradient(135deg, var(--accent), var(--accent-dk));
  border: none; border-radius: 9px; color: #FFF8F0;
  font-size: 14px; font-weight: 600; cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
  box-shadow: 0 3px 12px rgba(196,129,58,0.28);
}
.btn-gen:hover:not(:disabled) { opacity: 0.88; }
.btn-gen:active:not(:disabled) { transform: scale(0.97); }
.btn-gen:disabled { opacity: 0.3; cursor: not-allowed; }

/* ── Result ── */
.result {
  display: flex; flex-direction: column; align-items: center;
  gap: 16px; width: 100%; max-width: 580px;
}
.result-img {
  width: 100%; max-height: 62vh; object-fit: contain; border-radius: 14px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px var(--border);
  animation: fadeUp 0.45s ease;
}
.result-prompt {
  width: 100%; background: var(--bg-card);
  border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px;
}
.result-prompt-label { display: block; font-size: 11px; color: var(--accent); letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 6px; }
.result-prompt-text { font-size: 14px; color: var(--text-2); line-height: 1.6; }
.result-bar { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }

.btn-dl {
  display: flex; align-items: center; gap: 6px; padding: 10px 18px;
  background: linear-gradient(135deg, var(--accent), var(--accent-dk));
  border: none; border-radius: 9px; color: #FFF8F0; font-size: 14px; font-weight: 600;
  cursor: pointer; transition: opacity 0.2s; box-shadow: 0 3px 12px rgba(196,129,58,0.28);
}
.btn-dl:hover { opacity: 0.88; }
.btn-copy {
  display: flex; align-items: center; gap: 6px; padding: 10px 18px;
  background: transparent; border: 1px solid var(--border); border-radius: 9px;
  color: var(--text-2); font-size: 14px; cursor: pointer; transition: all 0.2s;
}
.btn-copy:hover { border-color: rgba(196,129,58,0.4); color: var(--text); }
.btn-copy.done { border-color: rgba(100,200,120,0.4); color: #6dc87a; }
.btn-ghost {
  padding: 10px 18px; background: transparent; border: 1px solid var(--border);
  border-radius: 9px; color: var(--text-2); font-size: 14px; cursor: pointer;
  transition: border-color 0.2s, color 0.2s;
}
.btn-ghost:hover { border-color: rgba(196,129,58,0.4); color: var(--text); }

/* ── Floating Task Panel ── */
.task-panel {
  position: fixed; bottom: 24px; right: 24px; width: 340px;
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: 16px; z-index: 80;
  box-shadow: 0 20px 50px rgba(0,0,0,0.5), 0 0 0 1px rgba(196,129,58,0.06);
  overflow: hidden;
}

.panel-bar {
  position: relative; display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; cursor: pointer; user-select: none;
  transition: background 0.2s; overflow: hidden;
}
.panel-bar:hover { background: rgba(255,255,255,0.02); }
.panel-bar-left { display: flex; align-items: center; gap: 9px; }
.panel-spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid var(--border); border-top-color: var(--accent);
  animation: spin 1s linear infinite; flex-shrink: 0;
}
.panel-status-text { font-size: 13px; color: var(--text); font-weight: 500; }
.panel-bar-right { display: flex; align-items: center; gap: 8px; }
.panel-pct { font-size: 12px; color: var(--accent); font-weight: 600; }
.panel-chevron { color: var(--text-2); transition: transform 0.25s; }
.panel-chevron.up { transform: rotate(180deg); }
.panel-bar-line {
  position: absolute; bottom: 0; left: 0; height: 2px;
  background: linear-gradient(90deg, var(--accent-dk), var(--accent-lt));
  transition: width 0.9s ease; pointer-events: none;
}

.panel-body {
  border-top: 1px solid var(--border);
  max-height: 380px; overflow-y: auto;
  padding: 10px;
  display: flex; flex-direction: column; gap: 8px;
}
.panel-body::-webkit-scrollbar { width: 4px; }
.panel-body::-webkit-scrollbar-track { background: transparent; }
.panel-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; }

/* Task items */
.task-item {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px; border: 1px solid var(--border); border-radius: 10px;
  transition: border-color 0.2s;
}
.task-item.clickable { cursor: pointer; }
.task-item.clickable:hover { border-color: rgba(196,129,58,0.35); }
.task-item.done { border-color: rgba(196,129,58,0.15); }

.task-thumb {
  width: 52px; height: 52px; border-radius: 7px; overflow: hidden;
  flex-shrink: 0; border: 1px solid var(--border);
  background: var(--bg); display: flex; align-items: center; justify-content: center;
}
.task-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.task-thumb-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }

.task-mini-spin {
  width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid rgba(196,129,58,0.2); border-top-color: var(--accent);
  animation: spin 1s linear infinite;
}

.task-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.task-prompt { font-size: 12px; color: var(--text-2); line-height: 1.45; }

.task-prog-row { display: flex; align-items: center; gap: 8px; }
.task-prog-track { flex: 1; height: 3px; background: rgba(255,255,255,0.06); border-radius: 99px; overflow: hidden; }
.task-prog-fill {
  height: 100%; background: linear-gradient(90deg, var(--accent-dk), var(--accent-lt));
  border-radius: 99px; transition: width 0.9s ease;
}
.task-pct { font-size: 11px; color: var(--accent); width: 28px; text-align: right; flex-shrink: 0; }
.task-msg { font-size: 11px; color: var(--text-3); line-height: 1.4; }

.task-badge {
  display: inline-block; font-size: 11px; padding: 2px 8px;
  border-radius: 99px; font-weight: 500; width: fit-content;
}
.task-badge.queued { color: var(--text-3); background: rgba(255,255,255,0.04); }
.task-badge.done   { color: var(--accent); background: rgba(196,129,58,0.1); }
.task-badge.error  { color: #E07050; background: rgba(224,112,80,0.1); font-size: 11px; }

.panel-clear {
  width: 100%; padding: 8px; background: transparent;
  border: 1px dashed var(--border); border-radius: 8px;
  color: var(--text-3); font-size: 12px; cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}
.panel-clear:hover { color: var(--text-2); border-color: rgba(196,129,58,0.25); }

/* ── History Drawer ── */
.drawer {
  position: fixed; top: 0; right: 0; bottom: 0; width: 300px;
  background: var(--bg-card); border-left: 1px solid var(--border);
  display: flex; flex-direction: column; z-index: 90;
  box-shadow: -20px 0 60px rgba(0,0,0,0.5);
}
.drawer-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.drawer-title { font-size: 15px; font-weight: 600; color: var(--text); }
.drawer-close {
  background: none; border: none; cursor: pointer; color: var(--text-2);
  display: flex; padding: 4px; border-radius: 6px; transition: color 0.2s, background 0.2s;
}
.drawer-close:hover { color: var(--text); background: rgba(255,255,255,0.05); }
.drawer-body { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.drawer-body::-webkit-scrollbar { width: 4px; }
.drawer-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; }
.drawer-empty {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 48px 16px; text-align: center;
}
.drawer-empty p { font-size: 14px; color: var(--text-2); }
.drawer-empty small { font-size: 12px; color: var(--text-3); }
.hist-item {
  cursor: pointer; border: 1px solid var(--border); border-radius: 10px;
  overflow: hidden; transition: border-color 0.2s, transform 0.15s;
}
.hist-item:hover { border-color: rgba(196,129,58,0.4); transform: translateY(-1px); }
.hist-thumb { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; }
.hist-prompt { padding: 9px 12px; font-size: 12px; color: var(--text-2); line-height: 1.5; border-top: 1px solid var(--border); }
.drawer-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 89; }

/* ── Transitions ── */
.drawer-enter-active, .drawer-leave-active { transition: transform 0.3s ease; }
.drawer-enter-from, .drawer-leave-to { transform: translateX(100%); }

.panel-slide-enter-active, .panel-slide-leave-active { transition: opacity 0.3s, transform 0.3s; }
.panel-slide-enter-from, .panel-slide-leave-to { opacity: 0; transform: translateY(12px) scale(0.97); }

.panel-expand-enter-active, .panel-expand-leave-active { transition: opacity 0.2s ease, max-height 0.3s ease; max-height: 380px; overflow: hidden; }
.panel-expand-enter-from, .panel-expand-leave-to { opacity: 0; max-height: 0; }

@keyframes spin    { to { transform: rotate(360deg); } }
@keyframes fadeUp  { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
</style>
