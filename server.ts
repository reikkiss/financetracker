import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc, updateDoc, query, where, getDoc } from 'firebase/firestore';
import fs from 'fs';

// Load Firebase config
const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
let firebaseConfig: any = {};
if (fs.existsSync(configPath)) {
  firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId || 'seashore');

function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured.');
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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  // API Endpoints backed by Firebase Firestore (seashore)
  app.get('/api/users', async (req, res) => {
    try {
      const snap = await getDocs(collection(db, 'users'));
      const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      res.json(users);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/users', async (req, res) => {
    try {
      const { id, name, email, avatar, currency, monthlyBudget } = req.body;
      const newUser = {
        id,
        name,
        email: email || '',
        avatar: avatar || '💼',
        currency: currency || 'USD',
        monthlyBudget: monthlyBudget ? Number(monthlyBudget) : 3500
      };
      await setDoc(doc(db, 'users', id), newUser);
      res.json(newUser);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/data/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      
      const [txSnap, budgetSnap, goalSnap, invSnap] = await Promise.all([
        getDocs(query(collection(db, 'transactions'), where('userId', '==', userId))),
        getDocs(query(collection(db, 'budgets'), where('userId', '==', userId))),
        getDocs(query(collection(db, 'goals'), where('userId', '==', userId))),
        getDocs(query(collection(db, 'investments'), where('userId', '==', userId)))
      ]);

      res.json({
        transactions: txSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        budgets: budgetSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        goals: goalSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        investments: invSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Statement Parser Endpoint using Gemini API (supports PDF, images, CSV, TXT)
  app.post('/api/ai/parse-statement', async (req, res) => {
    try {
      const { fileDataBase64, mimeType, fileName, textContent, availableCategories, currency } = req.body;

      if (!fileDataBase64 && !textContent) {
        return res.status(400).json({ error: 'No statement file or text provided.' });
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
        contents: { parts },
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
      console.error('Statement Parse Error:', err);
      res.status(500).json({ error: err.message || 'Failed to parse statement file' });
    }
  });

  // AI Financial Advisor Endpoint using Gemini API
  app.post('/api/ai/advice', async (req, res) => {
    try {
      const { userId, prompt } = req.body;
      const userDoc = await getDoc(doc(db, 'users', userId));
      const user = userDoc.exists() ? userDoc.data() : null;

      const [txSnap, budgetSnap, goalSnap] = await Promise.all([
        getDocs(query(collection(db, 'transactions'), where('userId', '==', userId))),
        getDocs(query(collection(db, 'budgets'), where('userId', '==', userId))),
        getDocs(query(collection(db, 'goals'), where('userId', '==', userId)))
      ]);

      const userTransactions = txSnap.docs.map(d => d.data());
      const userBudgets = budgetSnap.docs.map(d => d.data());
      const userGoals = goalSnap.docs.map(d => d.data());

      const ai = getAiClient();
      
      const financialContext = `
      User Profile: ${user?.name || 'User'}
      Monthly Budget Target: ${user?.monthlyBudget || 3500} ${user?.currency || 'USD'}
      Transactions Summary: ${JSON.stringify(userTransactions.slice(0, 20))}
      Budgets: ${JSON.stringify(userBudgets)}
      Goals: ${JSON.stringify(userGoals)}
      `;

      const systemInstruction = `You are a smart, empathetic, and professional personal finance advisor connected to Firebase DB 'seashore'. 
      Analyze the user's financial data and provide clear, actionable insights, budget recommendations, savings strategies, and spending analysis in clean Markdown. Be encouraging and precise.`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          { role: 'user', parts: [{ text: `${financialContext}\n\nUser Question/Request: ${prompt || 'Give me a comprehensive monthly financial health review and 3 tips to optimize my savings.'}` }] }
        ],
        config: {
          systemInstruction,
        }
      });

      res.json({ advice: response.text });
    } catch (err: any) {
      console.error('AI Advice Error:', err);
      res.status(500).json({ error: err.message || 'Failed to generate AI advice' });
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
    app.get('*', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    });
  }

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port} connected to Firebase DB 'seashore' (no seed data)`);
  });
}

startServer();
