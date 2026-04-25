<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ initialKey: string; initialUrl: string }>()
const emit = defineEmits<{ save: [key: string, url: string] }>()

const key = ref(props.initialKey)
const url = ref(props.initialUrl || 'https://bobdong.cn/v1')
const error = ref('')

const onSave = () => {
  if (!key.value.trim()) { error.value = '请输入 API Key'; return }
  error.value = ''
  emit('save', key.value.trim(), url.value.trim() || 'https://bobdong.cn/v1')
}
</script>

<template>
  <div class="page">
    <div class="card">
      <!-- 品牌 -->
      <div class="brand">
        <div class="logo">
          <svg viewBox="0 0 36 36" fill="none">
            <rect width="36" height="36" rx="9" fill="#2A1A0C"/>
            <text x="8" y="26" font-size="20" font-weight="700" fill="#EAD9C0" font-family="serif">D</text>
            <rect x="8" y="28" width="20" height="1.5" rx="1" fill="#C4813A" opacity="0.7"/>
          </svg>
        </div>
        <div>
          <h1 class="brand-name">Deepin Image</h1>
          <p class="brand-sub">AI 图像生成平台</p>
        </div>
      </div>

      <div class="rule" />

      <h2 class="form-title">配置 API Key</h2>
      <p class="form-desc">填入你自己的 API Key，图片将走你自己的账户额度。<br/>Key 只存储在本地浏览器，不会上传至任何服务器。</p>

      <div class="field">
        <label>API Key</label>
        <input v-model="key" type="password" placeholder="sk-..." @keyup.enter="onSave" />
      </div>

      <div class="field">
        <label>Base URL <em>（可选）</em></label>
        <input v-model="url" type="text" placeholder="https://bobdong.cn/v1" />
      </div>

      <p v-if="error" class="err">{{ error }}</p>

      <button class="btn" @click="onSave">开始使用</button>

      <p class="foot">支持 OpenAI 兼容接口 · 模型 gpt-5.4</p>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: radial-gradient(ellipse at 50% 0%, #2A1A0C 0%, #120E09 60%);
}

.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 40px;
  width: 100%;
  max-width: 420px;
  box-shadow: 0 32px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04);
}

.brand { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
.logo svg { width: 40px; height: 40px; }
.brand-name { font-size: 18px; font-weight: 700; color: var(--text); letter-spacing: -0.3px; }
.brand-sub { font-size: 12px; color: var(--text-2); margin-top: 2px; }

.rule { height: 1px; background: var(--border); margin-bottom: 28px; }

.form-title { font-size: 16px; font-weight: 600; color: var(--text); margin-bottom: 8px; }
.form-desc { font-size: 13px; color: var(--text-2); line-height: 1.65; margin-bottom: 24px; }

.field { margin-bottom: 16px; }
.field label { display: block; font-size: 12px; color: var(--text-2); margin-bottom: 6px; letter-spacing: 0.3px; text-transform: uppercase; }
.field label em { text-transform: none; font-style: normal; color: var(--text-3); font-size: 11px; }

.field input {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 11px 14px;
  color: var(--text);
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}
.field input:focus { border-color: var(--accent); }
.field input::placeholder { color: var(--text-3); }

.err { font-size: 13px; color: #E07050; margin-bottom: 12px; }

.btn {
  width: 100%;
  margin-top: 8px;
  padding: 13px;
  background: linear-gradient(135deg, var(--accent), var(--accent-dk));
  border: none;
  border-radius: 12px;
  color: #FFF8F0;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  letter-spacing: 0.2px;
  transition: opacity 0.2s, transform 0.1s;
  box-shadow: 0 4px 16px rgba(196, 129, 58, 0.3);
}
.btn:hover { opacity: 0.88; }
.btn:active { transform: scale(0.98); }

.foot { text-align: center; font-size: 12px; color: var(--text-3); margin-top: 18px; }
</style>
