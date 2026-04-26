import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

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

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

const PORT = process.env.PORT || 3003
app.listen(PORT, () => console.log(`🎨 ai-image server: http://localhost:${PORT}`))
