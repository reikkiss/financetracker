import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc, updateDoc, query, where, getDoc } from 'firebase/firestore';
import fs from 'fs';
import { ImapFlow } from 'imapflow';
import { parseBankEmailAlert } from './src/utils/bankEmailParser';

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
  app.use('/api', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

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
      const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? 400 : 500;
      res.status(status).json({ error: err?.message || 'Failed to parse statement file' });
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

  // Test iCloud IMAP Connection
  app.post('/api/email/test-icloud', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'iCloud email and App-Specific Password are required.' });
      }

      const client = new ImapFlow({
        host: 'imap.mail.me.com',
        port: 993,
        secure: true,
        auth: {
          user: email.trim(),
          pass: password.trim()
        },
        logger: false
      });

      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      const status = await client.status('INBOX', { messages: true });
      lock.release();
      await client.logout();

      res.json({
        success: true,
        message: 'Successfully connected to iCloud IMAP mailbox.',
        totalInboxMessages: typeof status === 'object' && status ? (status.messages || 0) : 0
      });
    } catch (err: any) {
      console.error('iCloud test error:', err);
      res.status(400).json({
        error: err.message || 'Could not connect to iCloud IMAP. Verify your Apple ID and App-Specific Password (generate at appleid.apple.com).'
      });
    }
  });

  // Real iCloud IMAP Bank Alert Sync
  app.post('/api/email/sync-icloud', async (req, res) => {
    try {
      const { email, password, limit = 40 } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'iCloud email and App-Specific Password are required.' });
      }

      const client = new ImapFlow({
        host: 'imap.mail.me.com',
        port: 993,
        secure: true,
        auth: {
          user: email.trim(),
          pass: password.trim()
        },
        logger: false
      });

      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      const alerts: any[] = [];
      let totalScanned = 0;

      try {
        const status = await client.status('INBOX', { messages: true });
        const total = typeof status === 'object' && status ? (status.messages || 0) : 0;
        if (total > 0) {
          const fetchLimit = Math.min(Math.max(1, Number(limit) || 40), total);
          const startSeq = Math.max(1, total - fetchLimit + 1);
          const seqRange = `${startSeq}:${total}`;

          for await (const msg of client.fetch(seqRange, { envelope: true, source: true })) {
            totalScanned++;
            const subject = msg.envelope?.subject || '';
            const from = msg.envelope?.from?.[0]?.address || msg.envelope?.from?.[0]?.name || '';
            const rawEnvDate = msg.envelope?.date;
            const date =
              rawEnvDate instanceof Date
                ? rawEnvDate.toISOString()
                : typeof rawEnvDate === 'string'
                ? rawEnvDate
                : '';
            const text = msg.source ? msg.source.toString('utf8') : '';

            const parsed = parseBankEmailAlert(text, subject, from, date);
            if (parsed) {
              alerts.push({
                ...parsed,
                emailId: String(msg.uid || msg.seq),
                emailSubject: subject,
                emailFrom: from,
                emailDate: date
              });
            }
          }
        }
      } finally {
        lock.release();
      }

      await client.logout();

      res.json({
        success: true,
        provider: 'icloud',
        totalScanned,
        alertsFound: alerts.length,
        alerts: alerts.reverse()
      });
    } catch (err: any) {
      console.error('iCloud sync error:', err);
      res.status(500).json({
        error: err.message || 'Failed to sync from iCloud IMAP. Please ensure you generated an App-Specific Password at appleid.apple.com.'
      });
    }
  });

  // Real Gmail API Bank Alert Sync
  app.post('/api/email/sync-gmail', async (req, res) => {
    try {
      const { accessToken, maxResults = 30 } = req.body;
      if (!accessToken) {
        return res.status(401).json({ error: 'Google OAuth access token is required.' });
      }

      const query = encodeURIComponent(
        'from:(banreservas.com OR bpd.com.do OR bhd.com.do OR qik.do OR popular OR reservas OR bhd OR qik) OR subject:(consumo OR transaccion OR alerta OR "pago realizado" OR abono)'
      );
      const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=${maxResults}`;
      const listRes = await fetch(listUrl, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!listRes.ok) {
        const errText = await listRes.text();
        return res.status(listRes.status).json({ error: `Gmail API query error: ${errText}` });
      }

      const listData = await listRes.json();
      const messageRefs = listData.messages || [];
      const alerts: any[] = [];

      for (const ref of messageRefs) {
        const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}?format=full`;
        const msgRes = await fetch(msgUrl, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!msgRes.ok) continue;

        const msgData = await msgRes.json();
        const headers = msgData.payload?.headers || [];
        const subject = headers.find((h: any) => h.name?.toLowerCase() === 'subject')?.value || '';
        const from = headers.find((h: any) => h.name?.toLowerCase() === 'from')?.value || '';
        const dateHeader = headers.find((h: any) => h.name?.toLowerCase() === 'date')?.value || '';

        // Extract body text recursively
        let bodyText = msgData.snippet || '';
        function extractParts(part: any) {
          if (!part) return;
          if (part.body?.data) {
            try {
              const decoded = Buffer.from(part.body.data, 'base64url').toString('utf8');
              bodyText += '\n' + decoded;
            } catch {}
          }
          if (part.parts && Array.isArray(part.parts)) {
            part.parts.forEach(extractParts);
          }
        }
        extractParts(msgData.payload);

        const parsed = parseBankEmailAlert(bodyText, subject, from, dateHeader);
        if (parsed) {
          alerts.push({
            ...parsed,
            emailId: ref.id,
            emailSubject: subject,
            emailFrom: from,
            emailDate: dateHeader
          });
        }
      }

      res.json({
        success: true,
        provider: 'gmail',
        totalScanned: messageRefs.length,
        alertsFound: alerts.length,
        alerts
      });
    } catch (err: any) {
      console.error('Gmail sync error:', err);
      res.status(500).json({ error: err.message || 'Failed to sync Gmail alerts.' });
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
