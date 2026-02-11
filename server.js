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
const EXCHANGE_RATES = { USD: 1.0, INR: 83.0, EUR: 0.92 };

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
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback",
    proxy: true // CRITICAL: Trusts Render's HTTPS proxy for OAuth
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

async function checkBudgetAndNotify(userId, categoryId) {
  try {
    const budget = await prisma.budget.findFirst({
      where: { userId, categoryId },
      include: { category: true, user: true }
    });
    if (!budget) return;

    const txns = await prisma.transaction.findMany({
      where: { userId, categoryId, type: "EXPENSE" }
    });

    let totalSpentUSD = 0;
    txns.forEach(t => {
      totalSpentUSD += convertCurrency(parseFloat(t.amount), t.currency, "USD");
    });

    if (totalSpentUSD > parseFloat(budget.limit)) {
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: budget.user.email,
        subject: "⚠️ Budget Overrun Alert",
        text: `Hello ${budget.user.name},\n\nYou exceeded your budget for "${budget.category.name}".`
      };
      await transporter.sendMail(mailOptions);
    }
  } catch (error) { console.error("Email failed", error); }
}

// --- ROUTES ---
app.post("/register", async (req, res) => {
  const { email, password, name } = req.body;
  try {
    const user = await prisma.user.create({ data: { email, password, name } });
    res.json(user);
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.password === password) res.json(user);
    else res.status(401).json({ error: "Invalid" });
  } catch (e) { res.status(500).json({ error: "Error" }); }
});

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/login-failed' }),
  (req, res) => { res.redirect(`/?userId=${req.user.id}`); }
);

app.get("/transactions/:userId", async (req, res) => {
  try {
    const txns = await prisma.transaction.findMany({
      where: { userId: Number(req.params.userId) },
      include: { category: true },
      orderBy: { date: "desc" }
    });
    res.json(txns);
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

app.post("/transactions", upload.single("receipt"), async (req, res) => {
  const { amount, type, category, description, userId, currency } = req.body;
  const uId = Number(userId);
  try {
    let catRecord = await prisma.category.findFirst({ where: { name: category || "Other", userId: uId } });
    if (!catRecord) catRecord = await prisma.category.create({ data: { name: category || "Other", type, userId: uId } });

    const txn = await prisma.transaction.create({
      data: {
        amount: parseFloat(amount), type, description, currency: currency || "USD",
        receiptUrl: req.file ? `/uploads/${req.file.filename}` : null,
        userId: uId, categoryId: catRecord.id, date: new Date()
      }
    });
    if (type === "EXPENSE") checkBudgetAndNotify(uId, catRecord.id);
    res.json(txn);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/dashboard/:userId", async (req, res) => {
  const displayCurrency = req.query.currency || "USD";
  try {
    const txns = await prisma.transaction.findMany({ where: { userId: Number(req.params.userId) } });
    let income = 0, expense = 0;
    txns.forEach(t => {
      const amt = convertCurrency(parseFloat(t.amount), t.currency, displayCurrency);
      if (t.type === "INCOME") income += amt; else expense += amt;
    });
    res.json({ income, expense, currency: displayCurrency });
  } catch (e) { res.status(500).json({ error: "Error" }); }
});

app.post("/budgets", async (req, res) => {
  const { userId, category, limit } = req.body;
  try {
    let cat = await prisma.category.findFirst({ where: { name: category, userId: Number(userId) } });
    if (!cat) cat = await prisma.category.create({ data: { name: category, type: "EXPENSE", userId: Number(userId) } });
    const budget = await prisma.budget.upsert({
      where: { id: (await prisma.budget.findFirst({ where: { userId: Number(userId), categoryId: cat.id } }))?.id || -1 },
      update: { limit: parseFloat(limit) },
      create: { userId: Number(userId), categoryId: cat.id, limit: parseFloat(limit) }
    });
    res.json(budget);
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

app.get("/budgets/:userId/progress", async (req, res) => {
  const displayCurrency = req.query.currency || "USD";
  try {
    const budgets = await prisma.budget.findMany({ where: { userId: Number(req.params.userId) }, include: { category: true } });
    const progress = await Promise.all(budgets.map(async (b) => {
      const txns = await prisma.transaction.findMany({ where: { userId: b.userId, categoryId: b.categoryId, type: "EXPENSE" } });
      let spent = 0;
      txns.forEach(t => { spent += convertCurrency(parseFloat(t.amount), t.currency, displayCurrency); });
      return { category: b.category.name, limit: convertCurrency(parseFloat(b.limit), "USD", displayCurrency), spent };
    }));
    res.json(progress);
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));