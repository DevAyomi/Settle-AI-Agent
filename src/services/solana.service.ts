import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  TransactionInstruction
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  getAccount,
  getMint,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  createMint,
  mintTo,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID
} from '@solana/spl-token';
import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index.js';
import { db } from '../db/index.js';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

export interface SettlementResult {
  signature: string;
  explorerUrl: string;
  blockTime?: number;
  slot?: number;
  amountUsdc: number;
  amountNgn: number;
  recipientPublicKey: string;
  senderPublicKey: string;
  /** Mint actually transferred, so the payout is independently verifiable on-chain. */
  mintAddress: string;
  /** Recipient's SPL token account that received the USDC. */
  recipientTokenAccount: string;
  /** Supplier's on-chain USDC balance before/after the transfer. */
  recipientBalanceBefore: number;
  recipientBalanceAfter: number;
}

export class SolanaService {
  private connection: Connection;
  private merchantKeypair!: Keypair;
  private supplierKeypair!: Keypair;
  private usdcMintPublicKey: PublicKey;
  /** Mint authority for the app-managed devnet test mint. Absent for Circle USDC. */
  private mintAuthorityKeypair?: Keypair;
  private mintInfoCache?: { decimals: number; programId: PublicKey };

  constructor() {
    this.connection = new Connection(CONFIG.SOLANA_RPC_URL, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000
    });
    this.usdcMintPublicKey = new PublicKey(CONFIG.USDC_MINT_ADDRESS);
    this.initKeypairs();
  }

  private loadOrCreateKeypair(filePath: string): Keypair {
    if (fs.existsSync(filePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return Keypair.fromSecretKey(new Uint8Array(raw));
      } catch {
        // fall through and regenerate
      }
    }
    const kp = Keypair.generate();
    fs.writeFileSync(filePath, JSON.stringify(Array.from(kp.secretKey)));
    return kp;
  }

  private initKeypairs() {
    const dataDir = path.dirname(CONFIG.MERCHANT_KEY_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.merchantKeypair = this.loadOrCreateKeypair(CONFIG.MERCHANT_KEY_PATH);
    this.supplierKeypair = this.loadOrCreateKeypair(CONFIG.SUPPLIER_KEY_PATH);

    // The app-managed devnet mint authority only exists when we created the mint
    // ourselves (see ensureDevnetUsdcMint). Circle's devnet USDC has no local authority.
    if (fs.existsSync(CONFIG.MINT_AUTHORITY_KEY_PATH)) {
      try {
        const raw = JSON.parse(fs.readFileSync(CONFIG.MINT_AUTHORITY_KEY_PATH, 'utf-8'));
        this.mintAuthorityKeypair = Keypair.fromSecretKey(new Uint8Array(raw));
      } catch {
        this.mintAuthorityKeypair = undefined;
      }
    }

    // Update DB with active public keys
    db.updateMerchantPublicKey(this.merchantKeypair.publicKey.toBase58());
    db.updateSupplierPublicKey('supp_ng_01', this.supplierKeypair.publicKey.toBase58());

    console.log(`[Solana] Merchant Public Key: ${this.merchantKeypair.publicKey.toBase58()}`);
    console.log(`[Solana] Supplier Public Key: ${this.supplierKeypair.publicKey.toBase58()}`);
    console.log(`[Solana] USDC Mint: ${this.usdcMintPublicKey.toBase58()}`);
  }

  public getMerchantPublicKey(): string {
    return this.merchantKeypair.publicKey.toBase58();
  }

  public getSupplierPublicKey(): string {
    return this.supplierKeypair.publicKey.toBase58();
  }

  public getUsdcMintAddress(): string {
    return this.usdcMintPublicKey.toBase58();
  }

  /**
   * Reads the mint's decimals and owning token program once, so transfers work
   * against both Circle's devnet USDC (SPL Token) and Token-2022 mints.
   */
  private async getMintInfo(): Promise<{ decimals: number; programId: PublicKey }> {
    if (this.mintInfoCache) return this.mintInfoCache;

    const accountInfo = await this.connection.getAccountInfo(this.usdcMintPublicKey);
    if (!accountInfo) {
      throw new Error(
        `USDC mint ${this.usdcMintPublicKey.toBase58()} does not exist on ${CONFIG.SOLANA_NETWORK}. ` +
        `Set USDC_MINT_ADDRESS to a valid mint, or run "npm run mint:devnet" to create an app-managed test mint.`
      );
    }

    const programId = accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;
    const mint = await getMint(this.connection, this.usdcMintPublicKey, 'confirmed', programId);

    this.mintInfoCache = { decimals: mint.decimals, programId };
    return this.mintInfoCache;
  }

  private async getTokenBalance(owner: PublicKey): Promise<number> {
    try {
      const { decimals, programId } = await this.getMintInfo();
      const ata = getAssociatedTokenAddressSync(this.usdcMintPublicKey, owner, false, programId);
      const account = await getAccount(this.connection, ata, 'confirmed', programId);
      return Number(account.amount) / 10 ** decimals;
    } catch {
      // No associated token account yet means a zero balance.
      return 0;
    }
  }

  public async getBalances(merchantId?: string, isLive?: boolean) {
    let solBalance = 0;
    let supplierSolBalance = 0;
    let usdcBalance = 0.00;

    try {
      solBalance = await this.connection.getBalance(this.merchantKeypair.publicKey) / LAMPORTS_PER_SOL;
    } catch (e) {
      console.warn('[Solana] Could not fetch merchant SOL balance (RPC limit or offline):', e);
    }

    try {
      supplierSolBalance = await this.connection.getBalance(this.supplierKeypair.publicKey) / LAMPORTS_PER_SOL;
    } catch (e) {
      console.warn('[Solana] Could not fetch supplier SOL balance:', e);
    }

    if (isLive) {
      usdcBalance = await this.getTokenBalance(this.merchantKeypair.publicKey);
    } else {
      const merchantDb = merchantId ? await db.getMerchantById(merchantId) : await db.getMerchant();
      usdcBalance = merchantDb ? Number(merchantDb.usdc_balance || 0) : 0.00;
    }

    const merchantDb = merchantId ? await db.getMerchantById(merchantId) : await db.getMerchant();
    const ngnBalance = (isLive || !merchantDb) ? 0.00 : Number(merchantDb.ngn_balance || 0);

    // Supplier USDC is always read from chain - it is the proof the payout landed.
    const supplierUsdcBalance = await this.getTokenBalance(this.supplierKeypair.publicKey);

    return {
      network: CONFIG.SOLANA_NETWORK,
      rpcUrl: CONFIG.SOLANA_RPC_URL,
      usdcMint: this.usdcMintPublicKey.toBase58(),
      merchant: {
        publicKey: this.merchantKeypair.publicKey.toBase58(),
        solBalance: Number(solBalance.toFixed(4)),
        usdcBalance,
        ngnBalance
      },
      supplier: {
        publicKey: this.supplierKeypair.publicKey.toBase58(),
        solBalance: Number(supplierSolBalance.toFixed(4)),
        usdcBalance: supplierUsdcBalance
      }
    };
  }

  public async requestAirdrop(publicKeyStr?: string): Promise<{ signature: string; balance: number }> {
    const targetKey = publicKeyStr ? new PublicKey(publicKeyStr) : this.merchantKeypair.publicKey;
    try {
      const airdropSignature = await this.connection.requestAirdrop(
        targetKey,
        1 * LAMPORTS_PER_SOL
      );
      const latestBlockhash = await this.connection.getLatestBlockhash();
      await this.connection.confirmTransaction({
        signature: airdropSignature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
      });
      const balance = await this.connection.getBalance(targetKey) / LAMPORTS_PER_SOL;
      db.addLog('SOLANA_AIRDROP', 'SUCCESS', `Airdropped 1 SOL to ${targetKey.toBase58().substring(0, 8)}...`, {
        signature: airdropSignature,
        newBalance: balance
      });
      return { signature: airdropSignature, balance };
    } catch (err: any) {
      db.addLog('SOLANA_AIRDROP', 'WARN', `Devnet airdrop faucet notice: ${err.message}`);
      throw new Error(`Airdrop error: ${err.message}`);
    }
  }

  /**
   * Creates an app-managed 6-decimal SPL mint on devnet and persists its authority,
   * so the settlement flow is testable end-to-end without Circle's captcha faucet.
   * Returns the new mint address, which must be written to USDC_MINT_ADDRESS.
   */
  public async ensureDevnetUsdcMint(): Promise<string> {
    if (CONFIG.SOLANA_NETWORK === 'mainnet-beta') {
      throw new Error('Refusing to create a test mint on mainnet-beta.');
    }

    const authority = this.mintAuthorityKeypair ?? Keypair.generate();
    const mint = await createMint(
      this.connection,
      this.merchantKeypair, // fee payer
      authority.publicKey,  // mint authority
      null,                 // no freeze authority
      6                     // USDC-compatible decimals
    );

    this.mintAuthorityKeypair = authority;
    fs.writeFileSync(CONFIG.MINT_AUTHORITY_KEY_PATH, JSON.stringify(Array.from(authority.secretKey)));

    return mint.toBase58();
  }

  /**
   * Mints app-managed devnet test USDC into the merchant treasury.
   * Only works when this app created the mint (see ensureDevnetUsdcMint).
   */
  public async mintTestUsdc(amount: number, ownerKeyStr?: string): Promise<string> {
    if (CONFIG.SOLANA_NETWORK === 'mainnet-beta') {
      throw new Error('Refusing to mint test tokens on mainnet-beta.');
    }
    if (!this.mintAuthorityKeypair) {
      throw new Error(
        `No local mint authority for ${this.usdcMintPublicKey.toBase58()}. ` +
        `This mint (e.g. Circle devnet USDC) must be funded from its own faucet at https://faucet.circle.com.`
      );
    }

    const { decimals, programId } = await this.getMintInfo();
    const owner = ownerKeyStr ? new PublicKey(ownerKeyStr) : this.merchantKeypair.publicKey;
    const ata = getAssociatedTokenAddressSync(this.usdcMintPublicKey, owner, false, programId);

    // Idempotent ATA creation keeps repeat funding safe.
    const setupTx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        this.merchantKeypair.publicKey,
        ata,
        owner,
        this.usdcMintPublicKey,
        programId
      )
    );
    await sendAndConfirmTransaction(this.connection, setupTx, [this.merchantKeypair], {
      commitment: 'confirmed'
    });

    const signature = await mintTo(
      this.connection,
      this.merchantKeypair, // fee payer
      this.usdcMintPublicKey,
      ata,
      this.mintAuthorityKeypair,
      BigInt(Math.round(amount * 10 ** decimals)),
      [],
      { commitment: 'confirmed' },
      programId
    );

    db.addLog('USDC_TEST_MINT', 'SUCCESS', `Minted ${amount} devnet test USDC to ${owner.toBase58().substring(0, 8)}...`, {
      signature,
      amount,
      mint: this.usdcMintPublicKey.toBase58()
    });

    return signature;
  }

  /**
   * Executes the supplier payout as a real SPL token transfer of USDC on Solana.
   *
   * The transaction contains:
   *   1. an idempotent create of the supplier's associated token account,
   *   2. a transferChecked of the USDC amount (mint + decimals verified on-chain),
   *   3. an SPL Memo carrying the Settle Agent reorder metadata.
   *
   * There is no simulated fallback: if the transfer cannot be confirmed on-chain,
   * this throws and the reorder is marked FAILED.
   */
  public async executeUsdcSettlement(
    reorderId: string,
    amountUsdc: number,
    amountNgn: number,
    recipientKeyStr?: string
  ): Promise<SettlementResult> {
    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
      throw new Error(`Invalid settlement amount: ${amountUsdc}`);
    }

    const recipientKey = recipientKeyStr ? new PublicKey(recipientKeyStr) : this.supplierKeypair.publicKey;
    const { decimals, programId } = await this.getMintInfo();
    const rawAmount = BigInt(Math.round(amountUsdc * 10 ** decimals));

    const senderAta = getAssociatedTokenAddressSync(
      this.usdcMintPublicKey, this.merchantKeypair.publicKey, false, programId
    );
    const recipientAta = getAssociatedTokenAddressSync(
      this.usdcMintPublicKey, recipientKey, false, programId
    );

    console.log(
      `[Solana] Settling Reorder #${reorderId}: ${amountUsdc} USDC (≈ ₦${amountNgn.toLocaleString()}) ` +
      `-> ${recipientKey.toBase58()} (ATA ${recipientAta.toBase58()})`
    );

    // 1. The merchant pays network fees and rent for the supplier's token account.
    const lamports = await this.connection.getBalance(this.merchantKeypair.publicKey);
    if (lamports < 5_000_000) {
      try {
        console.log('[Solana] Merchant SOL low. Requesting devnet airdrop...');
        const airdropSig = await this.connection.requestAirdrop(
          this.merchantKeypair.publicKey, 1 * LAMPORTS_PER_SOL
        );
        const latestBh = await this.connection.getLatestBlockhash();
        await this.connection.confirmTransaction({
          signature: airdropSig,
          blockhash: latestBh.blockhash,
          lastValidBlockHeight: latestBh.lastValidBlockHeight
        });
      } catch {
        console.log('[Solana] Devnet airdrop rate limited; continuing with existing balance.');
      }
    }

    // 2. Verify the merchant actually holds enough USDC before broadcasting.
    let senderBalance: bigint;
    try {
      const senderAccount = await getAccount(this.connection, senderAta, 'confirmed', programId);
      senderBalance = senderAccount.amount;
    } catch {
      throw new Error(
        `Merchant treasury holds no ${this.usdcMintPublicKey.toBase58()} USDC ` +
        `(token account ${senderAta.toBase58()} does not exist). Fund it before settling.`
      );
    }

    if (senderBalance < rawAmount) {
      throw new Error(
        `Insufficient USDC: merchant holds ${Number(senderBalance) / 10 ** decimals}, ` +
        `settlement requires ${amountUsdc}.`
      );
    }

    const recipientBalanceBefore = await this.getTokenBalance(recipientKey);

    // 3. Build the transfer.
    const memoText = JSON.stringify({
      agent: 'SettleAgent-v1',
      action: 'SUPPLIER_PAYOUT',
      reorder_id: reorderId,
      usdc_amount: amountUsdc,
      ngn_payout: amountNgn,
      corridor: 'NGN_NIGERIA',
      timestamp: new Date().toISOString()
    });

    const transaction = new Transaction();

    transaction.add(
      createAssociatedTokenAccountIdempotentInstruction(
        this.merchantKeypair.publicKey, // payer
        recipientAta,
        recipientKey,
        this.usdcMintPublicKey,
        programId
      )
    );

    transaction.add(
      createTransferCheckedInstruction(
        senderAta,
        this.usdcMintPublicKey,
        recipientAta,
        this.merchantKeypair.publicKey,
        rawAmount,
        decimals,
        [],
        programId
      )
    );

    transaction.add(
      new TransactionInstruction({
        keys: [{ pubkey: this.merchantKeypair.publicKey, isSigner: true, isWritable: true }],
        programId: MEMO_PROGRAM_ID,
        data: Buffer.from(memoText, 'utf-8')
      })
    );

    // 4. Broadcast and confirm. A failure here is a real failure.
    let signature: string;
    try {
      signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.merchantKeypair],
        { commitment: 'confirmed' }
      );
    } catch (txErr: any) {
      const logs = txErr?.logs ? `\nProgram logs:\n${txErr.logs.join('\n')}` : '';
      await db.addLog('SETTLEMENT_FAILED', 'ERROR', `On-chain USDC transfer failed for Reorder ${reorderId}: ${txErr.message}`, {
        reorderId,
        amountUsdc,
        error: txErr.message
      });
      throw new Error(`On-chain USDC transfer failed: ${txErr.message}${logs}`);
    }

    // 5. Confirm the supplier actually received the funds.
    const recipientBalanceAfter = await this.getTokenBalance(recipientKey);
    const parsedTx = await this.connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0
    });

    const explorerUrl = `https://explorer.solana.com/tx/${signature}?cluster=${CONFIG.SOLANA_NETWORK}`;

    await db.addLog('SETTLEMENT_EXECUTED', 'SUCCESS', `${amountUsdc} USDC settled on-chain to supplier for Reorder ${reorderId}`, {
      reorderId,
      amountUsdc,
      amountNgn,
      signature,
      explorerUrl,
      mint: this.usdcMintPublicKey.toBase58(),
      recipientTokenAccount: recipientAta.toBase58(),
      recipientBalanceBefore,
      recipientBalanceAfter
    });

    console.log(`[Solana] Settled. Supplier USDC ${recipientBalanceBefore} -> ${recipientBalanceAfter}`);
    console.log(`[Solana] ${explorerUrl}`);

    return {
      signature,
      explorerUrl,
      blockTime: parsedTx?.blockTime ?? undefined,
      slot: parsedTx?.slot,
      amountUsdc,
      amountNgn,
      recipientPublicKey: recipientKey.toBase58(),
      senderPublicKey: this.merchantKeypair.publicKey.toBase58(),
      mintAddress: this.usdcMintPublicKey.toBase58(),
      recipientTokenAccount: recipientAta.toBase58(),
      recipientBalanceBefore,
      recipientBalanceAfter
    };
  }
}

export const solanaService = new SolanaService();
