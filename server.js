require("dotenv").config();
const express = require("express");
const { PrismaClient } = require("@prisma/client");
const cors = require("cors");
const multer = require("multer"); 
const path = require("path");
const fs = require("fs"); 

// --- DAY 3 OAUTH IMPORTS ---
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

// --- DAY 3 NOTIFICATION IMPORTS ---
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

// --- FOLDER & MULTER SETUP (Receipt Uploads) ---
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
  console.log("📁 Auto-created 'uploads' directory for receipts.");
}
app.use("/uploads", express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

// --- SESSION & PASSPORT SETUP (Google OAuth) ---
app.use(session({
  secret: process.env.SESSION_SECRET || "fallback_secret",
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback",
    proxy: true // CRITICAL FOR RENDER DEPLOYMENT: Trusts HTTPS proxy
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await prisma.user.findUnique({ where: { email: profile.emails[0].value } });
      if (!user) {
        user = await prisma.user.create({
          data: {
            email: profile.emails[0].value,
            name: profile.displayName,
            password: "oauth_user"
          }
        });
      }
      return done(null, user);
    } catch (err) {
      return done(err, null);
    }
  }
));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const user = await prisma.user.findUnique({ where: { id } });
  done(null, user);
});

// --- EMAIL TRANSPORTER SETUP ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// --- BUDGET OVERRUN CHECKER (Helper Function) ---
async function checkBudgetAndNotify(userId, categoryId, transactionCurrency) {
  try {
    const budget = await prisma.budget.findFirst({
      where: { userId, categoryId },
      include: { category: true, user: true }
    });
    
    if (!budget) return; // No budget set for this category

    const txns = await prisma.transaction.findMany({
      where: { userId, categoryId, type: "EXPENSE" }
    });

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
        text: `Hello ${budget.user.name || 'User'},\n\nYou have exceeded your budget goal for the "${budget.category.name}" category.\n\nPlease review your recent transactions.\n\nBest,\nFinance Tracker Team`
      };

      await transporter.sendMail(mailOptions);
      console.log(`📧 ALERT: Overrun email sent to ${budget.user.email} for category ${budget.category.name}`);
    }
  } catch (error) {
    console.error("❌ Failed to check budget or send email:", error);
  }
}

console.log("🚀 Starting server...");

// ==========================================
// 1. AUTHENTICATION ROUTES
// ==========================================

app.post("/register", async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  try {
    const user = await prisma.user.create({ data: { email, password, name } });
    console.log(`✅ User registered: ${user.email}`);
    res.json(user);
  } catch (e) {
    if (e.code === "P2002") res.status(400).json({ error: "Email already exists" });
    else res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.password === password) {
      console.log(`✅ Login successful: ${email}`);
      res.json({ id: user.id, email: user.email, name: user.name });
    } else res.status(401).json({ error: "Invalid credentials" });
  } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/login-failed' }),
  (req, res) => {
    // Relative redirect path ensures it works securely on Render!
    res.redirect(`/?userId=${req.user.id}`);
  }
);

// ==========================================
// 2. TRANSACTION MANAGEMENT
// ==========================================

app.get("/transactions/:userId", async (req, res) => {
  const userId = Number(req.params.userId);
  if (isNaN(userId)) return res.status(400).json({ error: "Invalid User ID" });

  try {
    const txns = await prisma.transaction.findMany({
      where: { userId },
      include: { category: true },
      orderBy: { date: "desc" },
    });
    res.json(txns);
  } catch (e) { res.status(500).json({ error: "Failed to fetch transactions" }); }
});

app.post("/transactions", upload.single("receipt"), async (req, res) => {
  const { amount, type, category, description, userId, date, currency } = req.body;
  const uId = Number(userId);

  try {
    const categoryName = category || "Uncategorized";
    let catRecord = await prisma.category.findFirst({ where: { name: categoryName, userId: uId } });

    if (!catRecord) {
      catRecord = await prisma.category.create({ data: { name: categoryName, type, userId: uId } });
    }

    const receiptUrl = req.file ? `/uploads/${req.file.filename}` : null;

    const txn = await prisma.transaction.create({
      data: {
        amount: parseFloat(amount), 
        type,
        description,
        currency: currency || "USD", 
        receiptUrl: receiptUrl,      
        date: date ? new Date(date) : new Date(),
        userId: uId,
        categoryId: catRecord.id
      },
      include: { category: true }
    });

    // DAY 3 NOTIFICATION LOGIC
    if (type === "EXPENSE") {
      checkBudgetAndNotify(uId, catRecord.id, txn.currency); 
    }

    console.log("✅ Transaction Added:", txn.id);
    res.json(txn);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/transactions/:id", async (req, res) => {
  const { amount, type, description, categoryId, date, currency } = req.body;
  
  try {
    const updatedTxn = await prisma.transaction.update({
      where: { id: Number(req.params.id) },
      data: {
        amount: amount ? parseFloat(amount) : undefined,
        type,
        description,
        currency,
        categoryId: categoryId ? Number(categoryId) : undefined,
        date: date ? new Date(date) : undefined,
      },
    });
    res.json(updatedTxn);
  } catch (e) { res.status(500).json({ error: "Failed to update transaction" }); }
});

app.delete("/transactions/:id", async (req, res) => {
  try {
    await prisma.transaction.delete({ where: { id: Number(req.params.id) } });
    res.json({ message: "Transaction deleted" });
  } catch (e) { res.status(500).json({ error: "Failed to delete" }); }
});

// ==========================================
// 3. MULTI-CURRENCY DASHBOARD & REPORTING
// ==========================================

app.get("/dashboard/:userId", async (req, res) => {
  const userId = Number(req.params.userId);
  const displayCurrency = req.query.currency || "USD";

  if (isNaN(userId)) return res.status(400).json({ error: "Invalid User ID" });

  try {
    const txns = await prisma.transaction.findMany({ where: { userId } });
    let income = 0, expense = 0;

    txns.forEach(t => {
      const convertedAmt = convertCurrency(parseFloat(t.amount), t.currency, displayCurrency);
      if (t.type === "INCOME") income += convertedAmt;
      else expense += convertedAmt;
    });

    res.json({ income, expense, currency: displayCurrency });
  } catch (e) { res.status(500).json({ error: "Failed to fetch dashboard stats" }); }
});

app.get("/reports/:userId", async (req, res) => {
  const userId = Number(req.params.userId);
  const displayCurrency = req.query.currency || "USD"; 

  try {
    const transactions = await prisma.transaction.findMany({
      where: { userId }
    });

    const monthlyReport = transactions.reduce((acc, txn) => {
      const monthYear = txn.date.toISOString().slice(0, 7); 
      if (!acc[monthYear]) acc[monthYear] = { income: 0, expense: 0 };

      const convertedAmt = convertCurrency(parseFloat(txn.amount), txn.currency, displayCurrency);

      if (txn.type === "INCOME") acc[monthYear].income += convertedAmt;
      else acc[monthYear].expense += convertedAmt;
      return acc;
    }, {});

    res.json(monthlyReport);
  } catch (e) { res.status(500).json({ error: "Failed to generate report" }); }
});

// ==========================================
// 4. MULTI-CURRENCY BUDGETING
// ==========================================

app.post("/budgets", async (req, res) => {
  const { userId, category, limit } = req.body;
  const uId = Number(userId);

  try {
    const categoryName = category || "Uncategorized";
    let catRecord = await prisma.category.findFirst({ 
      where: { name: categoryName, userId: uId } 
    });

    if (!catRecord) {
      catRecord = await prisma.category.create({ 
        data: { name: categoryName, type: "EXPENSE", userId: uId } 
      });
    }

    let budget = await prisma.budget.findFirst({
      where: { userId: uId, categoryId: catRecord.id }
    });

    if (budget) {
      budget = await prisma.budget.update({
        where: { id: budget.id },
        data: { limit: parseFloat(limit) }
      });
    } else {
      budget = await prisma.budget.create({
        data: { userId: uId, categoryId: catRecord.id, limit: parseFloat(limit) },
      });
    }

    res.json(budget);
  } catch (e) { 
    console.error(e);
    res.status(500).json({ error: "Failed to set budget" }); 
  }
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

      let spentConverted = 0;
      txns.forEach(t => {
        spentConverted += convertCurrency(parseFloat(t.amount), t.currency, displayCurrency);
      });

      const limitConverted = convertCurrency(parseFloat(budget.limit), "USD", displayCurrency);

      return {
        category: budget.category.name,
        limit: limitConverted,
        spent: spentConverted,
        remaining: limitConverted - spentConverted,
      };
    }));
    res.json(progress);
  } catch (e) { res.status(500).json({ error: "Failed to fetch budget progress" }); }
});

// ==========================================
// SERVER START
// ==========================================
app.listen(PORT, async () => {
  try {
    await prisma.$connect();
    console.log("✅ Prisma connected to Neon PostgreSQL");
    console.log(`✅ Server running on http://localhost:${PORT}`);
  } catch (err) {
    console.error("❌ Database connection failed.");
    console.error(err);
    process.exit(1);
  }
});