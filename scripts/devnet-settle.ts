/**
 * Devnet proof script for the USDC settlement flow.
 *
 *   npm run devnet:mint      -> create an app-managed 6-decimal test USDC mint
 *   npm run devnet:fund      -> mint test USDC into the merchant treasury
 *   npm run devnet:settle    -> run a real on-chain USDC payout to the supplier
 *
 * With USDC_MINT_ADDRESS pointed at Circle devnet USDC (funded via
 * https://faucet.circle.com), only `devnet:settle` applies - the mint and fund
 * steps require a mint this app controls.
 */
import { solanaService } from '../src/services/solana.service.js';
import { CONFIG } from '../src/config/index.js';

const command = process.argv[2];
const arg = process.argv[3];

async function main() {
  console.log(`Network:  ${CONFIG.SOLANA_NETWORK}`);
  console.log(`RPC:      ${CONFIG.SOLANA_RPC_URL}`);
  console.log(`Mint:     ${solanaService.getUsdcMintAddress()}`);
  console.log(`Merchant: ${solanaService.getMerchantPublicKey()}`);
  console.log(`Supplier: ${solanaService.getSupplierPublicKey()}\n`);

  switch (command) {
    case 'mint': {
      const mint = await solanaService.ensureDevnetUsdcMint();
      console.log(`Created devnet test USDC mint: ${mint}`);
      console.log(`\nAdd this to your .env, then re-run:\n  USDC_MINT_ADDRESS=${mint}`);
      break;
    }

    case 'fund': {
      const amount = Number(arg || 10000);
      const sig = await solanaService.mintTestUsdc(amount);
      console.log(`Minted ${amount} USDC to merchant treasury.`);
      console.log(`https://explorer.solana.com/tx/${sig}?cluster=${CONFIG.SOLANA_NETWORK}`);
      break;
    }

    case 'settle': {
      const amount = Number(arg || 250);
      const before = await solanaService.getBalances(undefined, true);
      console.log(`Before -> merchant ${before.merchant.usdcBalance} USDC | supplier ${before.supplier.usdcBalance} USDC\n`);

      const result = await solanaService.executeUsdcSettlement(
        `devnet-proof-${Date.now()}`,
        amount,
        Math.round(amount * CONFIG.DEFAULT_USDC_NGN_RATE)
      );

      console.log('\n=== SETTLEMENT CONFIRMED ON DEVNET ===');
      console.log(`Signature:        ${result.signature}`);
      console.log(`Explorer:         ${result.explorerUrl}`);
      console.log(`Slot:             ${result.slot}`);
      console.log(`Mint:             ${result.mintAddress}`);
      console.log(`Sender:           ${result.senderPublicKey}`);
      console.log(`Recipient:        ${result.recipientPublicKey}`);
      console.log(`Recipient ATA:    ${result.recipientTokenAccount}`);
      console.log(`Supplier balance: ${result.recipientBalanceBefore} -> ${result.recipientBalanceAfter} USDC`);
      break;
    }

    default:
      console.log('Usage: tsx scripts/devnet-settle.ts <mint|fund|settle> [amount]');
      process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFAILED:', err.message);
    process.exit(1);
  });
