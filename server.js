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
const axios = require("axios"); 

const app = express();
const PORT = process.env.PORT || 3000;
const prisma = new PrismaClient();

// Force IPv4 for Render (Crucial for email & outgoing API requests)
const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

app.use(cors());
app.use(express.json());

// --- ROBUST BITCOIN PRICE LOGIC (WATERFALL STRATEGY) ---
let EXCHANGE_RATES = { USD: 1.0, INR: 83.0, EUR: 0.92, SATS: 0.0000002 };
let CURRENT_BTC_PRICE = 0; 

async function getPriceFromBinance() {
  try {
    const res = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', { timeout: 3000 });
    return parseFloat(res.data.price);
  } catch (e) { return null; }
}

async function getPriceFromCoinbase() {
  try {
    const res = await axios.get('https://api.coinbase.com/v2/prices/spot?currency=USD', { timeout: 3000 });
    return parseFloat(res.data.data.amount);
  } catch (e) { return null; }
}

async function getPriceFromBlockchainInfo() {
  try {
    const res = await axios.get('https://blockchain.info/ticker', { timeout: 3000 });
    return res.data.USD.last;
  } catch (e) { return null; }
}

async function updateExchangeRates() {
  console.log("⏳ Fetching live Bitcoin price...");
  let price = await getPriceFromBinance();
  if (!price) { console.warn("⚠️ Binance failed, trying Coinbase..."); price = await getPriceFromCoinbase(); }
  if (!price) { console.warn("⚠️ Coinbase failed, trying Blockchain.info..."); price = await getPriceFromBlockchainInfo(); }

  if (price) {
    CURRENT_BTC_PRICE = price;
    EXCHANGE_RATES.SATS = price / 100000000; 
    EXCHANGE_RATES.INR = 83.0; 
    EXCHANGE_RATES.EUR = 0.92;
    console.log(`✅ Bitcoin Price Updated: $${CURRENT_BTC_PRICE.toLocaleString()}`);
  } else { console.error("❌ ALL Price APIs failed. Retrying in 1 minute."); }
}

updateExchangeRates();
setInterval(updateExchangeRates, 60000); 

function convertCurrency(amount, fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return amount;
  const satsRate = EXCHANGE_RATES.SATS || 0.0000002;
  let amountInUSD;
  if (fromCurrency === "SATS") amountInUSD = amount * satsRate;
  else {
    if(fromCurrency === "INR") amountInUSD = amount / 83.0; 
    else if(fromCurrency === "EUR") amountInUSD = amount / 0.92;
    else amountInUSD = amount; 
  }
  if (toCurrency === "SATS") return amountInUSD / satsRate;
  if (toCurrency === "INR") return amountInUSD * 83.0;
  if (toCurrency === "EUR") return amountInUSD * 0.92;
  return amountInUSD;
}

// --- SERVE FRONTEND & UPLOADS ---
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use("/uploads", express.static(uploadDir));
const upload = multer({ dest: "uploads/" });

// --- SESSION & PASSPORT ---
app.use(session({
  secret: process.env.SESSION_SECRET || "secret",
  resave: false, saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback",
    proxy: true
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      let user = await prisma.user.findUnique({ where: { email: profile.emails[0].value } });
      if (!user) user = await prisma.user.create({ data: { email: profile.emails[0].value, name: profile.displayName, password: "oauth" } });
      return done(null, user);
    } catch (err) { return done(err, null); }
  }
));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const user = await prisma.user.findUnique({ where: { id } });
  done(null, user);
});

// --- EMAIL ALERTS ---
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com", port: 465, secure: true,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// --- NATIVE AUTHENTICATION ROUTES (NEW) ---
app.post("/register", async (req, res) => {
  const { email, password, name } = req.body;
  try {
    const user = await prisma.user.create({ data: { email, password, name: name || "Satoshi User" } });
    res.json({ id: user.id, email: user.email });
  } catch (e) { res.status(500).json({ error: "Email already exists or server error." }); }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.password === password) res.json({ id: user.id, email: user.email });
    else res.status(401).json({ error: "Invalid email or password" });
  } catch (e) { res.status(500).json({ error: "Server error" }); }
});

// --- PUBLIC TICKER & BITCOIN ENDPOINTS ---
app.get("/api/ticker", (req, res) => res.json({ price: CURRENT_BTC_PRICE }));

app.get("/api/bitcoin-balance/:address", async (req, res) => {
  try {
    const response = await axios.get(`https://mempool.space/api/address/${req.params.address}`);
    const chainStats = response.data.chain_stats;
    const mempoolStats = response.data.mempool_stats;
    const satBalance = (chainStats.funded_txo_sum - chainStats.spent_txo_sum) + (mempoolStats.funded_txo_sum - mempoolStats.spent_txo_sum);
    const satsRate = EXCHANGE_RATES.SATS || 0.0000002;
    res.json({ sats: satBalance, usd_value: satBalance * satsRate });
  } catch (error) { res.status(500).json({ error: "Invalid Address" }); }
});

// --- GOOGLE OAUTH ROUTES ---
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => res.redirect(`/?userId=${req.user.id}`));

// --- TRANSACTION ROUTES ---
app.get("/transactions/:userId", async (req, res) => {
  try {
    const txns = await prisma.transaction.findMany({ where: { userId: Number(req.params.userId) }, include: { category: true } });
    res.json(txns);
  } catch (e) { res.status(500).json({ error: "Failed" }); }
});

app.post("/transactions", upload.single("receipt"), async (req, res) => {
  const { amount, type, category, description, userId, currency } = req.body;
  const uId = Number(userId);
  try {
    let catRecord = await prisma.category.findFirst({ where: { name: category || "General", userId: uId } });
    if (!catRecord) catRecord = await prisma.category.create({ data: { name: category || "General", type, userId: uId } });

    const txn = await prisma.transaction.create({
      data: {
        amount: parseFloat(amount), type, description, currency: currency || "USD",
        receiptUrl: req.file ? `/uploads/${req.file.filename}` : null,
        userId: uId, categoryId: catRecord.id, date: new Date()
      }
    });

    if (type === "EXPENSE") {
        const budget = await prisma.budget.findFirst({ where: { userId: uId, categoryId: catRecord.id }, include: { user: true } });
        if (budget) {
            const spentUSD = convertCurrency(parseFloat(amount), currency, "USD");
            const limitUSD = convertCurrency(parseFloat(budget.limit), "USD", "USD");
            if (spentUSD > limitUSD) {
                await transporter.sendMail({
                    from: process.env.EMAIL_USER, to: budget.user.email,
                    subject: "⚠️ Bitcoin Budget Alert",
                    text: `You exceeded your budget limits!`
                });
            }
        }
    }
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
    res.json({ income, expense, currency: displayCurrency, btc_price: CURRENT_BTC_PRICE });
  } catch (e) { res.status(500).json({ error: "Error" }); }
});

// --- BUDGET ROUTES ---
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

app.listen(PORT, () => console.log(`🚀 Satoshi Tracker running on port ${PORT}`));