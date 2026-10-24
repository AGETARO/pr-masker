/**
 * Serverless API Handler: /api/generate
 * Securely calls Google Gemini Multimodal Vision API using server-side GEMINI_API_KEY.
 * Compatible with Vercel Serverless Functions and Netlify Functions.
 */

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  // Retrieve Gemini API Key from server environment variable
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    // Return 503 so client knows to fallback to built-in smart template engine
    return res.status(503).json({
      error: 'GEMINI_API_KEY is not configured in server environment variables.',
      fallback: true
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { image, tone = 'friendly', keyword = '', mimeType = 'image/jpeg' } = body;

    if (!image) {
      return res.status(400).json({ error: 'Missing image data.' });
    }

    // Extract base64 payload if data URL is passed
    const base64Data = image.includes(',') ? image.split(',')[1] : image;

    const tonePrompts = {
      friendly: '親しみやすく活気があり、笑顔やポジティブなエネルギーが伝わるカジュアルなSNS（X/Instagram）向け',
      formal: '誠実で信頼感があり、プレスリリースや公式Facebook、社内報に適した丁寧なビジネス向け',
      event: 'イベントやセミナーが大盛況で活気にあふれている様子を伝える熱意と感謝の文面',
      recruit: '職場の温かい雰囲気やオープンな社風をアピールし、求職者に響く採用・チーム紹介向け'
    };

    const targetTone = tonePrompts[tone] || tonePrompts.friendly;
    const cleanKeyword = (keyword || '').trim();

    const systemPrompt = `あなたはプロの広報・SNSマーケターです。
添付された画像の内容（人物の表情、人数、場所の雰囲気、行われている活動）を分析し、広報用の投稿文を日本語で作成してください。

【厳格な要件】
1. 文字数は「100文字程度（85文字〜110文字以内）」に厳密に収めてください。
2. トーン＆マナー：${targetTone}
3. キーワード：${cleanKeyword ? `「${cleanKeyword}」というキーワードを自然に含めてください。` : '画像から読み取れるテーマに合致させてください。'}
4. 最後に文脈に合うハッシュタグを2〜3個付与してください（ハッシュタグを含めて115文字以内に収めてください）。
5. 挨拶や前置き、文字数の注記は一切含めず、投稿文のみを出力してください。`;

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: systemPrompt },
              {
                inlineData: {
                  mimeType: mimeType || 'image/jpeg',
                  data: base64Data
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 250
        }
      })
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error(`Gemini API Error [${geminiRes.status}]:`, errText);
      return res.status(geminiRes.status).json({
        error: `Gemini API returned status ${geminiRes.status}`,
        fallback: true
      });
    }

    const data = await geminiRes.json();
    const outputText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!outputText) {
      return res.status(500).json({ error: 'No text returned from Gemini API.', fallback: true });
    }

    return res.status(200).json({
      success: true,
      text: outputText,
      model: model
    });
  } catch (err) {
    console.error('Server error handling /api/generate:', err);
    return res.status(500).json({
      error: err.message || 'Internal server error',
      fallback: true
    });
  }
}
