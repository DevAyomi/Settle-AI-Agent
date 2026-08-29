import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');

export const CONFIG = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  HOST: process.env.HOST || '0.0.0.0',
  DATABASE_URL: process.env.DATABASE_URL || '',
  DATABASE_FILE: process.env.DATABASE_FILE || path.join(projectRoot, 'data', 'settle_agent.db'),
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  
  // Auth Config
  JWT_SECRET: process.env.JWT_SECRET || 'settle-agent-super-secret-key-2026',
  
  // Solana Config
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  SOLANA_NETWORK: process.env.SOLANA_NETWORK || 'devnet',
  // Standard Devnet USDC Mint (Circle Devnet USDC or fallback mock)
  USDC_MINT_ADDRESS: process.env.USDC_MINT_ADDRESS || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  
  // Merchant & Supplier Keypair storage paths
  MERCHANT_KEY_PATH: process.env.MERCHANT_KEY_PATH || path.join(projectRoot, 'data', 'merchant_keypair.json'),
  SUPPLIER_KEY_PATH: process.env.SUPPLIER_KEY_PATH || path.join(projectRoot, 'data', 'supplier_keypair.json'),
  
  // Telegram Bot Config
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
  
  // Agent & FX Config
  AGENT_POLL_INTERVAL_MS: parseInt(process.env.AGENT_POLL_INTERVAL_MS || '30000', 10),
  DEFAULT_USDC_NGN_RATE: parseFloat(process.env.DEFAULT_USDC_NGN_RATE || '1520.00'),
  TRADITIONAL_WIRE_FEE_PERCENT: 0.075, // 7.5% average cross-border bank fee
  TRADITIONAL_SETTLEMENT_DAYS: 5, // 5 days average
};
