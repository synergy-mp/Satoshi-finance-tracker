💰 Personal Finance Tracker
A full-stack web application designed to help users track their income and expenses, set budget goals, and visualize their financial health. This project features secure authentication, multi-currency support, automated email alerts for budget overruns, and receipt image uploads.

🚀 Live Demo
https://fj-be-r2-mayank-nitdelhi.onrender.com

✨ Key Features
Secure Authentication: Local email/password login alongside Google OAuth 2.0 integration using Passport.js.

Transaction Management: Add, edit, and delete income and expenses. Categorize transactions for better tracking.

Multi-Currency Support: Seamlessly switch dashboard views between USD, INR, and EUR with real-time exchange rate conversions.

Smart Budgeting & Alerts: Set category-specific budget limits. The system automatically sends an email notification (via Nodemailer) the moment an expense pushes you over your budget.

Visual Analytics: Interactive bar and line charts built with Chart.js to visualize net savings and monthly spending trends.

Receipt Uploads: Attach images or PDF receipts to transactions using Multer.

Data Export: Download monthly financial reports as .csv files for external use.

🛠️ Tech Stack
Frontend:

HTML5, CSS3, Vanilla JavaScript

Chart.js (Data Visualization)

Backend:

Node.js & Express.js

Prisma ORM

Passport.js (Google OAuth)

Nodemailer (Email Alerts)

Multer (File Uploads)

Database & Deployment:

PostgreSQL (Hosted on Neon)

Render (Web Service Hosting)

⚙️ Local Installation & Setup
If you want to run this project locally on your machine, follow these steps:

1. Prerequisites

Node.js installed on your machine.

A PostgreSQL database (local or cloud-based like Neon).

A Google Cloud Console account (for OAuth credentials).

A Gmail account with an "App Password" generated (for Nodemailer).

2. Clone the Repository
git clone https://github.com/synergy-mp/FJ-BE-R2-Mayank-NITDelhi
cd FJ-BE-R2-Mayank-NITDelhi

3. Install Dependencies
npm install

4. Environment Variables

Create a .env file in the root directory and add the following keys:
# Database
DATABASE_URL="your_postgresql_connection_string"

# Google OAuth 2.0
GOOGLE_CLIENT_ID="857189309964-su3rc2r3t65tbtcd3gog9bnco65kf8n4.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="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"
SESSION_SECRET="fischer_jordan_finance_tracker_secret_2026"

# Nodemailer (Gmail)
EMAIL_USER="mayankprakas@gmail.com"
EMAIL_PASS=" dm me to get access"

5. Database Setup (Prisma)

Push the schema to your database and generate the Prisma client:
npx prisma db push
npx prisma generate

6. Start the Server
node server.js

📂 Folder Structure Highlights
server.js: The core Express backend, containing all API routes, OAuth logic, and Nodemailer configurations.

index.html: The single-page frontend application housing the UI, form logic, and Chart.js implementations.

prisma/schema.prisma: The database schema defining Users, Transactions, Categories, and Budgets.

uploads/: Auto-generated directory storing user-uploaded receipts.

👨‍💻 Author
Mayank

GitHub: https://github.com/synergy-mp

LinkedIn: https://www.linkedin.com/in/mayank-prakash-1a2737323/

