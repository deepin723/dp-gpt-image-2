<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  apiKey: string
  baseUrl: string
  cursorKey: string
  cursorModel: string
  activePage?: string
}>()

const emit = defineEmits<{
  'switch-page': [page: string]
  'settings': []
}>()

// ── Types ──────────────────────────────────────────────────────────────────
interface Slide {
  title: string
  bullets: string[]
  keywords?: string
}
interface PptDoc {
  title: string
  subtitle?: string
  cover_keywords: string
  slides: Slide[]
}

// ── State ──────────────────────────────────────────────────────────────────
const phase              = ref<'input' | 'preview'>('input')
const topic              = ref('')
const outline            = ref('')
const doc                = ref<PptDoc | null>(null)
const selectedIdx        = ref<number | null>(null)
const editInstruction    = ref('')
const isGenerating       = ref(false)
const isEditing          = ref(false)
const isExporting        = ref(false)
const errorMsg           = ref('')

// AI 配图
const withImages         = ref(true)
const slideImages        = ref<(string | null)[]>([])   // base64 per slide
const slideImgLoading    = ref<boolean[]>([])
const isGeneratingImages = ref(false)

// Reference PPT upload
const refPptName   = ref('')
const refPptBase64 = ref('')
const refFileInput = ref<HTMLInputElement | null>(null)

const onRefPptChange = (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!file.name.toLowerCase().endsWith('.pptx')) {
    showToast('请上传 .pptx 格式文件', 'error')
    return
  }
  if (file.size > 30 * 1024 * 1024) {
    showToast('文件超过 30MB，请压缩后再试', 'error')
    return
  }
  refPptName.value = file.name
  const reader = new FileReader()
  reader.onload = (ev) => {
    const dataUrl = ev.target?.result as string
    refPptBase64.value = dataUrl.split(',')[1]
  }
  reader.readAsDataURL(file)
}

const clearRefPpt = () => {
  refPptName.value = ''
  refPptBase64.value = ''
  if (refFileInput.value) refFileInput.value.value = ''
}

// ── Toast ──────────────────────────────────────────────────────────────────
interface Toast { id: number; msg: string; type: 'success' | 'error' | 'info' }
const toasts = ref<Toast[]>([])
let toastId = 0
const showToast = (msg: string, type: Toast['type'] = 'success') => {
  const id = ++toastId
  toasts.value.push({ id, msg, type })
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 3000)
}

// ── Helpers ────────────────────────────────────────────────────────────────
const pptHeaders = () => ({
  'Content-Type': 'application/json',
  'x-api-key': props.apiKey,
  'x-base-url': props.baseUrl,
  ...(props.cursorKey ? { 'x-cursor-key': props.cursorKey, 'x-cursor-model': props.cursorModel || 'auto' } : {}),
})

const usingCursor = computed(() => !!props.cursorKey)

const imgDoneCount = computed(() => slideImages.value.filter(Boolean).length)
const imgTotal     = computed(() => slideImages.value.length)

// ── Image generation ───────────────────────────────────────────────────────

// Generate all slide images in parallel; each updates independently as it resolves
const generateAllImages = async (slides: Slide[]) => {
  if (!props.apiKey) return
  isGeneratingImages.value = true
  slideImages.value    = slides.map(() => null)
  slideImgLoading.value = slides.map(() => true)

  await Promise.all(
    slides.map((slide, i) =>
      fetch('/api/ppt/slide-images', {
        method: 'POST',
        headers: pptHeaders(),
        body: JSON.stringify({ slides: [slide] }),
      })
        .then(r => r.json())
        .then(data => { if (data.images?.[0]) slideImages.value[i] = data.images[0] })
        .catch(() => {})
        .finally(() => { slideImgLoading.value[i] = false })
    )
  )

  isGeneratingImages.value = false
}

const regenerateSlideImage = async (idx: number) => {
  if (!doc.value || slideImgLoading.value[idx] || !props.apiKey) return
  slideImgLoading.value[idx] = true
  slideImages.value[idx] = null
  try {
    const resp = await fetch('/api/ppt/slide-images', {
      method: 'POST',
      headers: pptHeaders(),
      body: JSON.stringify({ slides: [doc.value.slides[idx]] }),
    })
    const data = await resp.json()
    if (data.images?.[0]) slideImages.value[idx] = data.images[0]
    else showToast('配图失败，可重试', 'error')
  } catch {
    showToast('配图失败，请重试', 'error')
  } finally {
    slideImgLoading.value[idx] = false
  }
}

const removeSlideImage = (idx: number) => { slideImages.value[idx] = null }

// ── Actions ────────────────────────────────────────────────────────────────
const generate = async () => {
  if (!topic.value.trim()) { errorMsg.value = '请输入 PPT 主题'; return }
  errorMsg.value = ''
  isGenerating.value = true
  try {
    const resp = await fetch('/api/ppt/generate', {
      method: 'POST',
      headers: pptHeaders(),
      body: JSON.stringify({
        topic: topic.value.trim(),
        outline: outline.value.trim() || undefined,
        referencePptBase64: refPptBase64.value || undefined,
      }),
    })
    const data = await resp.json()
    if (!resp.ok || data.error) throw new Error(data.error || '生成失败')
    doc.value = data
    selectedIdx.value = null
    phase.value = 'preview'
    showToast(`已生成 ${data.slides?.length || 0} 张幻灯片`)
    // Launch image generation in background if enabled
    if (withImages.value && props.apiKey) {
      generateAllImages(data.slides)
    } else {
      slideImages.value     = (data.slides || []).map(() => null)
      slideImgLoading.value = (data.slides || []).map(() => false)
    }
  } catch (err: unknown) {
    showToast(err instanceof Error ? err.message : '生成失败，请重试', 'error')
  } finally {
    isGenerating.value = false
  }
}

const editSlide = async () => {
  if (selectedIdx.value === null || !editInstruction.value.trim()) return
  isEditing.value = true
  try {
    const resp = await fetch('/api/ppt/edit-slide', {
      method: 'POST',
      headers: pptHeaders(),
      body: JSON.stringify({ slide: doc.value!.slides[selectedIdx.value], instruction: editInstruction.value.trim() }),
    })
    const data = await resp.json()
    if (!resp.ok || data.error) throw new Error(data.error || '修改失败')
    doc.value!.slides[selectedIdx.value] = data
    editInstruction.value = ''
    showToast('第 ' + (selectedIdx.value + 1) + ' 页已更新')
  } catch (err: unknown) {
    showToast(err instanceof Error ? err.message : '修改失败，请重试', 'error')
  } finally {
    isEditing.value = false
  }
}

const exportPPT = async () => {
  if (!doc.value) return
  isExporting.value = true
  try {
    const resp = await fetch('/api/ppt/export', {
      method: 'POST',
      headers: pptHeaders(),
      body: JSON.stringify({
        ...doc.value,
        referencePptBase64: refPptBase64.value || undefined,
        slideImagesData: slideImages.value,   // pass pre-generated images, no generation in export
      }),
    })
    if (!resp.ok) {
      const err = await resp.json()
      throw new Error(err.error || '导出失败')
    }
    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(doc.value.title || 'ppt').slice(0, 40)}.pptx`
    a.click()
    URL.revokeObjectURL(url)
    showToast('PPT 已下载')
  } catch (err: unknown) {
    showToast(err instanceof Error ? err.message : '导出失败，请重试', 'error')
  } finally {
    isExporting.value = false
  }
}

const resetToInput = () => {
  phase.value = 'input'
  selectedIdx.value = null
  editInstruction.value = ''
}

const selectSlide = (idx: number) => {
  selectedIdx.value = selectedIdx.value === idx ? null : idx
  editInstruction.value = ''
}

// Accent colors for slides
const SLIDE_ACCENTS = ['#C4813A', '#8B5530', '#E8A86A', '#6B3F1E', '#A0601A']
const slideAccent = (i: number) => SLIDE_ACCENTS[i % SLIDE_ACCENTS.length]
</script>

<template>
  <div class="ppt-root">

    <!-- INPUT PHASE ─────────────────────────────────────────── -->
    <div v-if="phase === 'input'" class="input-wrap">
      <div class="input-card">
        <div class="ppt-page-header">
          <div class="ppt-brand">
            <svg viewBox="0 0 36 36" fill="none" width="32" height="32">
              <rect width="36" height="36" rx="9" fill="#2A1A0C"/>
              <text x="8" y="26" font-size="20" font-weight="700" fill="#EAD9C0" font-family="serif">D</text>
              <rect x="8" y="28" width="20" height="1.5" rx="1" fill="#C4813A" opacity="0.7"/>
            </svg>
            <span class="ppt-brand-name">Deepin</span>
            <div class="ppt-tabs">
              <button class="ptab" @click="emit('switch-page', 'image')">AI 图像</button>
              <button class="ptab active">AI PPT</button>
            </div>
          </div>
          <div class="ppt-header-actions">
            <span v-if="usingCursor" class="cursor-badge">Cursor</span>
            <button class="btn-settings-sm" @click="emit('settings')" title="API 设置">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
                <circle cx="8" cy="8" r="2.2"/>
                <path d="M8 2v1.2M8 12.8V14M2 8h1.2M12.8 8H14M3.5 3.5l.85.85M11.65 11.65l.85.85M12.5 3.5l-.85.85M4.35 11.65l-.85.85"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="input-divider" />

        <div class="input-sub-header">
          <div class="input-title">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" width="18" height="18">
              <rect x="1" y="2" width="18" height="16" rx="3"/>
              <path d="M6 8h5a2 2 0 0 1 0 4H6V8z"/>
              <line x1="6" y1="14" x2="10" y2="14"/>
            </svg>
            AI PPT 生成器
          </div>
        </div>

        <p class="input-desc">输入演示主题，AI 自动生成带结构、带文案的完整幻灯片，支持单页精准修改。</p>

        <div class="field">
          <label>演示主题 <span class="required">*</span></label>
          <input
            v-model="topic"
            type="text"
            class="text-input"
            placeholder="例：2026 Q1 季度工作汇报、项目路演、产品年终总结..."
            @keydown.enter.meta="generate"
          />
        </div>

        <div class="field">
          <label>大纲 <em>（可选，粘贴已有大纲让 AI 照着生成）</em></label>
          <textarea
            v-model="outline"
            class="text-area"
            placeholder="一、背景与目标&#10;二、本期完成情况&#10;三、问题与挑战&#10;四、下期计划&#10;&#10;可以不填，AI 会自动规划结构"
            rows="5"
          />
        </div>

        <div class="field">
          <label>参考 PPT <em>（可选，上传后 AI 会借鉴其内容、结构或风格）</em></label>
          <input
            ref="refFileInput"
            type="file"
            accept=".pptx"
            style="display:none"
            @change="onRefPptChange"
          />
          <div v-if="refPptName" class="ref-file-chip">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" width="13" height="13">
              <rect x="2" y="1" width="10" height="12" rx="1.5"/>
              <line x1="4" y1="5" x2="10" y2="5"/>
              <line x1="4" y1="7.5" x2="10" y2="7.5"/>
              <line x1="4" y1="10" x2="7" y2="10"/>
            </svg>
            <span class="ref-file-name">{{ refPptName }}</span>
            <button class="ref-file-remove" @click="clearRefPpt" title="移除参考文件">×</button>
          </div>
          <button v-else class="btn-upload-ref" @click="refFileInput?.click()">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14">
              <path d="M3 12h10M8 2v8M5 5l3-3 3 3"/>
            </svg>
            上传参考 PPT（.pptx）
          </button>
        </div>

        <!-- AI 智能配图 toggle -->
        <div class="field-toggle-row">
          <label class="toggle-row-label" @click="withImages = !withImages">
            <div class="toggle-pill" :class="{ on: withImages }">
              <div class="toggle-dot" />
            </div>
            <span class="toggle-text">AI 智能配图</span>
            <em>（生成时为每页自动配图，可在预览中修改或删除）</em>
          </label>
        </div>

        <p v-if="errorMsg" class="error-msg">{{ errorMsg }}</p>

        <button class="btn-generate" :disabled="isGenerating" @click="generate">
          <span v-if="isGenerating" class="spinner" />
          <svg v-else viewBox="0 0 16 16" fill="currentColor" width="15" height="15">
            <path d="M8 1l1.5 4L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5z"/>
          </svg>
          {{ isGenerating ? 'AI 生成中，请稍候...' : withImages ? '生成 PPT + AI 配图' : (refPptName ? '借鉴参考内容生成 PPT' : '一键生成 PPT') }}
        </button>
      </div>
    </div>

    <!-- PREVIEW PHASE ───────────────────────────────────────── -->
    <template v-else-if="phase === 'preview' && doc">
      <div class="preview-header">
        <div class="preview-brand">
          <svg viewBox="0 0 36 36" fill="none" width="28" height="28">
            <rect width="36" height="36" rx="9" fill="#2A1A0C"/>
            <text x="8" y="26" font-size="20" font-weight="700" fill="#EAD9C0" font-family="serif">D</text>
            <rect x="8" y="28" width="20" height="1.5" rx="1" fill="#C4813A" opacity="0.7"/>
          </svg>
          <span class="preview-brand-name">Deepin</span>
          <div class="ppt-tabs ppt-tabs-preview">
            <button class="ptab" @click="emit('switch-page', 'image')">AI 图像</button>
            <button class="ptab active">AI PPT</button>
          </div>
        </div>

        <div class="doc-title-wrap">
          <h2 class="doc-title">{{ doc.title }}</h2>
          <span v-if="doc.subtitle" class="doc-subtitle">{{ doc.subtitle }}</span>
        </div>

        <div class="preview-actions">
          <button class="btn-rewrite" @click="resetToInput">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12">
              <path d="M1 7a6 6 0 1 0 1-3.5"/><polyline points="1,2 1,5.5 4.5,5.5"/>
            </svg>
            重新生成
          </button>
          <span v-if="usingCursor" class="cursor-badge">Cursor</span>
          <!-- 配图生成进度 -->
          <span v-if="isGeneratingImages" class="img-gen-pill">
            <span class="spinner spinner-sm" />
            配图中 {{ imgDoneCount }}/{{ imgTotal }}
          </span>
          <span class="slide-count">{{ doc.slides.length }} 页</span>
          <button class="btn-export" :disabled="isExporting" @click="exportPPT">
            <span v-if="isExporting" class="spinner spinner-sm" />
            <svg v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
              <path d="M3 12h10M8 2v8M5 7l3 3 3-3"/>
            </svg>
            {{ isExporting ? '导出中...' : '导出 PPTX' }}
          </button>
        </div>
      </div>

      <!-- Slide strip -->
      <div class="slide-strip">
        <!-- Cover card -->
        <div class="slide-card cover-card" :class="{ selected: selectedIdx === -1 }" @click="selectSlide(-1)">
          <div class="slide-inner cover-inner">
            <div class="cover-glow" />
            <div class="cover-title">{{ doc.title }}</div>
            <div v-if="doc.subtitle" class="cover-subtitle">{{ doc.subtitle }}</div>
          </div>
          <div class="slide-num">封面</div>
        </div>

        <!-- Content cards -->
        <div
          v-for="(slide, i) in doc.slides" :key="i"
          class="slide-card"
          :class="{ selected: selectedIdx === i }"
          :style="{ '--accent': slideAccent(i) }"
          @click="selectSlide(i)"
        >
          <div class="slide-inner">
            <div class="slide-accent-bar" />
            <!-- Image side panel -->
            <div v-if="slideImages[i] || slideImgLoading[i]" class="slide-img-side">
              <div v-if="slideImgLoading[i]" class="slide-img-spin">
                <div class="task-mini-spin" />
              </div>
              <img v-else :src="`data:image/png;base64,${slideImages[i]}`" class="slide-img-preview" alt="" />
            </div>
            <!-- Text area (narrows when image present) -->
            <div class="slide-text" :class="{ compact: !!(slideImages[i] || slideImgLoading[i]) }">
              <div class="slide-title">{{ slide.title }}</div>
              <div class="slide-divider" />
              <ul class="slide-bullets">
                <li v-for="(b, j) in slide.bullets" :key="j" class="slide-bullet">{{ b }}</li>
              </ul>
            </div>
          </div>
          <div class="slide-num">{{ i + 1 }}</div>
        </div>
      </div>

      <!-- Edit panel (shown when a content slide is selected) -->
      <div v-if="selectedIdx !== null && selectedIdx >= 0" class="edit-panel">
        <div class="edit-panel-inner">
          <!-- Text edit row -->
          <div class="edit-label">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" width="13" height="13">
              <path d="M9.5 1.5l3 3-8 8H1.5V9.5l8-8z"/>
            </svg>
            修改第 {{ selectedIdx + 1 }} 页：{{ doc.slides[selectedIdx]?.title }}
          </div>
          <div class="edit-row">
            <input
              v-model="editInstruction"
              type="text"
              class="edit-input"
              placeholder="例：帮我精简这页内容，只保留 3 个重点  /  换成数据驱动风格，补充具体指标  /  标题改为..."
              :disabled="isEditing"
              @keydown.enter.prevent="editSlide"
            />
            <button class="btn-edit" :disabled="isEditing || !editInstruction.trim()" @click="editSlide">
              <span v-if="isEditing" class="spinner spinner-sm" />
              <svg v-else viewBox="0 0 16 16" fill="currentColor" width="13" height="13">
                <path d="M8 1l1.5 4L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5z"/>
              </svg>
              {{ isEditing ? 'AI 改写中...' : 'AI 修改此页' }}
            </button>
          </div>

          <!-- Image controls -->
          <div class="img-edit-row">
            <div class="img-edit-preview">
              <img
                v-if="slideImages[selectedIdx]"
                :src="`data:image/png;base64,${slideImages[selectedIdx]}`"
                class="img-edit-thumb"
                alt=""
              />
              <div v-else-if="slideImgLoading[selectedIdx]" class="img-edit-loading">
                <span class="spinner spinner-sm" />
                <span>配图生成中...</span>
              </div>
              <div v-else class="img-edit-empty">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.2" width="22" height="22" opacity="0.3">
                  <rect x="2" y="4" width="16" height="12" rx="2"/>
                  <circle cx="7" cy="9" r="2"/>
                  <path d="M2 14l4-4 3 3 3-3 6 6"/>
                </svg>
                <span>暂无配图</span>
              </div>
            </div>
            <div class="img-edit-btns">
              <button
                class="btn-reimg"
                :disabled="slideImgLoading[selectedIdx] || !props.apiKey"
                @click="regenerateSlideImage(selectedIdx)"
              >
                <span v-if="slideImgLoading[selectedIdx]" class="spinner spinner-sm" />
                <svg v-else viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12">
                  <path d="M1 7a6 6 0 1 0 1-3.5"/><polyline points="1,2 1,5.5 4.5,5.5"/>
                </svg>
                {{ slideImgLoading[selectedIdx] ? '生成中...' : slideImages[selectedIdx] ? '重新配图' : '生成配图' }}
              </button>
              <button
                v-if="slideImages[selectedIdx]"
                class="btn-delimg"
                @click="removeSlideImage(selectedIdx)"
              >删除配图</button>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="selectedIdx === null" class="edit-hint">
        点击任意幻灯片可预览详情并进行 AI 精准修改 · 可单独修改配图
      </div>
    </template>

    <!-- Toasts -->
    <Teleport to="body">
      <div class="toast-stack">
        <TransitionGroup name="toast">
          <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">
            <svg v-if="t.type === 'success'" viewBox="0 0 16 16" fill="none" stroke="#78C882" stroke-width="2" width="14" height="14">
              <polyline points="2,8 6,12 14,4"/>
            </svg>
            <svg v-else-if="t.type === 'error'" viewBox="0 0 16 16" fill="none" stroke="#E07050" stroke-width="2" width="14" height="14">
              <circle cx="8" cy="8" r="6"/><path d="M8 5v3M8 10.5v.5"/>
            </svg>
            <svg v-else viewBox="0 0 16 16" fill="none" stroke="#C4813A" stroke-width="2" width="14" height="14">
              <circle cx="8" cy="8" r="6"/><path d="M8 7v4M8 5.5v.5"/>
            </svg>
            {{ t.msg }}
          </div>
        </TransitionGroup>
      </div>
    </Teleport>

  </div>
</template>

<style scoped>
.ppt-root {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 48px);
  background: var(--bg);
  overflow: hidden;
}

/* ── Input page header ── */
.ppt-page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0;
}
.ppt-brand { display: flex; align-items: center; gap: 10px; }
.ppt-brand-name { font-size: 16px; font-weight: 700; color: var(--text); letter-spacing: -0.2px; }
.ppt-tabs {
  display: flex; gap: 2px; margin-left: 14px; padding: 3px;
  background: rgba(0,0,0,0.2); border-radius: 9px; border: 1px solid var(--border);
}
.ptab {
  padding: 5px 14px; background: transparent; border: none; border-radius: 6px;
  color: var(--text-2); font-size: 13px; font-weight: 500; cursor: pointer;
  transition: all 0.15s; font-family: inherit;
}
.ptab:hover { color: var(--text); }
.ptab.active { background: rgba(196,129,58,0.15); color: var(--accent-lt); }
.ppt-header-actions { display: flex; align-items: center; gap: 8px; }
.btn-settings-sm {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; background: transparent;
  border: 1px solid var(--border); border-radius: 8px; color: var(--text-2); cursor: pointer;
  transition: all 0.15s;
}
.btn-settings-sm:hover { color: var(--text); border-color: rgba(196,129,58,0.3); }
.input-divider { height: 1px; background: var(--border); margin: 14px 0; }
.input-sub-header { margin-bottom: 8px; }

/* ── Input card ── */
.input-wrap {
  flex: 1; display: flex; align-items: flex-start; justify-content: center;
  padding: 32px 24px 40px; overflow-y: auto;
}
.input-card { width: 100%; max-width: 660px; }
.input-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 18px; font-weight: 700; color: var(--text);
}
.input-desc { font-size: 13px; color: var(--text-2); line-height: 1.65; margin-bottom: 28px; }

.field { margin-bottom: 18px; }
.field label {
  display: block; font-size: 12px; color: var(--text-2); margin-bottom: 6px;
  text-transform: uppercase; letter-spacing: 0.4px;
}
.field label em { text-transform: none; font-style: normal; color: var(--text-3); font-size: 11px; }
.required { color: var(--accent); }

.text-input, .text-area {
  width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
  padding: 11px 14px; color: var(--text); font-size: 14px; outline: none;
  font-family: inherit; transition: border-color 0.2s; box-sizing: border-box;
}
.text-input:focus, .text-area:focus { border-color: var(--accent); }
.text-input::placeholder, .text-area::placeholder { color: var(--text-3); }
.text-area { resize: vertical; line-height: 1.65; }

/* ── AI 配图 toggle ── */
.field-toggle-row { margin-bottom: 22px; }
.toggle-row-label {
  display: flex; align-items: center; gap: 10px; cursor: pointer; user-select: none;
}
.toggle-pill {
  flex-shrink: 0; width: 34px; height: 20px; border-radius: 99px;
  background: rgba(255,255,255,0.08); border: 1px solid var(--border);
  position: relative; transition: background 0.2s, border-color 0.2s;
}
.toggle-pill.on { background: rgba(196,129,58,0.35); border-color: var(--accent); }
.toggle-dot {
  position: absolute; top: 3px; left: 3px;
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--text-3); transition: transform 0.2s, background 0.2s;
}
.toggle-pill.on .toggle-dot { transform: translateX(14px); background: var(--accent); }
.toggle-text { font-size: 13px; font-weight: 500; color: var(--text-2); }
.toggle-row-label em { font-style: normal; font-size: 12px; color: var(--text-3); }

.error-msg { font-size: 13px; color: #E07050; margin-bottom: 14px; }

.btn-generate {
  width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 14px; background: linear-gradient(135deg, var(--accent), var(--accent-dk));
  border: none; border-radius: 12px; color: #FFF8F0; font-size: 15px; font-weight: 600;
  cursor: pointer; transition: opacity 0.2s; box-shadow: 0 4px 16px rgba(196,129,58,0.3);
  font-family: inherit;
}
.btn-generate:hover:not(:disabled) { opacity: 0.88; }
.btn-generate:disabled { opacity: 0.5; cursor: default; }

/* ── Preview header ── */
.preview-header {
  display: flex; align-items: center; gap: 12px; padding: 10px 24px;
  border-bottom: 1px solid var(--border); background: var(--bg-card); flex-shrink: 0;
}
.preview-brand { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.preview-brand-name { font-size: 15px; font-weight: 700; color: var(--text); }
.ppt-tabs-preview { margin-left: 10px; }
.doc-title-wrap { flex: 1; min-width: 0; }
.doc-title { font-size: 16px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.doc-subtitle { font-size: 12px; color: var(--text-2); }
.preview-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.slide-count { font-size: 12px; color: var(--text-3); }

.btn-rewrite {
  display: flex; align-items: center; gap: 5px; background: transparent;
  border: 1px solid var(--border); border-radius: 7px; color: var(--text-2);
  font-size: 12px; padding: 5px 10px; cursor: pointer; transition: all 0.15s; font-family: inherit;
}
.btn-rewrite:hover { color: var(--text); border-color: rgba(196,129,58,0.3); }

/* 配图进度 pill */
.img-gen-pill {
  display: flex; align-items: center; gap: 6px; font-size: 12px;
  color: var(--accent-lt); padding: 4px 10px;
  border: 1px solid rgba(196,129,58,0.3); border-radius: 99px;
  background: rgba(196,129,58,0.07);
}

.btn-export {
  display: flex; align-items: center; gap: 6px; padding: 8px 16px;
  background: linear-gradient(135deg, var(--accent), var(--accent-dk));
  border: none; border-radius: 8px; color: #FFF8F0; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: opacity 0.2s; box-shadow: 0 2px 10px rgba(196,129,58,0.3);
  font-family: inherit;
}
.btn-export:hover:not(:disabled) { opacity: 0.88; }
.btn-export:disabled { opacity: 0.5; cursor: default; }

/* ── Slide strip ── */
.slide-strip {
  display: flex; gap: 16px; padding: 24px;
  overflow-x: auto; flex-shrink: 0;
  scrollbar-width: thin; scrollbar-color: rgba(196,129,58,0.2) transparent;
}

.slide-card {
  flex-shrink: 0; width: 260px; aspect-ratio: 16 / 9;
  border-radius: 10px; overflow: hidden; cursor: pointer; position: relative;
  border: 2px solid rgba(196,129,58,0.1);
  transition: border-color 0.2s, transform 0.15s, box-shadow 0.2s;
}
.slide-card:hover { border-color: rgba(196,129,58,0.35); transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
.slide-card.selected { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(196,129,58,0.25), 0 8px 24px rgba(0,0,0,0.4); }

.slide-inner {
  width: 100%; height: 100%; background: #1C1510; position: relative;
  overflow: hidden; display: flex;
}

/* Cover */
.cover-inner {
  background: #120E09; align-items: center; justify-content: center; text-align: center;
  padding: 14px 12px;
}
.cover-glow {
  position: absolute; top: -30px; right: -30px; width: 100px; height: 100px;
  border-radius: 50%; background: radial-gradient(circle, rgba(196,129,58,0.25) 0%, transparent 70%);
}
.cover-title { font-size: 13px; font-weight: 700; color: #EAD9C0; line-height: 1.4; position: relative; }
.cover-subtitle { font-size: 10px; color: #8A6B50; margin-top: 6px; position: relative; }

/* Accent bar */
.slide-accent-bar {
  position: absolute; left: 0; top: 0; width: 3px; height: 100%;
  background: var(--accent, #C4813A); flex-shrink: 0;
}

/* Image side panel in card */
.slide-img-side {
  width: 88px; flex-shrink: 0; height: 100%; overflow: hidden;
  position: absolute; right: 0; top: 0;
}
.slide-img-preview { width: 100%; height: 100%; object-fit: cover; display: block; }
.slide-img-spin {
  width: 100%; height: 100%;
  background: rgba(196,129,58,0.06);
  display: flex; align-items: center; justify-content: center;
}

/* Text area in card */
.slide-text {
  flex: 1; padding: 10px 10px 10px 14px; display: flex; flex-direction: column;
  overflow: hidden;
}
.slide-text.compact { padding-right: 96px; }

.slide-title {
  font-size: 11px; font-weight: 700; color: #E8A86A; line-height: 1.3;
  margin-bottom: 5px; overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.slide-divider { height: 1px; background: var(--accent, #C4813A); opacity: 0.4; margin-bottom: 5px; }
.slide-bullets { list-style: none; padding: 0; margin: 0; flex: 1; overflow: hidden; }
.slide-bullet {
  font-size: 9px; color: #C8B89A; line-height: 1.5;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  padding-left: 8px; position: relative;
}
.slide-bullet::before { content: '•'; position: absolute; left: 0; color: var(--accent, #C4813A); }

.slide-num { position: absolute; bottom: 5px; right: 8px; font-size: 8px; color: #4A3525; }

/* ── Edit panel ── */
.edit-panel {
  flex-shrink: 0; background: var(--bg-card); border-top: 1px solid var(--border); padding: 14px 24px;
}
.edit-panel-inner { max-width: 900px; }
.edit-label {
  display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-2);
  margin-bottom: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.edit-row { display: flex; gap: 10px; }
.edit-input {
  flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
  padding: 9px 12px; color: var(--text); font-size: 13px; outline: none;
  font-family: inherit; transition: border-color 0.2s;
}
.edit-input:focus { border-color: var(--accent); }
.edit-input::placeholder { color: var(--text-3); }
.edit-input:disabled { opacity: 0.5; }
.btn-edit {
  display: flex; align-items: center; gap: 6px; padding: 9px 18px;
  background: linear-gradient(135deg, var(--accent), var(--accent-dk));
  border: none; border-radius: 8px; color: #FFF8F0; font-size: 13px; font-weight: 600;
  cursor: pointer; white-space: nowrap; transition: opacity 0.2s; font-family: inherit;
}
.btn-edit:hover:not(:disabled) { opacity: 0.88; }
.btn-edit:disabled { opacity: 0.45; cursor: default; }

/* Image edit controls */
.img-edit-row {
  display: flex; align-items: center; gap: 12px;
  margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border);
}
.img-edit-preview {
  width: 100px; height: 58px; flex-shrink: 0; border-radius: 6px; overflow: hidden;
  border: 1px solid var(--border); background: rgba(196,129,58,0.04);
  display: flex; align-items: center; justify-content: center;
}
.img-edit-thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
.img-edit-loading { display: flex; flex-direction: column; align-items: center; gap: 5px; font-size: 10px; color: var(--text-3); }
.img-edit-empty { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 10px; color: var(--text-3); }

.img-edit-btns { display: flex; gap: 8px; }
.btn-reimg {
  display: flex; align-items: center; gap: 5px; padding: 7px 12px;
  background: transparent; border: 1px solid rgba(196,129,58,0.35); border-radius: 7px;
  color: var(--accent-lt); font-size: 12px; cursor: pointer; transition: all 0.15s; font-family: inherit;
}
.btn-reimg:hover:not(:disabled) { background: rgba(196,129,58,0.08); }
.btn-reimg:disabled { opacity: 0.4; cursor: default; }
.btn-delimg {
  padding: 7px 12px; background: transparent; border: 1px solid var(--border);
  border-radius: 7px; color: var(--text-3); font-size: 12px; cursor: pointer;
  transition: all 0.15s; font-family: inherit;
}
.btn-delimg:hover { border-color: rgba(224,112,80,0.4); color: #E07050; }

.edit-hint { padding: 14px 24px; font-size: 12px; color: var(--text-3); text-align: center; flex-shrink: 0; }

/* ── Cursor badge ── */
.cursor-badge {
  font-size: 10px; font-weight: 600; padding: 2px 7px;
  background: rgba(196,129,58,0.12); border: 1px solid rgba(196,129,58,0.3);
  border-radius: 99px; color: var(--accent-lt); letter-spacing: 0.3px;
}

/* ── Spinner ── */
.spinner {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid rgba(255,248,240,0.3); border-top-color: #FFF8F0;
  animation: spin 0.8s linear infinite;
}
.spinner-sm { width: 13px; height: 13px; border-width: 1.5px; }
.task-mini-spin {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid rgba(196,129,58,0.2); border-top-color: var(--accent);
  animation: spin 1s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Toasts ── */
.toast-stack {
  position: fixed; top: 20px; right: 20px; z-index: 9999;
  display: flex; flex-direction: column; gap: 8px; pointer-events: none;
}
.toast {
  display: flex; align-items: center; gap: 9px; padding: 10px 16px;
  background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px;
  font-size: 13px; color: var(--text); box-shadow: 0 8px 24px rgba(0,0,0,0.5); min-width: 180px;
}
.toast.success { border-color: rgba(120,200,130,0.3); }
.toast.error   { border-color: rgba(224,112,80,0.3); color: #E8A090; }
.toast.info    { border-color: rgba(196,129,58,0.35); }
.toast-enter-active { transition: all 0.25s cubic-bezier(0.34,1.56,0.64,1); }
.toast-leave-active { transition: all 0.2s ease; }
.toast-enter-from   { opacity: 0; transform: translateX(20px) scale(0.94); }
.toast-leave-to     { opacity: 0; transform: translateX(10px); }

/* ── Reference PPT upload ── */
.btn-upload-ref {
  display: inline-flex; align-items: center; gap: 7px; padding: 9px 14px;
  background: transparent; border: 1px dashed rgba(196,129,58,0.35); border-radius: 8px;
  color: var(--text-2); font-size: 13px; cursor: pointer; transition: all 0.15s; font-family: inherit;
}
.btn-upload-ref:hover { color: var(--accent-lt); border-color: rgba(196,129,58,0.6); background: rgba(196,129,58,0.05); }
.ref-file-chip {
  display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px;
  background: rgba(196,129,58,0.08); border: 1px solid rgba(196,129,58,0.25);
  border-radius: 8px; color: var(--accent-lt); font-size: 13px; max-width: 100%;
}
.ref-file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.ref-file-remove {
  background: none; border: none; color: var(--text-3); cursor: pointer;
  font-size: 16px; line-height: 1; padding: 0 2px; transition: color 0.15s; flex-shrink: 0;
}
.ref-file-remove:hover { color: #E07050; }
</style>
