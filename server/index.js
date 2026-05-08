import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import pptxgen from 'pptxgenjs'
import JSZip from 'jszip'
import { spawn } from 'child_process'
import { tmpdir } from 'os'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
app.use(cors())
app.use(express.json({ limit: '25mb' }))

/**
 * POST /api/generate-image
 * Headers: x-api-key, x-base-url (用户自己的 key 和 base URL)
 * Body: { prompt: string }
 * 返回: { imageBase64: string }
 */
app.post('/api/generate-image', async (req, res) => {
  const apiKey = req.headers['x-api-key']
  const baseUrl = (req.headers['x-base-url'] || 'https://bobdong.cn/v1').replace(/\/$/, '')
  const { prompt, referenceImageBase64, referenceImageMime, size } = req.body

  if (!apiKey) return res.status(401).json({ error: '请先配置你的 API Key' })
  if (!prompt) return res.status(400).json({ error: '请输入描述文字' })

  console.log(`[generate-image] baseUrl=${baseUrl} hasRefImage=${!!referenceImageBase64} prompt=${prompt.slice(0, 60)}...`)

  // Build input content — with or without reference image
  const inputContent = referenceImageBase64
    ? [
        { type: 'input_image', image_url: `data:${referenceImageMime || 'image/jpeg'};base64,${referenceImageBase64}` },
        { type: 'input_text', text: prompt },
      ]
    : prompt

  try {
    const response = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5.4',
        input: [{ role: 'user', content: inputContent }],
        tools: [{ type: 'image_generation', size: size || '1024x1024' }],
        stream: true,
      }),
      signal: AbortSignal.timeout(600_000),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('[generate-image] API error:', errText)
      return res.status(500).json({ error: errText })
    }

    // 逐块读取 SSE 流，找到图片立即返回
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let imageB64 = null

    outer: while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const dataStr = trimmed.slice(5).trim()
        if (dataStr === '[DONE]') break outer
        try {
          const data = JSON.parse(dataStr)
          if (data.type === 'response.output_item.done') {
            const item = data.item || {}
            if (item.type === 'image_generation_call' && item.result) {
              imageB64 = item.result
              break outer
            }
          }
        } catch {
          // 忽略解析失败的行
        }
      }
    }

    reader.cancel().catch(() => {})

    if (imageB64) {
      res.json({ imageBase64: imageB64 })
    } else {
      res.status(500).json({ error: '未获取到图像数据，请检查 API Key 是否有图片生成权限' })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误'
    console.error('[generate-image] error:', message)
    res.status(500).json({ error: message })
  }
})

/**
 * POST /api/enhance-prompt
 * 将用户的简短中文描述扩展为专业英文图像生成提示词
 */
app.post('/api/enhance-prompt', async (req, res) => {
  const apiKey = req.headers['x-api-key']
  const baseUrl = (req.headers['x-base-url'] || 'https://bobdong.cn/v1').replace(/\/$/, '')
  const { prompt } = req.body

  if (!apiKey) return res.status(401).json({ error: '请先配置你的 API Key' })
  if (!prompt) return res.status(400).json({ error: '请输入描述文字' })

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5.4',
        messages: [
          {
            role: 'system',
            content: 'You are an expert at writing AI image generation prompts. The user will provide a brief description in Chinese. Expand it into a detailed, professional English prompt. Include composition, lighting, style, mood, and color tone. Output only the prompt text with no explanations or prefix, under 200 words.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 300,
      }),
      signal: AbortSignal.timeout(30_000),
    })
    const data = await response.json()
    const enhanced = data.choices?.[0]?.message?.content?.trim()
    if (enhanced) {
      res.json({ enhanced })
    } else {
      res.status(500).json({ error: '优化失败，请重试' })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '网络错误'
    res.status(500).json({ error: message })
  }
})

// ── PPT helpers ──────────────────────────────────────────────────────────────

// Parse a base64-encoded .pptx and return a text summary of each slide
async function extractPptxText(base64) {
  const buf = Buffer.from(base64, 'base64')
  const zip = await JSZip.loadAsync(buf)
  const slideFiles = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)[0])
      const nb = parseInt(b.match(/\d+/)[0])
      return na - nb
    })
  const slides = []
  for (const name of slideFiles) {
    const xml = await zip.files[name].async('string')
    const texts = []
    let m
    const re = /<a:t[^>]*>([^<]+)<\/a:t>/g
    while ((m = re.exec(xml)) !== null) {
      const t = m[1].trim()
      if (t) texts.push(t)
    }
    if (texts.length) slides.push(texts.join(' | '))
  }
  return slides
}

const PPT_GEN_SYSTEM = `You are a presentation outline designer. Return ONLY valid JSON (no markdown fences):
{
  "title": "presentation title",
  "subtitle": "one-line tagline",
  "cover_keywords": "3 English keywords for cover image",
  "slides": [
    { "title": "slide title", "bullets": ["point 1", "point 2", "point 3"], "keywords": "2-3 English keywords" }
  ]
}
Rules: 6-10 slides, 3-5 concise bullets each (10-25 words), same language as input, keywords must be English only.`

const PPT_EDIT_SYSTEM = `You are editing one slide. Return ONLY the updated slide as valid JSON (no markdown):
{ "title": "...", "bullets": ["..."] }
Keep bullets concise (10-20 words each), same language as input.`

function parseJsonStrict(raw) {
  const s = (typeof raw === 'string' ? raw : JSON.stringify(raw))
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  return JSON.parse(s)
}

async function runCursorAgent({ apiKey, prompt, model = 'auto', timeoutMs = 120_000 }) {
  const workspace = fs.mkdtempSync(path.join(tmpdir(), 'ppt-cursor-'))
  return new Promise((resolve, reject) => {
    const proc = spawn('agent', ['-p', '--output-format', 'json', '--force', '--workspace', workspace, '--model', model, prompt], {
      env: { ...process.env, CURSOR_API_KEY: apiKey },
      timeout: timeoutMs,
    })
    let stdout = '', stderr = ''
    proc.stdout.on('data', d => stdout += d.toString())
    proc.stderr.on('data', d => stderr += d.toString())
    proc.on('close', code => {
      try { fs.rmSync(workspace, { recursive: true, force: true }) } catch {}
      if (code !== 0) return reject(new Error(stderr.slice(0, 500) || `agent exited ${code}`))
      try { const w = JSON.parse(stdout); resolve(w.result ?? stdout.trim()) }
      catch { resolve(stdout.trim()) }
    })
    proc.on('error', err => {
      try { fs.rmSync(workspace, { recursive: true, force: true }) } catch {}
      reject(err.code === 'ENOENT' ? new Error('Cursor CLI 未安装，请检查 Docker 镜像') : err)
    })
  })
}

async function callLLM({ apiKey, baseUrl, cursorKey, cursorModel, system, user }) {
  if (cursorKey) {
    const raw = await runCursorAgent({ apiKey: cursorKey, model: cursorModel || 'auto', prompt: `${system}\n\n---\n\n${user}` })
    return typeof raw === 'string' ? raw : JSON.stringify(raw)
  }
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5.4', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 3000 }),
    signal: AbortSignal.timeout(60_000),
  })
  const data = await resp.json()
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error))
  return data.choices?.[0]?.message?.content?.trim() || ''
}

// ── PPT routes ────────────────────────────────────────────────────────────────

app.post('/api/ppt/generate', async (req, res) => {
  const { topic, outline, referencePptBase64 } = req.body
  const apiKey    = req.headers['x-api-key']
  const baseUrl   = (req.headers['x-base-url'] || 'https://bobdong.cn/v1').replace(/\/$/, '')
  const cursorKey = req.headers['x-cursor-key']
  const cursorModel = req.headers['x-cursor-model']

  if (!apiKey && !cursorKey) return res.status(401).json({ error: '请先配置 API Key 或 Cursor Key' })
  if (!topic?.trim()) return res.status(400).json({ error: '请输入 PPT 主题' })

  let user = outline ? `Topic: ${topic}\n\nOutline:\n${outline}` : `Topic: ${topic}`

  // Inject reference PPT content if provided
  if (referencePptBase64) {
    try {
      const refSlides = await extractPptxText(referencePptBase64)
      if (refSlides.length) {
        const refText = refSlides.map((s, i) => `Slide ${i + 1}: ${s}`).join('\n')
        user = `Reference PPT (borrow its structure, key points, or style where helpful):\n${refText}\n\n---\n\n${user}`
      }
    } catch (e) {
      console.warn('[ppt/generate] reference parse failed:', e.message)
    }
  }

  try {
    const raw = await callLLM({ apiKey, baseUrl, cursorKey, cursorModel, system: PPT_GEN_SYSTEM, user })
    res.json(parseJsonStrict(raw))
  } catch (err) {
    console.error('[ppt/generate]', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/ppt/edit-slide', async (req, res) => {
  const { slide, instruction } = req.body
  const apiKey    = req.headers['x-api-key']
  const baseUrl   = (req.headers['x-base-url'] || 'https://bobdong.cn/v1').replace(/\/$/, '')
  const cursorKey = req.headers['x-cursor-key']
  const cursorModel = req.headers['x-cursor-model']

  if (!apiKey && !cursorKey) return res.status(401).json({ error: '请先配置 API Key 或 Cursor Key' })
  if (!slide || !instruction?.trim()) return res.status(400).json({ error: '缺少幻灯片数据或修改指令' })

  const user = `Current slide:\n${JSON.stringify(slide, null, 2)}\n\nInstruction: ${instruction}`
  try {
    const raw = await callLLM({ apiKey, baseUrl, cursorKey, cursorModel, system: PPT_EDIT_SYSTEM, user })
    res.json(parseJsonStrict(raw))
  } catch (err) {
    console.error('[ppt/edit-slide]', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/ppt/export', async (req, res) => {
  const { title, subtitle, slides } = req.body
  if (!slides?.length) return res.status(400).json({ error: '无幻灯片数据' })

  try {
    const prs = new pptxgen()
    prs.layout = 'LAYOUT_WIDE'
    const accents = ['C4813A', '8B5530', 'E8A86A', '6B3F1E', 'A0601A']

    // Cover slide
    const cover = prs.addSlide()
    cover.background = { color: '120E09' }
    cover.addShape(prs.ShapeType.ellipse, { x: 6.5, y: -1, w: 5.5, h: 5.5, fill: { color: 'C4813A', transparency: 88 }, line: { transparency: 100 } })
    cover.addText(title || 'Presentation', { x: 0.5, y: 1.8, w: 9, h: 2.2, fontSize: 36, bold: true, color: 'EAD9C0', align: 'center', wrap: true, shadow: { type: 'outer', color: '000000', opacity: 0.7, blur: 12, offset: 3, angle: 45 } })
    if (subtitle) cover.addText(subtitle, { x: 0.5, y: 4.0, w: 9, h: 0.8, fontSize: 18, color: '8A6B50', align: 'center' })

    // Content slides
    for (let i = 0; i < slides.length; i++) {
      const sd = slides[i]
      const c = accents[i % accents.length]
      const s = prs.addSlide()
      s.background = { color: '1C1510' }
      s.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: 0.07, h: 5.63, fill: { color: c }, line: { transparency: 100 } })
      s.addShape(prs.ShapeType.ellipse, { x: 8, y: -0.8, w: 3, h: 3, fill: { color: c, transparency: 90 }, line: { transparency: 100 } })
      s.addText(sd.title || '', { x: 0.25, y: 0.2, w: 9.7, h: 0.8, fontSize: 22, bold: true, color: 'E8A86A', wrap: true })
      s.addShape(prs.ShapeType.line, { x: 0.25, y: 1.08, w: 9.7, h: 0, line: { color: c, width: 0.75 } })
      if (sd.bullets?.length) {
        s.addText(sd.bullets.map(b => `  •  ${b}`).join('\n'), { x: 0.25, y: 1.25, w: 9.5, h: 4.1, fontSize: 15, color: 'C8B89A', lineSpacingMultiple: 1.6, valign: 'top', wrap: true })
      }
      s.addText(`${i + 1} / ${slides.length}`, { x: 8.5, y: 5.2, w: 1.2, h: 0.3, fontSize: 10, color: '4A3525', align: 'right' })
    }

    const buffer = await prs.write('nodebuffer')
    const safeName = (title || 'presentation').replace(/[^\w一-鿿 \-]/g, '').trim().slice(0, 40) || 'ppt'
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.pptx`)
    res.send(buffer)
  } catch (err) {
    console.error('[ppt/export]', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))
const PORT = process.env.PORT || 3003
app.listen(PORT, () => console.log(`🎨 ai-image server: http://localhost:${PORT}`))
