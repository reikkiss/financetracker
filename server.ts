import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';

function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured. Please check Settings > Secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

function getAiErrorStatus(err: any): number {
  const status = Number(err?.status || err?.code);
  // NEVER send 502, 503, or 504 because Nginx proxy_intercept_errors on converts them into warmup.html!
  if (status === 502 || status === 503 || status === 504 || status >= 500) return 200;
  if (status >= 400 && status < 500) return status;
  const msg = String(err?.message || '').toUpperCase();
  if (msg.includes('API_KEY_INVALID') || msg.includes('INVALID_ARGUMENT')) return 400;
  if (msg.includes('PERMISSION_DENIED')) return 403;
  if (msg.includes('NOT_FOUND')) return 404;
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) return 429;
  return 200;
}

async function startServer() {
  const app = express();

  app.use((req, res, next) => {
    const origin = req.headers.origin || '*';
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE, PATCH');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    if (req.headers['access-control-request-private-network']) {
      res.header('Access-Control-Allow-Private-Network', 'true');
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'finance-tracker-api' });
  });

  // Statement Parser Endpoint using Gemini API (supports PDF, images, CSV, TXT)
  app.post('/api/ai/parse-statement', async (req, res) => {
    try {
      const { fileDataBase64, mimeType, fileName, textContent, availableCategories, currency } = req.body || {};

      if (!fileDataBase64 && !textContent) {
        return res.status(400).json({ error: 'No statement file or text provided.' });
      }

      if (fileDataBase64 && mimeType === 'application/pdf') {
        const pdfBytes = Buffer.from(fileDataBase64, 'base64');
        if (pdfBytes.includes('/Encrypt')) {
          return res.status(400).json({
            error: 'This PDF statement is password-protected. Please unlock it in the browser first.'
          });
        }
      }

      const ai = getAiClient();
      const categoriesList = Array.isArray(availableCategories) && availableCategories.length > 0
        ? availableCategories.join(', ')
        : 'Salary, Freelance, Groceries, Housing, Subscriptions, Transport, Dining, Entertainment, Utilities, Business, Shopping, Other';

      const promptText = `Extract ALL financial transactions from this bank or credit card statement (${fileName || 'statement'}).
User's preferred categories: ${categoriesList}.
User's default currency: ${currency || 'USD'}.

Instructions:
1. Extract every single transaction line item accurately. Do NOT skip transactions and do NOT invent or fabricate transactions that are not in the document.
2. For each transaction:
   - title: Clean, readable merchant/description (max 100 chars).
   - amount: Positive decimal number (do not include currency symbols or minus signs; use the 'type' field to denote income vs expense).
   - type: 'income' for deposits, salary, credits, refunds, transfers in, or cashbacks; 'expense' for purchases, debits, withdrawals, interest charges, fees, or payments made.
   - category: Best matching category from the user's categories list (${categoriesList}), or a concise category name if none match.
   - date: Date formatted strictly as YYYY-MM-DD. If the statement omits the year on line items, infer the year from the statement header/period, or default to the current year ${new Date().getFullYear()}.
   - notes: Optional brief detail such as reference number, location, or foreign amount (max 150 chars).
   - isLoanPayment: true if this transaction appears to be a credit card payment, abono, or loan installment payment; otherwise false.
3. Also extract detectedAccountName (e.g. bank/card name if visible, or empty string) and statementPeriod (e.g. "Oct 2026", or empty string).`;

      const parts: any[] = [];
      if (fileDataBase64 && mimeType) {
        parts.push({
          inlineData: {
            mimeType,
            data: fileDataBase64,
          }
        });
      }
      if (textContent) {
        parts.push({
          text: `Statement raw text/CSV content:\n\n${textContent}`
        });
      }
      parts.push({ text: promptText });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [{ role: 'user', parts }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              detectedAccountName: {
                type: Type.STRING,
                description: 'Detected bank or credit card account name, or empty string.'
              },
              statementPeriod: {
                type: Type.STRING,
                description: 'Detected statement period or month/year, or empty string.'
              },
              transactions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    amount: { type: Type.NUMBER },
                    type: { type: Type.STRING, enum: ['income', 'expense'] },
                    category: { type: Type.STRING },
                    date: { type: Type.STRING },
                    notes: { type: Type.STRING },
                    isLoanPayment: { type: Type.BOOLEAN }
                  },
                  required: ['title', 'amount', 'type', 'category', 'date', 'isLoanPayment']
                }
              }
            },
            required: ['transactions']
          }
        }
      });

      const rawJson = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawJson);
      const txs = Array.isArray(parsed.transactions) ? parsed.transactions : [];

      res.json({
        detectedAccountName: parsed.detectedAccountName || '',
        statementPeriod: parsed.statementPeriod || '',
        transactions: txs.map((t: any) => ({
          title: String(t.title || 'Transaction').slice(0, 180),
          amount: Math.abs(Number(t.amount) || 0),
          type: t.type === 'income' ? 'income' : 'expense',
          category: String(t.category || 'Other').slice(0, 45),
          date: /^\d{4}-\d{2}-\d{2}$/.test(String(t.date || '')) ? String(t.date) : new Date().toISOString().split('T')[0],
          notes: String(t.notes || '').slice(0, 400),
          isLoanPayment: Boolean(t.isLoanPayment)
        })).filter((t: any) => t.amount > 0)
      });
    } catch (err: any) {
      const status = getAiErrorStatus(err);
      res.status(status).json({ error: err?.message || 'Failed to parse statement file' });
    }
  });

  // AI Financial Insights Endpoint using Gemini API
  app.post('/api/ai/advice', async (req, res) => {
    try {
      const { prompt, financialContext } = req.body || {};
      const userName = financialContext?.user?.name || financialContext?.user?.displayName || 'User';
      const userQuestion = typeof prompt === 'string' && prompt.trim()
        ? prompt.trim()
        : 'Give me a comprehensive financial health review and 3 concrete recommendations based on my accounts, credit cards, budgets, and recent transactions.';

      const ai = getAiClient();

      const contextText = financialContext
        ? JSON.stringify(financialContext, null, 2)
        : 'No ledger snapshot was provided.';

      const systemInstruction = `You are a Principal Financial Advisor tailored specifically for personal multi-account wealth and debt management (Dominican Republic RD$ and US$ dual-currency accounts, credit card cutoff/due cycles, loans, and cashflow).
Tone: Direct, encouraging, highly analytical, human, and Apple-grade precision.
Rules:
1. ADDRESS THE USER PERSONALLY: Greet the user by their display name (e.g., "Hola ${userName}," or "Hello ${userName},").
2. ADAPT LANGUAGE AUTOMATICALLY: If the prompt is in Spanish or the financial context is in RD$/Spanish, respond in crisp, professional Dominican/Latin-American Spanish. If in English, respond in English.
3. GROUNDED IN ACTUAL DATA: Reference their EXACT numbers, account names, cards, limits, and categories from their snapshot. Never invent imaginary figures or placeholders. If the user has $0 or few transactions yet, warmly acknowledge their setup state and guide them on their first 3 personalized steps.
4. STRUCTURED SECTIONS:
   - 🎯 **Diagnóstico de Salud Financiera** (Cashflow, liquid cash vs debt exposure, savings rate)
   - 💳 **Estrategia de Tarjetas y Crédito** (Specific card names, utilization %, golden rule cutoff/due dates, cuotas/diferidos)
   - 📊 **Patrones de Gasto Clave** (Top spending categories, pending flotantes)
   - 🚀 **Plan de Acción (3 Pasos Concretos)** (Specific, prioritized, numbered action items for this month)
5. Keep the response crisp, highly readable with bullet points and bold amounts (max ~350-400 words).`;

      const userContentText = `Financial Snapshot for ${userName}:\n${contextText}\n\nUser Question / Request:\n${userQuestion}`;

      let adviceText = '';
      const primaryModel = 'gemini-4-hydrogen';
      const fallbackModel = 'gemini-3.1-flash-lite';

      try {
        const response = await ai.models.generateContent({
          model: primaryModel,
          contents: [{ role: 'user', parts: [{ text: userContentText }] }],
          config: { systemInstruction }
        });
        adviceText = (response.text ?? '').trim();
      } catch (primaryErr: any) {
        console.warn(`Primary model ${primaryModel} failed (${primaryErr?.message}), trying fallback model ${fallbackModel}...`);
        const fallbackResp = await ai.models.generateContent({
          model: fallbackModel,
          contents: [{ role: 'user', parts: [{ text: userContentText }] }],
          config: { systemInstruction }
        });
        adviceText = (fallbackResp.text ?? '').trim();
      }

      if (!adviceText) {
        return res.status(200).json({
          ok: false,
          error: 'The AI model returned an empty response. Please try again with a specific question.'
        });
      }

      res.json({ ok: true, advice: adviceText });
    } catch (err: any) {
      console.error('AI Advice Error:', err);
      // Send 200 with ok: false so Nginx proxy_intercept_errors on does not convert into warmup.html
      res.status(200).json({
        ok: false,
        error: err?.message || 'Unable to generate financial insights at this moment. Please try again.'
      });
    }
  });

  // Vite integration
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    });
  }

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

startServer();
