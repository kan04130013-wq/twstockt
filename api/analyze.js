export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.Gemini_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Gemini_API_KEY not configured' });
  }

  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'no prompt' });
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(r.status).json({
        error: `Anthropic API ${r.status}`,
        detail: errText
      });
    }

    const data = await r.json();
    const text = data.content?.[0]?.text || '';
    return res.status(200).json({
      text,
      stop_reason: data.stop_reason
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
