# ⚡ Settle Agent — Reviewer & Testing Guide

Welcome to Settle Agent! This guide walks you through setting up and verifying Settle Agent's autonomous stock-monitoring, Telegram bot approvals, and instant cross-border Solana USDC settlements.

---

## 🚀 Deployed Quick-Start (No Local Setup Required)
You can test the fully operational production build directly in the cloud:
* **Web Dashboard:** [settle-ai-agent-production.up.railway.app](https://settle-ai-agent-production.up.railway.app)
* **Telegram Bot:** [t.me/settle_ai_agent_bot](https://t.me/settle_ai_agent_bot)

---

## 🛠️ Local Installation & Setup

If you prefer to run the project locally on your machine, follow these steps:

### 1. Install Dependencies
Make sure you have Node.js (v18+) installed. Clone the repository and install dependencies:
```bash
npm install
```

### 2. Configure Environment Variables
Copy the template `.env.example` file to `.env`:
```bash
cp .env.example .env
```
Open `.env` and fill out your configurations:
* **`PORT`**: Set to `3005` (or any available port).
* **`DATABASE_URL`**: (Optional) Link a PostgreSQL database. If left empty, Settle Agent **automatically falls back to zero-config local SQLite**.
* **`TELEGRAM_BOT_TOKEN` & `TELEGRAM_CHAT_ID`**: (Optional) Add your bot token and chat ID if you want real Telegram alerts. If left blank, you can use the **built-in Telegram Simulator** directly inside the Web Dashboard!

### 3. Run the Server
Launch the development server with auto-reload active:
```bash
npm run dev
```
Open **`http://localhost:3005`** in your browser to access the Settle Agent Portal.

---

## 🧪 Step-by-Step Testing Flow

Follow this checklist to evaluate all features:

### Step 1: Create a Merchant Account
1. Open the app (local or deployed).
2. Click **Get Started** on the landing page.
3. Fill out the registration form to create a new SME account.
4. **Under the hood:** The backend automatically generates a secure, dedicated Solana wallet public/private keypair for your account and links it.

### Step 2: Fund Your Account (Sandbox Controls)
1. Once logged in, look at the top section titled **Sandbox Controls**.
2. Click **Instantly Fund $10,000 USDC** to add sandbox test credits.
3. Click the **+1 SOL** button on the SOL currency card to request a devnet gas airdrop so your wallet has gas to sign transactions.

### Step 3: Trigger a Low-Stock Reorder Proposal
1. In the **Sandbox Controls** panel, click **Deplete Stock & Request**.
2. This simulates a customer purchase that depletes the stock of a product (e.g. *Samsung 25W Fast Charger*) below its minimum safety threshold.
3. The background AI agent scanner immediately detects the drop, locks a real-time USDC ➔ NGN FX conversion quote, drafts a restocking proposal, and dispatches a notification.

### Step 4: Review the Alert on Telegram
* **If Webhook is configured:** Open your Telegram chat with **`@settle_ai_agent_bot`**. You will receive a rich message outlining the SKU, reorder units, USD cost, FX rate, recipient bank, and instant payout options.
* **If running locally without Telegram:** Look at the right-hand panel on the Dashboard titled **Telegram Bot Simulator**. The alert card will appear there dynamically.

### Step 5: Execute Payout Approval
1. Click **`✅ Approve & Pay`** (either inside your Telegram app, or on the Web Dashboard).
2. **Under the hood:** Settle Agent signs and broadcasts a Solana Devnet transaction sending USDC from your merchant address to the supplier.
3. **On-chain Metadata:** The transaction includes an SPL Memo instruction containing structured transaction telemetry (order details, exchange rate, NGN corridor bank details).

### Step 6: Verify the Solana Blockchain Receipt
1. As soon as the transaction is finalized (~2 seconds), the bot will send a **payment receipt message**.
2. Click the **View on Solana Explorer** button in Telegram or the popup receipt on the dashboard.
3. On the Explorer, check:
   * The **Success** status of the transaction.
   * The **Memo** section to view the verified, immutable Settle Agent payload written directly onto the ledger.
