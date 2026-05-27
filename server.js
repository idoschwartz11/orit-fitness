require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is missing. Create a .env file with your key.');
  process.exit(1);
}

// --- Security middleware ---

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://script.google.com"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"]
    }
  }
}));

app.use(express.json({ limit: '10kb' }));

app.use(express.static(path.join(__dirname, 'public')));

// Rate limit: 20 chat requests per minute per IP
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'יותר מדי בקשות. נסה/י שוב בעוד דקה.' }
});

// --- Chat proxy endpoint ---

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

app.post('/api/chat', chatLimiter, async (req, res) => {
  const { message, context } = req.body;

  // Server-side validation
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

  // Validate context if provided
  const userName = (context?.name || 'מתאמן').slice(0, 50);
  const userAge = (context?.age || 'לא ידוע').toString().slice(0, 5);
  const userGoal = (context?.goal || 'כללי').slice(0, 50);

  const systemPrompt = `אתה עוזר כושר ותזונה בשם "אורית AI". המשתמש הוא ${userName}, גיל ${userAge}, מטרה: ${userGoal}.
ענה בעברית בלבד, ידידותי, קצר וברור. השתמש באמוג׳ים. אל תתן עצות רפואיות.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: trimmed }] }],
        generationConfig: {
          maxOutputTokens: 600,
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

    res.json({ answer: text });

  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'השרת לא הגיב בזמן. נסה/י שוב.' });
    }
    console.error('Chat proxy error:', err.message);
    res.status(500).json({ error: 'שגיאה פנימית. נסה/י שוב.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
