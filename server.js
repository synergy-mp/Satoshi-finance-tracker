// server.js
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const cors = require('cors');
const app = express();
const prisma = new PrismaClient();

app.use(express.json());
app.use(cors());

// --- 1. USER AUTHENTICATION [cite: 24] ---
// Simplified for speed. Use proper Auth middleware if you have time.
app.post('/register', async (req, res) => {
    try {
        const user = await prisma.user.create({
            data: { email: req.body.email, password: req.body.password, name: req.body.name }
        });
        res.json(user);
    } catch (e) { res.status(400).json({ error: "User already exists" }); }
});

app.post('/login', async (req, res) => {
    const user = await prisma.user.findUnique({ where: { email: req.body.email } });
    if (user && user.password === req.body.password) {
        res.json({ id: user.id, email: user.email }); // In real life, send a JWT here
    } else {
        res.status(401).json({ error: "Invalid credentials" });
    }
});

// --- 2. TRANSACTION MANAGEMENT [cite: 30] ---
// GET all transactions for a user
app.get('/transactions/:userId', async (req, res) => {
    const txns = await prisma.transaction.findMany({
        where: { userId: parseInt(req.params.userId) },
        orderBy: { date: 'desc' }
    });
    res.json(txns);
});

// ADD a transaction (Handles Income/Expense)
app.post('/transactions', async (req, res) => {
    const { amount, type, category, description, userId, date } = req.body;
    try {
        const txn = await prisma.transaction.create({
            data: {
                amount: amount, // Prisma handles Decimal automatically
                type,
                category,
                description,
                date: new Date(date),
                userId: parseInt(userId)
            }
        });
        res.json(txn);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE a transaction [cite: 30]
app.delete('/transactions/:id', async (req, res) => {
    await prisma.transaction.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ success: true });
});

// --- 3. DASHBOARD & REPORTING [cite: 35, 36] ---
// This endpoint does the heavy lifting for the "Dashboard"
app.get('/dashboard/:userId', async (req, res) => {
    const userId = parseInt(req.params.userId);

    // Aggregation: Sum of Income vs Expense
    const stats = await prisma.transaction.groupBy({
        by: ['type'],
        where: { userId: userId },
        _sum: { amount: true }
    });

    // Breakdown by Category (for charts)
    const categoryStats = await prisma.transaction.groupBy({
        by: ['category'],
        where: { userId: userId, type: 'EXPENSE' },
        _sum: { amount: true }
    });

    res.json({ totals: stats, categories: categoryStats });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
