# ⚡ Settle Agent — Autonomous AI Inventory & Solana USDC Settlement

> **Autonomous AI agent for African SMEs that continuously monitors stock levels, drafts restocking proposals, and executes instant cross-border USDC settlements on Solana to Nigerian suppliers (NGN corridor) with 1-tap merchant approvals.**

---

## 🎯 Problem & Solution

* **The Problem:** African SMEs lose significant time and money on cross-border supplier payments and inventory reordering. Traditional cross-border settlements incur **7–8% in bank fees** and take **3–7 business days** to clear through correspondent banks. Manual inventory tracking leads to painful stockouts and delayed supplier payments.
* **The Solution:** **Settle Agent** is an AI assistant that watches merchant stock levels in real time. When stock falls below a safety threshold, the agent prepares a reorder with real-time FX pricing (USDC ➔ NGN) and routes an interactive 1-tap approval request to the merchant's Dashboard or Telegram. Upon approval, it instantly broadcasts and settles the payment on Solana in seconds, eliminating bank friction while keeping the merchant fully in control.

---

## 🛠 Tech Stack

- **Backend Framework:** [Fastify](https://fastify.dev/) (High-performance Node.js / TypeScript)
- **Blockchain Rail:** [@solana/web3.js](https://solana.com/) + SPL Token Program (Devnet/Mainnet USDC settlements, on-chain memos, and cryptographic verification)
- **Corridor & Oracle:** Real-time USDC ➔ NGN (Nigerian Naira) FX rate engine with local bank payout routing (e.g. Access Bank Nigeria)
- **Database:** PostgreSQL support with zero-config local SQLite fallback (`better-sqlite3` / `pg`)
- **Queue / Workers:** [BullMQ](https://bullmq.io/) with Redis + resilient in-memory asynchronous worker event queue
- **Interface:** High-Fidelity Responsive Merchant Web Dashboard & Interactive Telegram Bot / Simulator

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Build & Run
```bash
# Start in development mode with auto-reload
npm run dev

# Or build and run production server
npm run build
npm start
```

Open **`http://localhost:3000`** in your browser to access the Settle Agent Dashboard.

---

## 💡 Key Features & Workflow

1. **Autonomous Stock Monitoring & Triggers:**
   - Evaluates stock velocity and safety thresholds.
   - Immediate detection when stock falls below buffer (e.g. Samsung 25W Fast Chargers drop below 12 units).
2. **Instant Reorder Proposal & FX Lock:**
   - Calculates reorder requirements (50 units × $5.00 = $250.00 USDC).
   - Locks USDC ➔ NGN FX quote (e.g., $250 USDC ≈ ₦380,000 NGN).
   - Prepares verified recipient bank routing (Access Bank Nigeria).
3. **One-Tap Merchant Approval:**
   - Merchant receives instant notification with 1-tap `[Approve & Settle]` button on the Web Dashboard and Telegram.
4. **On-Chain Solana Settlement:**
   - Executes Solana transaction in `< 3 seconds` with minimal gas fees (`~$0.0005` vs 7.5% bank fees).
   - Emits on-chain transaction signature with direct links to [Solana Explorer](https://explorer.solana.com/?cluster=devnet).
   - Automatically restocks inventory upon settlement confirmation.
5. **Built-in Telegram Approval Simulator & Live Logs:**
   - Test mobile merchant approvals directly in the UI without third-party setup.
   - Real-time audit log of AI decision telemetry.

---

## 📡 API Reference

### Authentication & Merchant Profiles
| Endpoint | Method | Description |
|---|---|---|
| `/api/auth/register` | `POST` | Register SME account & generate Solana keypair |
| `/api/auth/login` | `POST` | Authenticate merchant with email/password (JWT) |
| `/api/auth/demo` | `POST` | Instant 1-click Demo Merchant access |
| `/api/auth/me` | `GET` | Get authenticated merchant profile (`Bearer <token>`) |
| `/api/auth/logout` | `POST` | End authenticated merchant session |

### Inventory, Restocking & Settlement Rails
| Endpoint | Method | Description |
|---|---|---|
| `/api/inventory` | `GET` | Fetch all tracked products and stock levels |
| `/api/inventory/sell` | `POST` | Simulate customer purchases / stock drops |
| `/api/reorders` | `GET` | List all reorders & pending approval proposals |
| `/api/reorders/:id/approve` | `POST` | Execute 1-tap approval & on-chain Solana payout |
| `/api/reorders/:id/reject` | `POST` | Decline reorder proposal |
| `/api/wallet` | `GET` | Solana Devnet wallet balances & keys |
| `/api/wallet/airdrop` | `POST` | Request 1 Devnet SOL faucet airdrop |
| `/api/telegram/messages` | `GET` | Simulated Telegram approval messages |
| `/api/telegram/webhook` | `POST` | Telegram Bot Webhook endpoint |
| `/api/stats` | `GET` | KPI metrics (USDC settled, NGN volume, fee savings) |
| `/api/logs` | `GET` | Real-time AI agent telemetry logs |
