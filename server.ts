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
  if (status >= 400 && status < 600) return status;
  const msg = String(err?.message || '').toUpperCase();
  if (msg.includes('API_KEY_INVALID') || msg.includes('INVALID_ARGUMENT')) return 400;
  if (msg.includes('PERMISSION_DENIED')) return 403;
  if (msg.includes('NOT_FOUND')) return 404;
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) return 429;
  return 500;
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
      const userQuestion = typeof prompt === 'string' && prompt.trim()
        ? prompt.trim()
        : 'Give me a comprehensive financial health review and 3 concrete recommendations based on my accounts, credit cards, budgets, and recent transactions.';

      const ai = getAiClient();

      const contextText = financialContext
        ? JSON.stringify(financialContext, null, 2)
        : 'No ledger snapshot was provided.';

      const systemInstruction = `You are a sharp, supportive, and practical personal finance advisor for the user's private multi-account ledger (bank accounts, debit cards, credit cards with cutoff/due cycles, loans, budgets, and transactions).
Instructions:
- Analyze ONLY the real numbers provided in the user's financial snapshot (never invent balances or transactions).
- Reply in the same language as the user's question (Spanish if asked in Spanish, English if asked in English).
- Highlight concrete cashflow, credit card utilization / cutoff timing, top spending categories, and 3 actionable next steps.
- Keep the response concise, well-structured with clear headings and bullet points (max ~350 words).`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `User Financial Snapshot:\n${contextText}\n\nUser Question / Request:\n${userQuestion}`
              }
            ]
          }
        ],
        config: {
          systemInstruction,
        }
      });

      const adviceText = (response.text ?? '').trim();
      if (!adviceText) {
        return res.status(502).json({ error: 'The AI model returned an empty response. Please try again.' });
      }

      res.json({ advice: adviceText });
    } catch (err: any) {
      console.error('AI Advice Error:', err);
      const status = getAiErrorStatus(err);
      res.status(status).json({ error: err?.message || 'Failed to generate AI advice' });
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
