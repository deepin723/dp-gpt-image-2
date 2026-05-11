<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  apiKey: string
  baseUrl: string
  activePage?: string
  getToken?: () => Promise<string | null>
  userDisplay?: { name: string; email: string; avatar: string } | null
}>()
const emit = defineEmits<{ settings: []; 'switch-page': [page: string]; 'sign-out': [] }>()

// ── Types ─────────────────────────────────────────────────────
interface RefImage {
  preview: string; base64: string; mime: string
}

interface Task {
  id: string
  prompt: string
  size: string
  batchCount: number
  referenceImages: { base64: string; mime: string }[]
  targetImageBase64?: string
  targetImageMime?: string
  status: 'queued' | 'generating' | 'done' | 'error'
  progress: number
  currentBatch: number
  msgIndex: number
  imageUrls: string[]
  error?: string
  ts: number
}

interface HistoryItem {
  id: string; prompt: string; imageUrls: string[]; ts: number
}

// ── Constants ─────────────────────────────────────────────────
const SIZES = [
  { label: '横版', desc: '3:2', value: '1536x1024' },
  { label: '方形', desc: '1:1', value: '1024x1024' },
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
const viewingTask   = ref<Task | null>(null)
const viewingIndex  = ref(0)
const selectedSize  = ref('1536x1024')
const activeStyles  = ref<string[]>([])
const copiedImage   = ref(false)
const batchCount    = ref(1)

// Reference style images (multiple)
const refImages       = ref<RefImage[]>([])
const refFileInputRef = ref<HTMLInputElement | null>(null)

// Image preview lightbox
const previewLightbox = ref('')

// Target image (single)
const targetPreview = ref('')
const targetBase64  = ref('')
const targetMime    = ref('')
const targetFileInputRef = ref<HTMLInputElement | null>(null)

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
  const gt = generatingTask.value
  if (gt) {
    const label = gt.batchCount > 1 ? `${gt.currentBatch}/${gt.batchCount}` : ''
    const suffix = queuedCount.value > 0 ? ` · 还有 ${queuedCount.value} 个排队` : ''
    return `生成中${label ? ' ' + label : ''}${suffix}`
  }
  const done = tasks.value.filter(t => t.status === 'done').length
  const err  = tasks.value.filter(t => t.status === 'error').length
  if (err > 0 && done === 0) return `${err} 个任务失败`
  if (err > 0) return `${done} 个完成 · ${err} 个失败`
  return `${done} 个任务已完成`
})

const apiBase = () => import.meta.env.VITE_API_BASE || 'https://dp-gpt-image-2-production.up.railway.app'

const authHeaders = async (): Promise<Record<string, string>> => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (props.apiKey)  h['x-api-key']  = props.apiKey
  if (props.baseUrl) h['x-base-url'] = props.baseUrl
  if (props.getToken) {
    try { const t = await props.getToken(); if (t) h['Authorization'] = `Bearer ${t}` } catch {}
  }
  return h
}

// ── Image file loading ────────────────────────────────────────
const loadFile = (file: File): Promise<{ preview: string; base64: string; mime: string }> => {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (ev) => {
      const result = ev.target?.result as string
      resolve({
        preview: result,
        base64:  result.split(',')[1],
        mime:    result.match(/data:([^;]+);/)?.[1] || 'image/jpeg',
      })
    }
    reader.readAsDataURL(file)
  })
}

const onRefFileChange = async (e: Event) => {
  const files = (e.target as HTMLInputElement).files
  if (!files?.length) return
  for (const file of Array.from(files)) {
    if (refImages.value.length >= 4) break
    refImages.value.push(await loadFile(file))
  }
  if (refFileInputRef.value) refFileInputRef.value.value = ''
}

const onTargetFileChange = async (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const loaded = await loadFile(file)
  targetPreview.value = loaded.preview
  targetBase64.value  = loaded.base64
  targetMime.value    = loaded.mime
}

const removeRefImage = (i: number) => { refImages.value.splice(i, 1) }
const clearTarget = () => { targetPreview.value = ''; targetBase64.value = ''; targetMime.value = '' }

// Clipboard paste → add to reference images
const onPaste = async (e: ClipboardEvent) => {
  const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'))
  if (!item) return
  const file = item.getAsFile()
  if (!file || refImages.value.length >= 4) return
  refImages.value.push(await loadFile(file))
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
      headers: await authHeaders(),
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
    id:          Date.now().toString(),
    prompt:      buildPrompt(),
    size:        selectedSize.value,
    batchCount:  batchCount.value,
    referenceImages: refImages.value.map(r => ({ base64: r.base64, mime: r.mime })),
    targetImageBase64: targetBase64.value || undefined,
    targetImageMime:   targetMime.value   || undefined,
    status:      'queued',
    progress:    0,
    currentBatch: 0,
    msgIndex:    0,
    imageUrls:   [],
    ts:          Date.now(),
  }
  tasks.value.push(task)
  panelExpanded.value = true
  prompt.value = ''
  activeStyles.value = []
  refImages.value = []
  clearTarget()
  processNext()
}

// ── Queue processor ───────────────────────────────────────────
const processNext = async () => {
  if (isProcessing) return
  const task = tasks.value.find(t => t.status === 'queued')
  if (!task) return

  isProcessing    = true
  task.status     = 'generating'
  task.progress   = 0
  task.currentBatch = 0
  task.msgIndex   = 0

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
    const headers = await authHeaders()
    const body: Record<string, unknown> = {
      prompt: task.prompt,
      size:   task.size,
      count:  task.batchCount,
      referenceImages: task.referenceImages,
    }
    if (task.targetImageBase64) {
      body.targetImageBase64 = task.targetImageBase64
      body.targetImageMime   = task.targetImageMime || 'image/jpeg'
    }

    const res  = await fetch(`${apiBase()}/api/generate-image`, { method: 'POST', headers, body: JSON.stringify(body) })
    const data = await res.json()
    clearInterval(pt); clearInterval(mt)

    if (data.images?.length) {
      task.imageUrls = data.images.map((img: { base64: string }) => `data:image/png;base64,${img.base64}`)
      task.currentBatch = data.images.length
      task.progress = 100
      await new Promise(r => setTimeout(r, 400))
      task.status = 'done'
      // Add to local history immediately (base64 for instant display)
      history.value.unshift({ id: task.id, prompt: task.prompt, imageUrls: task.imageUrls, ts: task.ts })
      // Refresh from server to get persistent image URLs (replaces base64)
      if (props.getToken) loadServerHistory()
    } else if (data.imageBase64) {
      // Backward compat: legacy single-image response
      task.imageUrls = [`data:image/png;base64,${data.imageBase64}`]
      task.currentBatch = 1
      task.progress = 100
      await new Promise(r => setTimeout(r, 400))
      task.status = 'done'
      history.value.unshift({ id: task.id, prompt: task.prompt, imageUrls: task.imageUrls, ts: task.ts })
    } else {
      task.error  = data.error || '生成失败，请重试'
      task.status = 'error'
    }
  } catch {
    clearInterval(pt); clearInterval(mt)
    task.error  = '网络错误，请稍后重试'
    task.status = 'error'
  }

  timerCleanup = null
  isProcessing  = false
  processNext()
}

// ── Task panel actions ────────────────────────────────────────
const viewTask = (task: Task) => {
  if (!task.imageUrls.length) return
  viewingTask.value  = task
  viewingIndex.value = 0
}

const clearDone = () => {
  tasks.value = tasks.value.filter(t => t.status === 'queued' || t.status === 'generating')
  if (tasks.value.length === 0) panelExpanded.value = false
}

// ── Result actions ────────────────────────────────────────────
const currentImageUrl = computed(() => viewingTask.value?.imageUrls[viewingIndex.value] || '')

const downloadImage = () => {
  const task = viewingTask.value
  if (!task) return
  task.imageUrls.forEach((url, i) => {
    const a = document.createElement('a')
    a.href = url; a.download = `deepin-image-${task.id}_${i}.png`; a.click()
  })
}

const copyImage = async () => {
  const url = currentImageUrl.value
  if (!url) return
  try {
    const res  = await fetch(url)
    const blob = await res.blob()
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  } catch { }
  copiedImage.value = true
  setTimeout(() => { copiedImage.value = false }, 2000)
}

const editPrompt  = () => { prompt.value = viewingTask.value?.prompt || ''; viewingTask.value = null }
const backToInput = () => { viewingTask.value = null }
const regenerate  = () => {
  const t = viewingTask.value
  if (!t) return
  const task: Task = {
    id: Date.now().toString(), prompt: t.prompt, size: selectedSize.value,
    batchCount: t.batchCount, referenceImages: t.referenceImages,
    status: 'queued', progress: 0, currentBatch: 0, msgIndex: 0, imageUrls: [], ts: Date.now(),
  }
  tasks.value.push(task)
  panelExpanded.value = true
  viewingTask.value = null
  processNext()
}

// ── History ───────────────────────────────────────────────────
const loadHistory = (item: HistoryItem) => {
  viewingTask.value = {
    id: item.id, prompt: item.prompt, size: '1536x1024',
    batchCount: item.imageUrls.length, referenceImages: [],
    status: 'done', progress: 100, currentBatch: item.imageUrls.length,
    msgIndex: 0, imageUrls: item.imageUrls, ts: item.ts,
  }
  viewingIndex.value = 0
  showHistory.value  = false
}

const loadServerHistory = async () => {
  if (!props.getToken) return
  try {
    const headers = await authHeaders()
    const res  = await fetch(`${apiBase()}/api/history`, { headers })
    if (!res.ok) return
    const data = await res.json()
    history.value = data.map((item: { id: string; prompt: string; imageUrls: string[]; ts: number }) => ({
      id: item.id, prompt: item.prompt, imageUrls: item.imageUrls, ts: item.ts,
    }))
  } catch { /* silent */ }
}

onMounted(() => {
  window.addEventListener('paste', onPaste)
  if (props.getToken) loadServerHistory()
})
onUnmounted(() => {
  window.removeEventListener('paste', onPaste)
  timerCleanup?.()
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
        <span class="brand-name">Deepin</span>
        <div class="header-tabs">
          <button :class="['htab', { active: (props.activePage ?? 'image') === 'image' }]" @click="emit('switch-page', 'image')">AI 图像</button>
          <button :class="['htab', { active: props.activePage === 'ppt' }]" @click="emit('switch-page', 'ppt')">AI PPT</button>
        </div>
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
        <!-- User badge + sign out (only when logged in via Clerk) -->
        <div v-if="props.userDisplay" class="user-badge" :title="props.userDisplay.email">
          <img v-if="props.userDisplay.avatar" :src="props.userDisplay.avatar" class="user-avatar" alt="" />
          <span v-else class="user-avatar user-avatar-fallback">{{ props.userDisplay.name[0] }}</span>
          <span class="user-name">{{ props.userDisplay.name }}</span>
          <button class="btn-signout" @click="emit('sign-out')" title="退出登录">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" width="13" height="13">
              <path d="M13 4l4 4-4 4M17 8H8"/><path d="M8 3H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4"/>
            </svg>
          </button>
        </div>
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
      <div v-if="viewingTask" class="result">
        <!-- Multi-image grid -->
        <div v-if="viewingTask.imageUrls.length > 1" class="result-grid">
          <div
            v-for="(url, i) in viewingTask.imageUrls" :key="i"
            class="result-grid-item"
            :class="{ selected: viewingIndex === i }"
            @click="viewingIndex = i"
          >
            <img :src="url" alt="" class="result-grid-thumb" />
          </div>
        </div>
        <img :src="currentImageUrl" alt="生成图片" class="result-img" />
        <div class="result-prompt">
          <span class="result-prompt-label">提示词</span>
          <p class="result-prompt-text">{{ viewingTask.prompt }}</p>
        </div>
        <div class="result-bar">
          <button class="btn-dl" @click="downloadImage">
            <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15">
              <path d="M10 14l-5-5h3V4h4v5h3l-5 5z"/>
              <rect x="3" y="16" width="14" height="2" rx="1"/>
            </svg>
            {{ viewingTask.imageUrls.length > 1 ? '全部下载' : '下载图片' }}
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

          <!-- 图片上传区 -->
          <div class="upload-row">
            <!-- 参考风格图 (multiple, clipboard) -->
            <div class="upload-zone ref-zone">
              <div class="upload-zone-header">
                <span class="upload-zone-title">参考风格图</span>
                <span class="upload-zone-hint">可粘贴 · 最多4张</span>
              </div>
              <div class="ref-thumbs">
                <div
                  v-for="(img, i) in refImages" :key="i"
                  class="ref-thumb-wrap"
                >
                  <img :src="img.preview" class="upload-thumb" alt="" @click="previewLightbox = img.preview" />
                  <button class="thumb-remove" @click="removeRefImage(i)">×</button>
                </div>
                <button
                  v-if="refImages.length < 4"
                  class="upload-add-btn"
                  @click="refFileInputRef?.click()"
                  :title="refImages.length === 0 ? '上传或直接粘贴图片 (Ctrl+V)' : '继续添加'"
                >
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" width="16" height="16">
                    <path d="M10 4v12M4 10h12"/>
                  </svg>
                  <span>{{ refImages.length === 0 ? '添加' : '+' }}</span>
                </button>
              </div>
              <input ref="refFileInputRef" type="file" accept="image/*" multiple class="file-input" @change="onRefFileChange" />
            </div>

            <!-- 分隔线 -->
            <div class="upload-divider" />

            <!-- 待优化生成图 (single) -->
            <div class="upload-zone target-zone">
              <div class="upload-zone-header">
                <span class="upload-zone-title">待优化生成图</span>
                <span class="upload-zone-hint">单张</span>
              </div>
              <div class="ref-thumbs">
                <div v-if="targetPreview" class="ref-thumb-wrap">
                  <img :src="targetPreview" class="upload-thumb" alt="" @click="previewLightbox = targetPreview" />
                  <button class="thumb-remove" @click="clearTarget">×</button>
                </div>
                <button v-else class="upload-add-btn" @click="targetFileInputRef?.click()">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" width="16" height="16">
                    <path d="M10 4v12M4 10h12"/>
                  </svg>
                  <span>上传</span>
                </button>
              </div>
              <input ref="targetFileInputRef" type="file" accept="image/*" class="file-input" @change="onTargetFileChange" />
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
              <span class="shortcut">⌘↩</span>
              <div class="batch-selector">
                <span class="batch-label">生成</span>
                <button
                  v-for="n in [1,2,3,4]" :key="n"
                  class="batch-btn" :class="{ active: batchCount === n }"
                  @click="batchCount = n"
                >{{ n }}</button>
                <span class="batch-label">张</span>
              </div>
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
        <div class="panel-bar" @click="panelExpanded = !panelExpanded">
          <div class="panel-bar-left">
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
          <div v-if="generatingTask" class="panel-bar-line" :style="{ width: generatingTask.progress + '%' }" />
        </div>

        <Transition name="panel-expand">
          <div v-if="panelExpanded" class="panel-body">
            <div
              v-for="task in [...tasks].reverse()" :key="task.id"
              class="task-item"
              :class="[task.status, { clickable: task.status === 'done' }]"
              @click="task.status === 'done' && viewTask(task)"
            >
              <div class="task-thumb">
                <img v-if="task.imageUrls.length" :src="task.imageUrls[0]" alt="" />
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
              <div class="task-info">
                <p class="task-prompt">{{ task.prompt.length > 42 ? task.prompt.slice(0, 42) + '…' : task.prompt }}</p>
                <template v-if="task.status === 'generating'">
                  <div class="task-prog-row">
                    <div class="task-prog-track">
                      <div class="task-prog-fill" :style="{ width: task.progress + '%' }" />
                    </div>
                    <span class="task-pct">
                      {{ task.batchCount > 1 ? `${task.currentBatch}/${task.batchCount}` : Math.floor(task.progress) + '%' }}
                    </span>
                  </div>
                  <p class="task-msg">{{ LOADING_MSGS[task.msgIndex] }}</p>
                </template>
                <span v-else-if="task.status === 'queued'" class="task-badge queued">排队中</span>
                <span v-else-if="task.status === 'done'" class="task-badge done">
                  {{ task.imageUrls.length > 1 ? `${task.imageUrls.length} 张已完成 · 点击查看` : '已完成 · 点击查看' }}
                </span>
                <span v-else class="task-badge error">{{ task.error }}</span>
              </div>
            </div>
            <button v-if="hasDoneTasks" class="panel-clear" @click.stop="clearDone">清除已完成</button>
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
            <div class="hist-thumb-wrap">
              <img :src="item.imageUrls[0]" class="hist-thumb" alt="历史图片" />
              <span v-if="item.imageUrls.length > 1" class="hist-count">{{ item.imageUrls.length }}张</span>
            </div>
            <p class="hist-prompt">{{ item.prompt.length > 38 ? item.prompt.slice(0, 38) + '…' : item.prompt }}</p>
          </div>
        </div>
      </div>
    </Transition>
    <div v-if="showHistory" class="drawer-mask" @click="showHistory = false" />

    <!-- Image preview lightbox -->
    <Transition name="lightbox">
      <div v-if="previewLightbox" class="lightbox-mask" @click="previewLightbox = ''">
        <img :src="previewLightbox" class="lightbox-img" @click.stop />
        <button class="lightbox-close" @click="previewLightbox = ''">×</button>
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
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 28px; border-bottom: 1px solid var(--border);
}
.brand { display: flex; align-items: center; gap: 10px; }
.logo-svg { width: 32px; height: 32px; }
.brand-name { font-size: 16px; font-weight: 700; color: var(--text); letter-spacing: -0.2px; }

.header-tabs {
  display: flex; gap: 2px; margin-left: 18px; padding: 3px;
  background: rgba(0,0,0,0.2); border-radius: 9px; border: 1px solid var(--border);
}
.htab {
  padding: 5px 14px; background: transparent; border: none; border-radius: 6px;
  color: var(--text-2); font-size: 13px; font-weight: 500; cursor: pointer;
  transition: all 0.15s; font-family: inherit;
}
.htab:hover { color: var(--text); }
.htab.active { background: rgba(196,129,58,0.15); color: var(--accent-lt); }

.header-actions { display: flex; align-items: center; gap: 8px; }
.btn-hist {
  display: flex; align-items: center; gap: 5px;
  background: transparent; border: 1px solid var(--border); border-radius: 8px;
  padding: 6px 12px; cursor: pointer; color: var(--text-2); font-size: 13px;
  transition: color 0.2s, border-color 0.2s, background 0.2s;
}
.btn-hist:hover, .btn-hist.active { color: var(--accent); border-color: rgba(196,129,58,0.4); background: rgba(196,129,58,0.06); }
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
  background-image: linear-gradient(rgba(196,129,58,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(196,129,58,0.07) 1px, transparent 1px);
  background-size: 32px 32px;
}
.banner-glow {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse 60% 120% at 50% 50%, rgba(196,129,58,0.13) 0%, transparent 70%);
}
.banner-frames { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 18px; }
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

/* ── Upload Row ── */
.upload-row {
  display: flex; align-items: stretch; gap: 0;
  border-bottom: 1px solid var(--border);
  background: rgba(196,129,58,0.03);
}
.upload-zone {
  flex: 1; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;
}
.upload-divider { width: 1px; background: var(--border); flex-shrink: 0; }
.upload-zone-header { display: flex; align-items: center; justify-content: space-between; }
.upload-zone-title { font-size: 11px; font-weight: 600; color: var(--accent); letter-spacing: 0.5px; text-transform: uppercase; }
.upload-zone-hint { font-size: 10px; color: var(--text-3); }

.ref-thumbs { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-height: 48px; }
.ref-thumb-wrap { position: relative; }
.upload-thumb { width: 44px; height: 44px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border); display: block; }
.thumb-remove {
  position: absolute; top: -5px; right: -5px;
  width: 16px; height: 16px; border-radius: 50%;
  background: rgba(18,14,9,0.9); border: 1px solid var(--border);
  color: var(--text-2); font-size: 11px; line-height: 14px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: color 0.2s, border-color 0.2s;
}
.thumb-remove:hover { color: #E07050; border-color: rgba(224,112,80,0.5); }

.upload-add-btn {
  width: 44px; height: 44px; border-radius: 6px;
  border: 1px dashed rgba(196,129,58,0.3); background: transparent;
  color: var(--text-3); cursor: pointer; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 1px;
  transition: border-color 0.2s, color 0.2s; font-size: 9px;
}
.upload-add-btn:hover { border-color: rgba(196,129,58,0.6); color: var(--accent); }

.file-input { display: none; }

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
.footer-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.btn-enhance {
  display: flex; align-items: center; gap: 5px;
  background: transparent; border: 1px solid rgba(196,129,58,0.3); border-radius: 7px;
  padding: 5px 10px; cursor: pointer; color: var(--accent); font-size: 12px; font-weight: 500;
  transition: all 0.2s; white-space: nowrap;
}
.btn-enhance:hover:not(:disabled) { background: rgba(196,129,58,0.08); }
.btn-enhance:disabled { opacity: 0.35; cursor: not-allowed; }
.shortcut { font-size: 12px; color: var(--text-3); }

.batch-selector { display: flex; align-items: center; gap: 3px; }
.batch-label { font-size: 12px; color: var(--text-3); padding: 0 2px; }
.batch-btn {
  width: 26px; height: 26px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid var(--border); cursor: pointer;
  color: var(--text-2); font-size: 12px; font-weight: 600; transition: all 0.2s;
}
.batch-btn:hover { border-color: rgba(196,129,58,0.3); color: var(--text); }
.batch-btn.active { border-color: var(--accent); color: var(--accent); background: rgba(196,129,58,0.08); }

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
  gap: 16px; width: 100%; max-width: 640px;
}
.result-grid {
  display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;
}
.result-grid-item {
  border: 2px solid var(--border); border-radius: 8px; overflow: hidden;
  cursor: pointer; transition: border-color 0.2s; opacity: 0.7;
}
.result-grid-item.selected { border-color: var(--accent); opacity: 1; }
.result-grid-thumb { width: 72px; height: 72px; object-fit: cover; display: block; }

.result-img {
  width: 100%; max-height: 62vh; object-fit: contain; border-radius: 14px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px var(--border);
  animation: fadeUp 0.45s ease;
}
.result-prompt {
  width: 100%; background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px;
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
.panel-spinner { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--border); border-top-color: var(--accent); animation: spin 1s linear infinite; flex-shrink: 0; }
.panel-status-text { font-size: 13px; color: var(--text); font-weight: 500; }
.panel-bar-right { display: flex; align-items: center; gap: 8px; }
.panel-pct { font-size: 12px; color: var(--accent); font-weight: 600; }
.panel-chevron { color: var(--text-2); transition: transform 0.25s; }
.panel-chevron.up { transform: rotate(180deg); }
.panel-bar-line { position: absolute; bottom: 0; left: 0; height: 2px; background: linear-gradient(90deg, var(--accent-dk), var(--accent-lt)); transition: width 0.9s ease; pointer-events: none; }

.panel-body { border-top: 1px solid var(--border); max-height: 380px; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.panel-body::-webkit-scrollbar { width: 4px; }
.panel-body::-webkit-scrollbar-track { background: transparent; }
.panel-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; }

.task-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px; border: 1px solid var(--border); border-radius: 10px; transition: border-color 0.2s; }
.task-item.clickable { cursor: pointer; }
.task-item.clickable:hover { border-color: rgba(196,129,58,0.35); }
.task-item.done { border-color: rgba(196,129,58,0.15); }
.task-thumb { width: 52px; height: 52px; border-radius: 7px; overflow: hidden; flex-shrink: 0; border: 1px solid var(--border); background: var(--bg); display: flex; align-items: center; justify-content: center; }
.task-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.task-thumb-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
.task-mini-spin { width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(196,129,58,0.2); border-top-color: var(--accent); animation: spin 1s linear infinite; }
.task-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.task-prompt { font-size: 12px; color: var(--text-2); line-height: 1.45; }
.task-prog-row { display: flex; align-items: center; gap: 8px; }
.task-prog-track { flex: 1; height: 3px; background: rgba(255,255,255,0.06); border-radius: 99px; overflow: hidden; }
.task-prog-fill { height: 100%; background: linear-gradient(90deg, var(--accent-dk), var(--accent-lt)); border-radius: 99px; transition: width 0.9s ease; }
.task-pct { font-size: 11px; color: var(--accent); width: 36px; text-align: right; flex-shrink: 0; }
.task-msg { font-size: 11px; color: var(--text-3); line-height: 1.4; }
.task-badge { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 99px; font-weight: 500; width: fit-content; }
.task-badge.queued { color: var(--text-3); background: rgba(255,255,255,0.04); }
.task-badge.done   { color: var(--accent); background: rgba(196,129,58,0.1); }
.task-badge.error  { color: #E07050; background: rgba(224,112,80,0.1); font-size: 11px; }
.panel-clear { width: 100%; padding: 8px; background: transparent; border: 1px dashed var(--border); border-radius: 8px; color: var(--text-3); font-size: 12px; cursor: pointer; transition: color 0.2s, border-color 0.2s; }
.panel-clear:hover { color: var(--text-2); border-color: rgba(196,129,58,0.25); }

/* ── History Drawer ── */
.drawer {
  position: fixed; top: 0; right: 0; bottom: 0; width: 300px;
  background: var(--bg-card); border-left: 1px solid var(--border);
  display: flex; flex-direction: column; z-index: 90;
  box-shadow: -20px 0 60px rgba(0,0,0,0.5);
}
.drawer-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.drawer-title { font-size: 15px; font-weight: 600; color: var(--text); }
.drawer-close { background: none; border: none; cursor: pointer; color: var(--text-2); display: flex; padding: 4px; border-radius: 6px; transition: color 0.2s, background 0.2s; }
.drawer-close:hover { color: var(--text); background: rgba(255,255,255,0.05); }
.drawer-body { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.drawer-body::-webkit-scrollbar { width: 4px; }
.drawer-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; }
.drawer-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 16px; text-align: center; }
.drawer-empty p { font-size: 14px; color: var(--text-2); }
.drawer-empty small { font-size: 12px; color: var(--text-3); }
.hist-item { cursor: pointer; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; transition: border-color 0.2s, transform 0.15s; }
.hist-item:hover { border-color: rgba(196,129,58,0.4); transform: translateY(-1px); }
.hist-thumb-wrap { position: relative; }
.hist-thumb { width: 100%; aspect-ratio: 3/2; object-fit: cover; display: block; }
.hist-count { position: absolute; bottom: 6px; right: 6px; background: rgba(18,14,9,0.8); border: 1px solid var(--border); border-radius: 4px; font-size: 10px; color: var(--accent); padding: 1px 5px; }
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

/* ── Thumbnail hover ── */
.upload-thumb {
  cursor: zoom-in;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.upload-thumb:hover {
  transform: scale(1.12);
  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
  z-index: 1;
}

/* ── Lightbox ── */
.lightbox-mask {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0,0,0,0.82);
  display: flex; align-items: center; justify-content: center;
  cursor: zoom-out;
}
.lightbox-img {
  max-width: 90vw; max-height: 88vh;
  border-radius: 12px;
  box-shadow: 0 32px 80px rgba(0,0,0,0.8);
  cursor: default;
  animation: fadeUp 0.2s ease;
}
.lightbox-close {
  position: absolute; top: 20px; right: 24px;
  width: 36px; height: 36px; border-radius: 50%;
  background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15);
  color: #fff; font-size: 20px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.2s;
}
.lightbox-close:hover { background: rgba(255,255,255,0.2); }

.lightbox-enter-active, .lightbox-leave-active { transition: opacity 0.2s; }
.lightbox-enter-from, .lightbox-leave-to { opacity: 0; }

/* ── User badge ── */
.user-badge {
  display: flex; align-items: center; gap: 7px;
  padding: 4px 10px 4px 4px;
  border: 1px solid var(--border); border-radius: 99px;
  background: rgba(196,129,58,0.05); cursor: default;
}
.user-avatar {
  width: 24px; height: 24px; border-radius: 50%; object-fit: cover;
  border: 1px solid rgba(196,129,58,0.3); flex-shrink: 0;
}
.user-avatar-fallback {
  display: flex; align-items: center; justify-content: center;
  background: rgba(196,129,58,0.2); color: var(--accent);
  font-size: 12px; font-weight: 700;
}
.user-name {
  font-size: 12px; color: var(--text-2); max-width: 120px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.btn-signout {
  display: flex; align-items: center; padding: 3px;
  background: transparent; border: none; cursor: pointer;
  color: var(--text-3); border-radius: 4px;
  transition: color 0.2s;
}
.btn-signout:hover { color: #E07050; }
</style>
