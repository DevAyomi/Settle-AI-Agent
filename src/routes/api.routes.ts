import { FastifyInstance } from 'fastify';
import { solanaService } from '../services/solana.service.js';
import { db } from '../db/index.js';
import { telegramService } from '../services/telegram.service.js';
import { fxService } from '../services/fx.service.js';
import { agentService } from '../services/agent.service.js';
import { queueService } from '../services/queue.service.js';
import { authService } from '../services/auth.service.js';

async function getMerchantIdFromRequest(request: any): Promise<string> {
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '').trim();
    const payload = authService.verifyToken(token);
    if (payload && payload.merchantId) {
      return payload.merchantId;
    }
  }
  const firstMerchant = await db.getMerchant();
  return firstMerchant ? firstMerchant.id : 'merch_01';
}

export async function walletRoutes(fastify: FastifyInstance) {
  // Get live wallet balances, network configuration, and address keys
  fastify.get<{
    Querystring: { isLive?: string };
  }>('/api/wallet', async (request, reply) => {
    try {
      const merchantId = await getMerchantIdFromRequest(request);
      const isLive = request.query.isLive === 'true';
      const balanceData = await solanaService.getBalances(merchantId, isLive);
      return reply.send({
        success: true,
        ...balanceData
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // Request 1 SOL Devnet Airdrop
  fastify.post<{
    Body?: { publicKey?: string };
  }>('/api/wallet/airdrop', async (request, reply) => {
    try {
      const { publicKey } = request.body || {};
      const res = await solanaService.requestAirdrop(publicKey);
      return reply.send({
        success: true,
        message: 'Devnet SOL airdrop confirmed!',
        signature: res.signature,
        newBalance: res.balance
      });
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message });
    }
  });

  // Fund Merchant USDC Treasury Position
  fastify.post<{
    Body: { amount: number; paymentMethod?: string };
  }>('/api/wallet/fund', async (request, reply) => {
    try {
      const { amount = 5000, paymentMethod = 'Direct On-Chain Transfer' } = request.body || {};
      const numericAmount = Number(amount);

      if (!numericAmount || numericAmount <= 0) {
        return reply.status(400).send({ success: false, error: 'Amount must be greater than 0' });
      }

      const merchantId = await getMerchantIdFromRequest(request);

      // Update actual merchant balance in database
      await db.updateMerchantBalances(merchantId, numericAmount, 0);

      // Log treasury funding event
      await db.addLog('TREASURY_FUNDED', 'SUCCESS', `Funded merchant treasury with +$${numericAmount.toLocaleString()}.00 USDC via ${paymentMethod}`, {
        amountUsdc: numericAmount,
        paymentMethod,
        timestamp: new Date().toISOString()
      });

      return reply.send({
        success: true,
        message: `Successfully credited +$${numericAmount.toLocaleString()}.00 USDC to settlement position`,
        fundedAmount: numericAmount
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
}

export async function telegramRoutes(fastify: FastifyInstance) {
  // Get simulated telegram cards
  fastify.get('/api/telegram/messages', async (request, reply) => {
    const messages = telegramService.getSimulatedMessages();
    return reply.send({ success: true, messages });
  });

  // Telegram Webhook receiver (for real Telegram bot webhook mode)
  fastify.post('/api/telegram/webhook', async (request, reply) => {
    const update = request.body as any;
    console.log('[Telegram Webhook] Received update:', JSON.stringify(update));

    if (update?.callback_query) {
      const callbackData = update.callback_query.data;
      const [action, reorderId] = callbackData.split('_');

      if (action === 'approve' && reorderId) {
        try {
          await agentService.approveReorder(reorderId, 'TELEGRAM');
        } catch (err: any) {
          console.error('[Telegram Webhook] Approval failed:', err);
        }
      } else if (action === 'reject' && reorderId) {
        try {
          await agentService.rejectReorder(reorderId, 'Rejected from Telegram');
        } catch (err: any) {
          console.error('[Telegram Webhook] Rejection failed:', err);
        }
      }
    }

    return reply.send({ ok: true });
  });
}

import { Keypair } from '@solana/web3.js';

export async function suppliersRoutes(fastify: FastifyInstance) {
  // Get all registered suppliers with search & country filtering
  fastify.get<{
    Querystring: { search?: string; country?: string };
  }>('/api/suppliers', async (request, reply) => {
    const { search, country } = request.query || {};
    const suppliers = await db.getAllSuppliers(search, country);
    return reply.send({ success: true, suppliers });
  });

  // Create / Register New Supplier
  fastify.post<{
    Body: {
      name: string;
      email: string;
      phone?: string;
      country?: string;
      corridorCurrency?: string;
      bankName: string;
      bankAccountNumber: string;
      bankAccountName: string;
      solanaPublicKey?: string;
      settlementRail?: string;
    };
  }>('/api/suppliers', async (request, reply) => {
    try {
      const {
        name,
        email,
        phone = '',
        country = 'Nigeria',
        corridorCurrency = 'NGN',
        bankName,
        bankAccountNumber,
        bankAccountName,
        solanaPublicKey,
        settlementRail = 'Solana_USDC_to_NGN_Instant'
      } = request.body || {};

      if (!name || !email || !bankName || !bankAccountNumber) {
        return reply.status(400).send({
          success: false,
          error: 'Supplier name, email, bank name, and account number are required'
        });
      }

      // Generate dedicated Solana wallet for the supplier if not provided
      const finalSolanaKey = solanaPublicKey || Keypair.generate().publicKey.toBase58();
      const newId = `supp_${Date.now().toString(36)}`;

      const created = await db.createSupplier({
        id: newId,
        name,
        email,
        phone,
        country,
        corridor_currency: corridorCurrency,
        solana_public_key: finalSolanaKey,
        bank_name: bankName,
        bank_account_number: bankAccountNumber,
        bank_account_name: bankAccountName || name,
        settlement_rail: settlementRail
      });

      await db.addLog('SUPPLIER_REGISTERED', 'SUCCESS', `Connected new cross-border supplier: ${created.name} (${created.country} - ${created.bank_name}) with instant settlement rail`, {
        supplierId: created.id,
        country: created.country,
        currency: created.corridor_currency,
        bankName: created.bank_name
      });

      return reply.send({
        success: true,
        message: 'Supplier registered successfully',
        supplier: created
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
}

export async function statsRoutes(fastify: FastifyInstance) {
  fastify.get<{
    Querystring: { isLive?: string };
  }>('/api/stats', async (request, reply) => {
    const isLive = request.query.isLive === 'true';
    const stats = await db.getStats(isLive);
    const quote = fxService.getQuote(100);
    const queueMode = queueService.getQueueMode();

    return reply.send({
      success: true,
      stats,
      fxQuote: quote,
      queueMode,
      corridor: {
        source: 'USDC (Solana)',
        destination: 'NGN (Nigeria)',
        speed: '< 3 seconds',
        bankRails: 'NIBSS / Instant Interbank NGN'
      }
    });
  });

  // Agent activity logs
  fastify.get<{
    Querystring: { limit?: string };
  }>('/api/logs', async (request, reply) => {
    const limit = parseInt(request.query.limit || '30', 10);
    const logs = await db.getRecentLogs(limit);
    return reply.send({ success: true, count: logs.length, logs });
  });
}
