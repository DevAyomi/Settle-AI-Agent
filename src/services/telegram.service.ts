import { CONFIG } from '../config/index.js';
import { db, ReorderRequest } from '../db/index.js';

export interface TelegramSimulatedMessage {
  id: string;
  chatId: string;
  text: string;
  buttons: Array<{ text: string; callbackData: string; url?: string }>;
  reorderId?: string;
  timestamp: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export class TelegramService {
  private botToken: string = CONFIG.TELEGRAM_BOT_TOKEN;
  private defaultChatId: string = CONFIG.TELEGRAM_CHAT_ID;
  private simulatedMessages: TelegramSimulatedMessage[] = [];

  constructor() {
    console.log('[Telegram] Service initialized. Bot token set:', !!this.botToken);
  }

  public getSimulatedMessages(): TelegramSimulatedMessage[] {
    return this.simulatedMessages;
  }

  public updateSimulatedMessageStatus(reorderId: string, status: 'APPROVED' | 'REJECTED') {
    const msg = this.simulatedMessages.find(m => m.reorderId === reorderId);
    if (msg) {
      msg.status = status;
    }
  }

  /**
   * Format and send an interactive low-stock approval request
   */
  public async sendApprovalRequest(reorder: ReorderRequest): Promise<{ success: boolean; simulatedId: string }> {
    const text = [
      `🤖 *SETTLE AGENT: RESTOCK & PAYMENT APPROVAL*`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `📦 *Product:* ${reorder.product_name || 'Stock Item'}`,
      `🏷 *SKU:* \`${reorder.product_sku || reorder.product_id}\``,
      `⚠️ *Trigger:* Stock fell below safety threshold`,
      ``,
      `🔄 *Reorder Quantity:* ${reorder.quantity} units`,
      `💵 *Unit Price:* $${reorder.unit_cost_usdc.toFixed(2)} USDC`,
      `💰 *Total Amount:* *${reorder.total_usdc.toFixed(2)} USDC* (≈ ₦${reorder.total_ngn.toLocaleString()} NGN)`,
      `💱 *FX Rate:* 1 USDC = ₦${reorder.fx_rate_ngn.toLocaleString()} NGN`,
      ``,
      `🏢 *Supplier:* ${reorder.supplier_name || 'Lagos Prime Tech Ltd'}`,
      `🏦 *Bank Rail:* ${reorder.supplier_bank_name || 'Access Bank'} (${reorder.supplier_bank_account || '0123987654'})`,
      `⚡ *Payment Rail:* Solana USDC Instant Settlement (~2 sec)`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `*Action Required:* Authorize on-chain payment & supplier order.`
    ].join('\n');

    const buttons = [
      {
        text: `✅ Approve & Pay $${reorder.total_usdc} USDC`,
        callbackData: `approve_${reorder.id}`
      },
      {
        text: `❌ Reject Reorder`,
        callbackData: `reject_${reorder.id}`
      }
    ];

    const simId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const simMsg: TelegramSimulatedMessage = {
      id: simId,
      chatId: this.defaultChatId || 'demo_merchant_chat',
      text,
      buttons,
      reorderId: reorder.id,
      timestamp: new Date().toISOString(),
      status: 'PENDING'
    };

    this.simulatedMessages.unshift(simMsg);
    if (this.simulatedMessages.length > 50) {
      this.simulatedMessages.pop();
    }

    db.addLog('TELEGRAM_ALERT', 'ACTION', `Dispatched Telegram Approval Request for Reorder #${reorder.id}`, {
      reorderId: reorder.id,
      amountUsdc: reorder.total_usdc,
      amountNgn: reorder.total_ngn
    });

    // If real Telegram bot token is configured, send live API request
    if (this.botToken && this.defaultChatId) {
      try {
        const inlineKeyboard = {
          inline_keyboard: [
            [
              { text: `✅ Approve $${reorder.total_usdc} USDC`, callback_data: `approve_${reorder.id}` },
              { text: `❌ Reject`, callback_data: `reject_${reorder.id}` }
            ]
          ]
        };

        const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.defaultChatId,
            text,
            parse_mode: 'Markdown',
            reply_markup: inlineKeyboard
          })
        });

        const data = await res.json();
        console.log('[Telegram] Live message response:', data);
      } catch (err: any) {
        console.warn('[Telegram] Live telegram notification skipped (offline or invalid token):', err.message);
      }
    }

    return { success: true, simulatedId: simId };
  }

  /**
   * Send settlement confirmation notification
   */
  public async sendSettlementReceipt(reorder: ReorderRequest, txSignature: string, explorerUrl: string) {
    const text = [
      `🎉 *PAYMENT SETTLED ON SOLANA!*`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `✅ *Reorder ID:* #${reorder.id}`,
      `📦 *Product:* ${reorder.product_name || 'Stock Item'} (${reorder.quantity} units)`,
      `💰 *Amount Transferred:* ${reorder.total_usdc.toFixed(2)} USDC (₦${reorder.total_ngn.toLocaleString()} NGN)`,
      `⚡ *Settlement Speed:* < 3 seconds`,
      `🏦 *Supplier Credit:* ${reorder.supplier_bank_name} - ${reorder.supplier_bank_account}`,
      ``,
      `🔗 *Solana Tx Signature:*`,
      `\`${txSignature}\``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `✨ Inventory restock will update automatically.`
    ].join('\n');

    const simId = `msg_rcpt_${Date.now()}`;
    this.simulatedMessages.unshift({
      id: simId,
      chatId: this.defaultChatId || 'demo_merchant_chat',
      text,
      buttons: [
        { text: `🔍 View on Solana Explorer`, callbackData: `view_tx`, url: explorerUrl }
      ],
      reorderId: reorder.id,
      timestamp: new Date().toISOString(),
      status: 'APPROVED'
    });

    if (this.botToken && this.defaultChatId) {
      try {
        await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.defaultChatId,
            text,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔍 View on Solana Explorer', url: explorerUrl }]
              ]
            }
          })
        });
      } catch (e) {
        // quiet fallback
      }
    }
  }
}

export const telegramService = new TelegramService();
