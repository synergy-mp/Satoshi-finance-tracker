⚡ SatoshiTrack: Bitcoin Portfolio & Budget Manager
A full-stack financial tool built for the Bitcoin Standard.

SatoshiTrack is a Bitcoin-native portfolio manager that empowers users to track their net worth in Satoshis (Sats), audit real-time on-chain balances, and manage budgets using live market data. Unlike generic finance trackers, this application treats Bitcoin as the primary unit of account while providing seamless conversion from fiat currencies.

🚀 Live Demo
https://fj-be-r2-mayank-nitdelhi.onrender.com
Note: This demo is hosted on a free Render instance. Please allow up to 60 seconds for the initial load as the server spins up.

₿ Summer of Bitcoin Features

Developed specifically to demonstrate competency with Bitcoin data structures and blockchain APIs.
⚡ Live Satoshi (Sats) Conversion: The application uses a robust "Waterfall" strategy—fetching real-time Bitcoin prices from Binance, Coinbase, and Blockchain.com—to ensure accuracy even if one API is throttled.
⛓️ On-Chain Audit (Watch-Only Wallet): Users can paste any public Bitcoin address (e.g., bc1q...). The app queries the Mempool.space API to fetch confirmed on-chain balances, allowing users to track their "cold storage" as part of their total portfolio.
📉 Sats-Denominated Budgeting: Users can set budget goals in fiat, but the tracking and progress visualizations are dynamically calculated in Satoshis based on current market volatility.
✨ Core Functionalities
🔐 Secure OAuth 2.0: Integrated Google Sign-In via Passport.js, utilizing production proxies for secure deployment on Render.
📧 Automated Alerts: Real-time email notifications via Nodemailer when spending exceeds the defined Satoshi budget.
📊 Interactive Dashboards: Dynamic doughnut and bar charts using Chart.js to visualize financial health.
🧾 Receipt Management: Ability to upload and store proof-of-payment images using Multer.
🌎 Multi-Currency Support: Support for USD ($), INR (₹), EUR (€), and ⚡ SATS.

🛠️ Tech Stack
Backend: Node.js, Express.js
ORM: Prisma
Database: PostgreSQL (Hosted on Neon)
APIs: Binance, Coinbase, Blockchain.com (Price Data), Mempool.space (Blockchain Data)
Deployment: Render

⚙️ Local Setup & Installation
1. Clone & Install
Bash
git clone https://github.com/your-username/your-repo-name.git
cd your-repo-name
npm install
2. Configure Environment
Create a .env file in the root directory:

Code snippet
DATABASE_URL="your_postgresql_url"
GOOGLE_CLIENT_ID="your_id"
GOOGLE_CLIENT_SECRET="your_secret"
SESSION_SECRET="your_random_string"
EMAIL_USER="your_gmail@gmail.com"
EMAIL_PASS="your_16_char_app_password"
3. Initialize Database
Bash
npx prisma db push
npx prisma generate
4. Run App
Bash
node server.js

👨‍💻 Author
Mayank Prakash
College: National Institute of Technology Delhi
Interests: Web3, Bitcoin Core, and Open Source Development
GitHub: https://github.com/synergy-mp
Linkein: https://www.linkedin.com/in/mayank-prakash-1a2737323/

Submission Note for SoB Reviewers
This project was evolved from a standard finance tracker to a Bitcoin-centric application to demonstrate the ability to handle cryptographic address types, interact with RESTful blockchain APIs, and implement robust error-handling/fallbacks for live market data.