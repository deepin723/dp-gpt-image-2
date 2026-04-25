<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ initialKey: string; initialUrl: string }>()
const emit = defineEmits<{ save: [key: string, url: string] }>()

const key = ref(props.initialKey)
const url = ref(props.initialUrl || 'https://bobdong.cn/v1')
const error = ref('')

const onSave = () => {
  if (!key.value.trim()) {
    error.value = '请输入 API Key'
    return
  }
  error.value = ''
  emit('save', key.value.trim(), url.value.trim() || 'https://bobdong.cn/v1')
}
</script>

<template>
  <div class="setup-page">
    <div class="card">
      <div class="brand">
        <div class="logo-ring">D</div>
        <div>
          <h1 class="brand-name">Deepin6677</h1>
          <p class="brand-sub">AI 图像生成平台</p>
        </div>
      </div>

      <div class="divider" />

      <h2 class="form-title">配置你的 API Key</h2>
      <p class="form-desc">填入你自己的 API Key，图片生成将走你自己的账户额度。Key 只存在本地浏览器，不会上传到任何服务器。</p>

      <div class="field">
        <label>API Key</label>
        <input
          v-model="key"
          type="password"
          placeholder="sk-..."
          @keyup.enter="onSave"
        />
      </div>

      <div class="field">
        <label>Base URL <span class="optional">（可选）</span></label>
        <input
          v-model="url"
          type="text"
          placeholder="https://bobdong.cn/v1"
        />
      </div>

      <p v-if="error" class="error">{{ error }}</p>

      <button class="btn-save" @click="onSave">开始使用</button>

      <p class="hint">支持 OpenAI 兼容接口 · 模型 gpt-5.4</p>
    </div>
  </div>
</template>

<style scoped>
.setup-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: radial-gradient(ellipse at top, #1a1035 0%, #0d0d1a 60%);
}

.card {
  background: #16162a;
  border: 1px solid rgba(102, 126, 234, 0.2);
  border-radius: 20px;
  padding: 40px;
  width: 100%;
  max-width: 440px;
  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.5);
}

.brand {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 28px;
}

.logo-ring {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea, #764ba2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 800;
  color: white;
  flex-shrink: 0;
}

.brand-name {
  font-size: 20px;
  font-weight: 700;
  color: #f0f0ff;
}

.brand-sub {
  font-size: 13px;
  color: #6b7280;
  margin-top: 2px;
}

.divider {
  height: 1px;
  background: rgba(255,255,255,0.06);
  margin-bottom: 28px;
}

.form-title {
  font-size: 17px;
  font-weight: 600;
  color: #e2e8f0;
  margin-bottom: 8px;
}

.form-desc {
  font-size: 13px;
  color: #6b7280;
  line-height: 1.6;
  margin-bottom: 24px;
}

.field {
  margin-bottom: 16px;
}

.field label {
  display: block;
  font-size: 13px;
  color: #9ca3af;
  margin-bottom: 6px;
}

.optional {
  color: #4b5563;
  font-size: 12px;
}

.field input {
  width: 100%;
  background: #0d0d1a;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 10px;
  padding: 11px 14px;
  color: #e2e8f0;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.field input:focus {
  border-color: #667eea;
}

.field input::placeholder {
  color: #374151;
}

.error {
  color: #f87171;
  font-size: 13px;
  margin-bottom: 12px;
}

.btn-save {
  width: 100%;
  padding: 13px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  border: none;
  border-radius: 12px;
  color: white;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s;
  margin-top: 8px;
}

.btn-save:hover { opacity: 0.9; }
.btn-save:active { transform: scale(0.98); }

.hint {
  text-align: center;
  font-size: 12px;
  color: #374151;
  margin-top: 16px;
}
</style>
