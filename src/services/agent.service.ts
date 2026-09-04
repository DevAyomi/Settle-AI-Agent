import { db, Product, ReorderRequest } from '../db/index.js';
import { fxService } from './fx.service.js';
import { solanaService } from './solana.service.js';
import { telegramService } from './telegram.service.js';
import { queueService, QueueJobData } from './queue.service.js';
import { CONFIG } from '../config/index.js';

export class AgentService {
  private isRunning = false;
  private intervalTimer: NodeJS.Timeout | null = null;

  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Initialize the queue processor
    await queueService.init(this.processJob.bind(this));

    // Run initial stock check
    await this.scanInventory();

    // Start periodic background agent loop
    this.intervalTimer = setInterval(() => {
      this.scanInventory().catch(err => {
        console.error('[Agent] Scan error:', err);
      });
    }, CONFIG.AGENT_POLL_INTERVAL_MS);

    await db.addLog('AGENT_STARTED', 'SUCCESS', `Settle Agent autonomous engine started (polling every ${CONFIG.AGENT_POLL_INTERVAL_MS / 1000}s).`);
    console.log(`[Agent] Autonomous engine running on interval ${CONFIG.AGENT_POLL_INTERVAL_MS}ms.`);
  }

  public async stop() {
    this.isRunning = false;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    await db.addLog('AGENT_STOPPED', 'INFO', 'Settle Agent autonomous loop paused.');
  }

  /**
   * Process background jobs
   */
  private async processJob(job: QueueJobData) {
    switch (job.jobType) {
      case 'CHECK_INVENTORY':
        await this.scanInventory();
        break;
      case 'EXECUTE_SETTLEMENT':
        await this.executeSettlementInternal(job.payload.reorderId, job.payload.channel);
        break;
      default:
        console.log(`[Queue] Unhandled job type: ${job.jobType}`);
    }
  }

  /**
   * Scans all products for low-stock triggers
   */
  public async scanInventory(): Promise<{ evaluated: number; triggered: number; proposals: ReorderRequest[] }> {
    const products = await db.getProducts();
    const pendingOrders = await db.getPendingReorders();
    const pendingProductIds = new Set(pendingOrders.map(o => o.product_id));

    let triggered = 0;
    const proposals: ReorderRequest[] = [];

    for (const product of products) {
      if (product.current_stock <= product.min_threshold) {
        // Check if there is already a pending order awaiting merchant approval
        if (pendingProductIds.has(product.id)) {
          continue;
        }

        console.log(`[Agent] Low stock detected for ${product.name} (Current: ${product.current_stock} <= Threshold: ${product.min_threshold})`);

        // Calculate order requirements
        const reorderQty = product.reorder_quantity;
        const totalUsdc = Number((reorderQty * product.unit_cost_usdc).toFixed(2));
        const fxQuote = fxService.convertUsdcToNgn(totalUsdc);

        const reorderId = `ord_${Date.now().toString().slice(-6)}_${Math.random().toString(36).substring(2, 5)}`;
        await db.createReorderRequest({
          id: reorderId,
          product_id: product.id,
          supplier_id: product.supplier_id,
          quantity: reorderQty,
          unit_cost_usdc: product.unit_cost_usdc,
          total_usdc: totalUsdc,
          fx_rate_ngn: fxQuote.rate,
          total_ngn: fxQuote.amountNgn,
          status: 'PENDING_APPROVAL',
          trigger_reason: `Stock level (${product.current_stock}) dropped below safety buffer (${product.min_threshold})`
        });

        // Fetch populated entity
        const fullReorder = (await db.getReorderRequestById(reorderId))!;
        proposals.push(fullReorder);
        triggered++;

        await db.addLog('REORDER_DRAFTED', 'ACTION', `Drafted reorder #${reorderId} for ${product.name} (${reorderQty} units, $${totalUsdc} USDC / ₦${fxQuote.amountNgn.toLocaleString()} NGN)`, {
          reorderId,
          sku: product.sku,
          currentStock: product.current_stock,
          threshold: product.min_threshold,
          totalUsdc,
          totalNgn: fxQuote.amountNgn
        });

        // Send approval request to merchant on Telegram
        await telegramService.sendApprovalRequest(fullReorder);
      }
    }

    return {
      evaluated: products.length,
      triggered,
      proposals
    };
  }

  /**
   * Merchant Approval Handler (One-tap approval)
   */
  public async approveReorder(reorderId: string, channel: string, merchantId?: string): Promise<ReorderRequest> {
    const reorder = await db.getReorderRequestById(reorderId);
    if (!reorder) {
      throw new Error(`Reorder #${reorderId} not found.`);
    }

    if (reorder.status !== 'PENDING_APPROVAL') {
      throw new Error(`Reorder #${reorderId} is already in state '${reorder.status}'.`);
    }

    // Mark as EXECUTING immediately
    const approvedAt = new Date().toISOString();
    await db.updateReorderStatus(reorderId, {
      status: 'EXECUTING',
      approval_channel: channel,
      approved_at: approvedAt
    });

    await db.addLog('APPROVAL_RECEIVED', 'SUCCESS', `Merchant approved Reorder #${reorderId} via ${channel}. Initiating Solana USDC settlement...`, {
      reorderId,
      channel
    });

    telegramService.updateSimulatedMessageStatus(reorderId, 'APPROVED');

    // Execute settlement on Solana
    return await this.executeSettlementInternal(reorderId, channel, merchantId);
  }

  private async executeSettlementInternal(reorderId: string, channel: string, merchantId?: string): Promise<ReorderRequest> {
    const reorder = await db.getReorderRequestById(reorderId);
    if (!reorder) throw new Error(`Reorder #${reorderId} not found`);

    try {
      // Execute Solana transaction
      const settlement = await solanaService.executeUsdcSettlement(
        reorder.id,
        reorder.total_usdc,
        reorder.total_ngn
      );

      const completedAt = new Date().toISOString();

      // Update reorder status to COMPLETED
      await db.updateReorderStatus(reorderId, {
        status: 'COMPLETED',
        solana_tx_signature: settlement.signature,
        solana_explorer_url: settlement.explorerUrl,
        completed_at: completedAt
      });

      // Deduct USDC from merchant's actual database balance
      const m = merchantId ? await db.getMerchantById(merchantId) : await db.getMerchant();
      if (m) {
        await db.updateMerchantBalances(m.id, -reorder.total_usdc, 0);
      }

      // Update product inventory (restock)
      const product = await db.getProductById(reorder.product_id);
      if (product) {
        const newStock = product.current_stock + reorder.quantity;
        await db.updateProductStock(product.id, newStock);
        await db.addLog('INVENTORY_RESTOCKED', 'SUCCESS', `Stock updated for ${product.name}: ${product.current_stock} -> ${newStock} (+${reorder.quantity} units)`, {
          productId: product.id,
          oldStock: product.current_stock,
          newStock,
          reorderId
        });
      }

      // Send settlement receipt to merchant via Telegram
      await telegramService.sendSettlementReceipt(reorder, settlement.signature, settlement.explorerUrl);

      const updated = (await db.getReorderRequestById(reorderId))!;
      return updated;
    } catch (err: any) {
      console.error(`[Agent] Execution failed for reorder #${reorderId}:`, err);
      await db.updateReorderStatus(reorderId, {
        status: 'FAILED',
        error_message: err.message
      });
      await db.addLog('SETTLEMENT_FAILED', 'ERROR', `Settlement failed for Reorder #${reorderId}: ${err.message}`, {
        reorderId,
        error: err.message
      });
      throw err;
    }
  }

  /**
   * Reject Reorder Request
   */
  public async rejectReorder(reorderId: string, reason = 'Rejected by merchant'): Promise<ReorderRequest> {
    const reorder = await db.getReorderRequestById(reorderId);
    if (!reorder) {
      throw new Error(`Reorder #${reorderId} not found.`);
    }

    await db.updateReorderStatus(reorderId, {
      status: 'REJECTED',
      error_message: reason
    });

    telegramService.updateSimulatedMessageStatus(reorderId, 'REJECTED');

    await db.addLog('REORDER_REJECTED', 'WARN', `Reorder #${reorderId} was rejected by merchant. Reason: ${reason}`, {
      reorderId,
      reason
    });

    return (await db.getReorderRequestById(reorderId))!;
  }
}

export const agentService = new AgentService();
