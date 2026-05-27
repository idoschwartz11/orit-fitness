const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

module.exports = async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not configured');
    return res.status(500).json({ error: 'שגיאה פנימית' });
  }

  const { message, context } = req.body || {};

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'הודעה חסרה' });
  }

  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return res.status(400).json({ error: 'הודעה ריקה' });
  }
  if (trimmed.length > 500) {
    return res.status(400).json({ error: 'ההודעה ארוכה מדי (מקסימום 500 תווים)' });
  }

  const userName = (context?.name || 'מתאמן').slice(0, 50);
  const userAge = (context?.age || 'לא ידוע').toString().slice(0, 5);
  const userGoal = (context?.goal || 'כללי').slice(0, 50);

  const systemPrompt = `אתה עוזר כושר ותזונה בשם "אורית AI". המשתמש הוא ${userName}, גיל ${userAge}, מטרה: ${userGoal}.
ענה בעברית בלבד, ידידותי, קצר וברור. השתמש באמוג׳ים. אל תתן עצות רפואיות.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: trimmed }] }],
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: 0.7
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
        ]
      })
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Gemini API error:', response.status, errBody);
      return res.status(502).json({ error: 'שגיאה מהשרת. נסה/י שוב.' });
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n').trim();

    if (!text) {
      return res.status(502).json({ error: 'תשובה ריקה מהשרת' });
    }

    return res.status(200).json({ answer: text });

  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'השרת לא הגיב בזמן. נסה/י שוב.' });
    }
    console.error('Chat error:', err.message);
    return res.status(500).json({ error: 'שגיאה פנימית. נסה/י שוב.' });
  }
};
