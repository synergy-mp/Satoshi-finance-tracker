require("dotenv").config();
const express = require("express");
const { PrismaClient } = require("@prisma/client");
const cors = require("cors");
const multer = require("multer"); 
const path = require("path");
const fs = require("fs"); 
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// --- MOCK EXCHANGE RATES (Base: USD) ---
// In a production app, you would fetch these from a live API.
const EXCHANGE_RATES = {
  USD: 1.0,
  INR: 83.0,
  EUR: 0.92
};

// Helper function to convert currencies
function convertCurrency(amount, fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return amount;
  const amountInUSD = amount / (EXCHANGE_RATES[fromCurrency] || 1);
  return amountInUSD * (EXCHANGE_RATES[toCurrency] || 1);
}

// --- SERVE FRONTEND ---
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// --- FOLDER & MULTER SETUP ---
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use("/uploads", express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

// --- SESSION & PASSPORT SETUP ---
app.use(session({
  secret: process.env.SESSION_SECRET || "fallback_secret",
  resave: false, saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await prisma.user.findUnique({ where: { email: profile.emails[0].value } });
      if (!user) {
        user = await prisma.user.create({
          data: { email: profile.emails[0].value, name: profile.displayName, password: "oauth_user" }
        });
      }
      return done(null, user);
    } catch (err) { return done(err, null); }
  }
));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const user = await prisma.user.findUnique({ where: { id } });
  done(null, user);
});

// --- EMAIL TRANSPORTER ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

async function checkBudgetAndNotify(userId, categoryId, transactionCurrency) {
  try {
    const budget = await prisma.budget.findFirst({
      where: { userId, categoryId }, include: { category: true, user: true }
    });
    if (!budget) return; 

    const txns = await prisma.transaction.findMany({
      where: { userId, categoryId, type: "EXPENSE" }
    });

    // Convert all past expenses into USD (assuming budget limit is stored as a standard base)
    // For simplicity, we compare everything in USD under the hood for alerts
    let totalSpentUSD = 0;
    txns.forEach(t => {
      totalSpentUSD += convertCurrency(parseFloat(t.amount), t.currency, "USD");
    });

    const limitUSD = parseFloat(budget.limit);

    if (totalSpentUSD > limitUSD) {
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: budget.user.email,
        subject: "⚠️ Budget Overrun Alert - Finance Tracker",
        text: `Hello ${budget.user.name || 'User'},\n\nYou have exceeded your budget goal for "${budget.category.name}".\n\nPlease review your recent transactions.\n\nBest,\nFinance Tracker Team`
      };
      await transporter.sendMail(mailOptions);
    }
  } catch (error) { console.error("❌ Notification failed:", error); }
}

// ==========================================
// 1. AUTH & TRANSACTIONS
// ==========================================

app.post("/register", async (req, res) => { /* ... (Same as before) ... */ 
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  try {
    const user = await prisma.user.create({ data: { email, password, name } });
    res.json(user);
  } catch (e) { res.status(500).json({ error: "Registration failed" }); }
});

app.post("/login", async (req, res) => { /* ... (Same as before) ... */ 
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.password === password) res.json({ id: user.id, email: user.email, name: user.name });
    else res.status(401).json({ error: "Invalid credentials" });
  } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login-failed' }), (req, res) => {
    res.redirect(`/?userId=${req.user.id}`);
});

app.get("/transactions/:userId", async (req, res) => {
  const userId = Number(req.params.userId);
  try {
    const txns = await prisma.transaction.findMany({ where: { userId }, include: { category: true }, orderBy: { date: "desc" } });
    res.json(txns);
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

app.post("/transactions", upload.single("receipt"), async (req, res) => {
  const { amount, type, category, description, userId, date, currency } = req.body;
  const uId = Number(userId);

  try {
    const categoryName = category || "Uncategorized";
    let catRecord = await prisma.category.findFirst({ where: { name: categoryName, userId: uId } });
    if (!catRecord) catRecord = await prisma.category.create({ data: { name: categoryName, type, userId: uId } });

    const receiptUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const txn = await prisma.transaction.create({
      data: {
        amount: parseFloat(amount), type, description, currency: currency || "USD", 
        receiptUrl, date: date ? new Date(date) : new Date(), userId: uId, categoryId: catRecord.id
      },
      include: { category: true }
    });

    if (type === "EXPENSE") checkBudgetAndNotify(uId, catRecord.id, txn.currency); 
    res.json(txn);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/transactions/:id", async (req, res) => {
  try { await prisma.transaction.delete({ where: { id: Number(req.params.id) } }); res.json({ message: "Deleted" }); } 
  catch (e) { res.status(500).json({ error: "Failed" }); }
});

// ==========================================
// 3. MULTI-CURRENCY DASHBOARD & REPORTING
// ==========================================

app.get("/dashboard/:userId", async (req, res) => {
  const userId = Number(req.params.userId);
  const displayCurrency = req.query.currency || "USD"; // Grab preferred currency

  try {
    const txns = await prisma.transaction.findMany({ where: { userId } });
    let income = 0, expense = 0;

    txns.forEach(t => {
      // Convert every transaction to the requested display currency before summing
      const convertedAmt = convertCurrency(parseFloat(t.amount), t.currency, displayCurrency);
      if (t.type === "INCOME") income += convertedAmt;
      else expense += convertedAmt;
    });

    res.json({ income, expense, currency: displayCurrency });
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

app.get("/reports/:userId", async (req, res) => {
  const userId = Number(req.params.userId);
  const displayCurrency = req.query.currency || "USD"; 

  try {
    const transactions = await prisma.transaction.findMany({ where: { userId } });
    
    const monthlyReport = transactions.reduce((acc, txn) => {
      const monthYear = txn.date.toISOString().slice(0, 7); 
      if (!acc[monthYear]) acc[monthYear] = { income: 0, expense: 0 };
      
      const convertedAmt = convertCurrency(parseFloat(txn.amount), txn.currency, displayCurrency);

      if (txn.type === "INCOME") acc[monthYear].income += convertedAmt;
      else acc[monthYear].expense += convertedAmt;
      return acc;
    }, {});

    res.json(monthlyReport);
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

// ==========================================
// 4. MULTI-CURRENCY BUDGETING
// ==========================================

app.post("/budgets", async (req, res) => {
  const { userId, category, limit } = req.body;
  const uId = Number(userId);

  try {
    const categoryName = category || "Uncategorized";
    let catRecord = await prisma.category.findFirst({ where: { name: categoryName, userId: uId } });
    if (!catRecord) catRecord = await prisma.category.create({ data: { name: categoryName, type: "EXPENSE", userId: uId } });

    let budget = await prisma.budget.findFirst({ where: { userId: uId, categoryId: catRecord.id } });
    if (budget) budget = await prisma.budget.update({ where: { id: budget.id }, data: { limit: parseFloat(limit) } });
    else budget = await prisma.budget.create({ data: { userId: uId, categoryId: catRecord.id, limit: parseFloat(limit) } });

    res.json(budget);
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

app.get("/budgets/:userId/progress", async (req, res) => {
  const userId = Number(req.params.userId);
  const displayCurrency = req.query.currency || "USD"; 

  try {
    const budgets = await prisma.budget.findMany({ where: { userId }, include: { category: true } });
    
    const progress = await Promise.all(budgets.map(async (budget) => {
      const txns = await prisma.transaction.findMany({
        where: { userId, categoryId: budget.categoryId, type: "EXPENSE" }
      });

      // Convert spent amounts into the display currency
      let spentConverted = 0;
      txns.forEach(t => {
        spentConverted += convertCurrency(parseFloat(t.amount), t.currency, displayCurrency);
      });

      // Assume the budget limit was set in USD, convert to display currency
      const limitConverted = convertCurrency(parseFloat(budget.limit), "USD", displayCurrency);

      return {
        category: budget.category.name,
        limit: limitConverted,
        spent: spentConverted,
        remaining: limitConverted - spentConverted,
      };
    }));
    res.json(progress);
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

app.listen(PORT, async () => {
  try {
    await prisma.$connect();
    console.log(`✅ Server running on http://localhost:${PORT}`);
  } catch (err) { process.exit(1); }
});