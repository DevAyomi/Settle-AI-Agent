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
   * The **Token Balances** section: the supplier's USDC balance increases by the settled amount and the merchant's decreases by the same amount.
   * The **SPL Token `transferChecked`** instruction, which names the USDC mint and 6 decimals.
   * The **Memo** section to view the verified, immutable Settle Agent payload written directly onto the ledger.

---

## 💵 USDC Settlement — On-Chain Details

The supplier payout is a **real SPL token transfer**, not a SOL transfer or a simulation. Every settlement transaction contains exactly three instructions:

1. `createAssociatedTokenAccountIdempotent` — opens the supplier's USDC token account if it does not exist yet (merchant pays the rent).
2. `transferChecked` — moves the USDC, with the mint and decimals verified on-chain by the token program.
3. `spl-memo` — writes the reorder metadata (reorder ID, USDC amount, NGN payout, corridor) onto the ledger.

If the transfer cannot be confirmed on-chain, the settlement **throws and the reorder is marked `FAILED`**. There is no simulated fallback and no synthetic signature.

### Choosing the USDC mint

`USDC_MINT_ADDRESS` in `.env` controls which mint is settled in. Both options are real SPL transfers on devnet:

| Option | Mint | How to fund the merchant treasury |
| --- | --- | --- |
| **Circle devnet USDC** | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | Paste the merchant wallet address into [faucet.circle.com](https://faucet.circle.com) (captcha-gated, manual) |
| **App-managed test mint** | created by `npm run devnet:mint` | `npm run devnet:fund 10000` — fully self-service, no captcha |

The app-managed mint is a standard 6-decimal SPL mint created by this project, used so reviewers can run the full flow without depending on Circle's captcha faucet. The settlement code path is identical for both.

### Reproducing a settlement from the command line

```bash
npm run devnet:mint          # create an app-managed 6-decimal test USDC mint
# paste the printed address into USDC_MINT_ADDRESS in .env
npm run devnet:fund 10000    # mint 10,000 test USDC into the merchant treasury
npm run devnet:settle 250    # execute a real on-chain USDC payout to the supplier
```

The `settle` command prints the signature, explorer URL, slot, mint, both wallet addresses, the supplier's associated token account, and the supplier's USDC balance before and after.

### Verified devnet transactions

Confirmed on Solana devnet with mint `B5cmnC5yxQSPpftE3c75rSt3MjrwMaNRJho3kR9qTtXg` (6 decimals):

* **Merchant:** `6KtEhsDTDcdLN6XuYdW7HynwpD5wTRj9iaYwVSAvrWNu`
* **Supplier:** `HeXmmUTTbCRmAEhKUELTawoiV4u8smPxpfwDcy8LsBwZ`

| Settlement | Amount | Supplier USDC | Transaction |
| --- | --- | --- | --- |
| CLI proof | 1,250.75 USDC | 0 → 1,250.75 | [`5TARM28r…GojVGf`](https://explorer.solana.com/tx/5TARM28rFUdYr9hw3KaBfYRctE9Wf6do9HLKYpWXiego5GoB2FLSuUVvUkK14JNjHNGGdY2ojdwAsviPizGojVGf?cluster=devnet) |
| Reorder `ord_402238_nc7`, approved via dashboard | 250 USDC | 1,250.75 → 1,500.75 | [`4PZyEXBb…EPMkZ`](https://explorer.solana.com/tx/4PZyEXBbsaFcLtfzpQZNuicDagcyNefZueF5jcKeMZs6SqXdtPSjfro4gjxGVdz8N6BNKvo1pZWWzwLnXE4EPMkZ?cluster=devnet) |

The second transaction is the full product flow end to end: stock depletion → agent scan → reorder proposal → merchant approval → on-chain USDC settlement, with the reorder ID recorded in the transaction memo.
