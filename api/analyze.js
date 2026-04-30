export const config = {
  maxDuration: 60,
};

// 模型備援清單(依優先序,前面失敗就降級)
const MODELS = [
  'gemini-2.5-flash',       // 主要:速度快、品質好
  'gemini-2.0-flash',       // 備援 1:穩定老版本
  'gemini-flash-latest',    // 備援 2:最新 flash
  'gemini-pro-latest',      // 備援 3:Pro 版(較慢但更穩)
];

// 重試函式:遇到 503/429/500 等暫時性錯誤時自動重試
async function fetchWithRetry(url, options, maxRetries = 3) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const r = await fetch(url, options);
      // 暫時性錯誤(伺服器過載/流量限制)→ 重試
      if (r.status === 503 || r.status === 429 || r.status === 500 || r.status === 502 || r.status === 504) {
        lastError = `HTTP ${r.status}`;
        // 指數退避:第 1 次等 1 秒,第 2 次 2 秒,第 3 次 4 秒
        const wait = 1000 * Math.pow(2, i);
        await new Promise(res => setTimeout(res, wait));
        continue;
      }
      return r; // 成功或永久性錯誤(400/401/404),直接回傳
    } catch (e) {
      lastError = e.message;
      const wait = 1000 * Math.pow(2, i);
      await new Promise(res => setTimeout(res, wait));
    }
  }
  throw new Error(`重試 ${maxRetries} 次後仍失敗:${lastError}`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
  }

  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'no prompt' });
    }

    const requestBody = JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: prompt }],
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
      },
    });

    const errors = [];

    // 依序嘗試每個模型,某個失敗就換下一個
    for (const model of MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const r = await fetchWithRetry(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody,
        }, 3);

        if (!r.ok) {
          const errText = await r.text();
          errors.push(`${model}: HTTP ${r.status} - ${errText.slice(0, 200)}`);
          continue; // 試下一個模型
        }

        const data = await r.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const finishReason = data.candidates?.[0]?.finishReason || '';

        // 成功!回傳結果並標明用了哪個模型
        return res.status(200).json({
          text,
          model_used: model,
          stop_reason: finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn',
        });
      } catch (e) {
        errors.push(`${model}: ${e.message}`);
        // 繼續試下一個模型
      }
    }

    // 所有模型都失敗
    return res.status(503).json({
      error: '所有 Gemini 模型都暫時無法使用,請稍後再試',
      detail: errors.join(' | '),
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
