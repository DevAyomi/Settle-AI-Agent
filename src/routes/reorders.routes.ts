import { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { agentService } from '../services/agent.service.js';
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

export async function reordersRoutes(fastify: FastifyInstance) {
  // Get all reorder requests
  fastify.get<{
    Querystring: { isLive?: string };
  }>('/api/reorders', async (request, reply) => {
    const isLive = request.query.isLive === 'true';
    let reorders = await db.getAllReorders(100);
    const pending = await db.getPendingReorders();

    if (isLive) {
      reorders = reorders.filter(r => r.error_message !== 'SOLANA_FAUCET_RATE_LIMITED');
    }

    return reply.send({
      success: true,
      pendingCount: pending.length,
      pending,
      all: reorders
    });
  });

  // Get only pending reorders awaiting merchant 1-tap approval
  fastify.get('/api/reorders/pending', async (request, reply) => {
    const pending = await db.getPendingReorders();
    return reply.send({
      success: true,
      count: pending.length,
      pending
    });
  });

  // 1-Tap Merchant Approval Endpoint
  fastify.post<{
    Params: { id: string };
    Body?: { channel?: 'WEB_DASHBOARD' | 'TELEGRAM' };
  }>('/api/reorders/:id/approve', async (request, reply) => {
    const { id } = request.params;
    const channel = request.body?.channel || 'WEB_DASHBOARD';

    try {
      const merchantId = await getMerchantIdFromRequest(request);
      const completedReorder = await agentService.approveReorder(id, channel, merchantId);
      return reply.send({
        success: true,
        message: 'Reorder approved and USDC settlement executed successfully on Solana!',
        reorder: completedReorder
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: err.message
      });
    }
  });

  // Reject Reorder Endpoint
  fastify.post<{
    Params: { id: string };
    Body?: { reason?: string };
  }>('/api/reorders/:id/reject', async (request, reply) => {
    const { id } = request.params;
    const reason = request.body?.reason || 'Declined by merchant';

    try {
      const rejected = await agentService.rejectReorder(id, reason);
      return reply.send({
        success: true,
        message: 'Reorder proposal rejected.',
        reorder: rejected
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: err.message
      });
    }
  });

  // Manually force an immediate Agent Inventory Scan
  fastify.post('/api/reorders/scan', async (request, reply) => {
    const result = await agentService.scanInventory();
    return reply.send({
      success: true,
      message: `Scanned ${result.evaluated} products. Drafted ${result.triggered} new reorders.`,
      result
    });
  });
}
