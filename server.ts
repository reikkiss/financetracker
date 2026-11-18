import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
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

async function startServer() {
  const app = express();
  app.use(express.json());

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

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });
      }

      const ai = new GoogleGenAI({ apiKey });
      
      const financialContext = `
      User Profile: ${user?.name || 'User'}
      Monthly Budget Target: ${user?.monthlyBudget || 3500} ${user?.currency || 'USD'}
      Transactions Summary: ${JSON.stringify(userTransactions.slice(0, 20))}
      Budgets: ${JSON.stringify(userBudgets)}
      Goals: ${JSON.stringify(userGoals)}
      `;

      const systemInstruction = `You are NotionFin AI, a smart, empathetic, and professional Notion-style personal finance advisor connected to Firebase DB 'seashore'. 
      Analyze the user's financial data and provide clear, actionable insights, budget recommendations, savings strategies, and spending analysis in clean Markdown. Be encouraging and precise.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          { role: 'user', parts: [{ text: `${financialContext}\n\nUser Question/Request: ${prompt || 'Give me a comprehensive monthly financial health review and 3 tips to optimize my savings.'}` }] }
        ],
        config: {
          systemInstruction,
          temperature: 0.7,
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
