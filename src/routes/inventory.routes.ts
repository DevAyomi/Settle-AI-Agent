import { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { agentService } from '../services/agent.service.js';
import { fxService } from '../services/fx.service.js';

export async function inventoryRoutes(fastify: FastifyInstance) {
  // Get all inventory products
  fastify.get('/api/inventory', async (request, reply) => {
    const products = await db.getProducts();
    return reply.send({ success: true, count: products.length, products });
  });

  // Create / Add New Inventory Product
  fastify.post<{
    Body: {
      name: string;
      sku: string;
      category?: string;
      description?: string;
      currentStock: number;
      minThreshold: number;
      reorderQuantity: number;
      unitCostUsdc: number;
      supplierId?: string;
    };
  }>('/api/inventory', async (request, reply) => {
    try {
      const { name, sku, category = 'General Goods', description = '', currentStock = 50, minThreshold = 15, reorderQuantity = 40, unitCostUsdc = 10, supplierId } = request.body || {};

      if (!name || !sku) {
        return reply.status(400).send({ success: false, error: 'Product name and SKU are required' });
      }

      // Check if SKU already exists
      const existing = (await db.getProducts()).find(p => p.sku.toLowerCase() === sku.toLowerCase());
      if (existing) {
        return reply.status(400).send({ success: false, error: `SKU '${sku}' already exists` });
      }

      const suppliers = await db.getAllSuppliers();
      const finalSupplierId = supplierId || (suppliers[0] ? suppliers[0].id : 'supp_ng_01');

      const newId = `prod_${Date.now().toString(36)}`;
      const created = await db.createProduct({
        id: newId,
        name,
        sku: sku.toUpperCase(),
        category,
        description,
        current_stock: Number(currentStock),
        min_threshold: Number(minThreshold),
        reorder_quantity: Number(reorderQuantity),
        unit_cost_usdc: Number(unitCostUsdc),
        supplier_id: finalSupplierId,
        image_url: '/static/img/product_charger.png'
      });

      await db.addLog('INVENTORY_CREATED', 'INFO', `Added new product to inventory: ${created.name} (${created.sku}) with ${created.current_stock} initial units. Threshold: ${created.min_threshold}`, {
        productId: created.id,
        sku: created.sku,
        unitCostUsdc: created.unit_cost_usdc
      });

      // Run agent scan
      await agentService.scanInventory();

      return reply.send({
        success: true,
        message: 'Product added successfully',
        product: await db.getProductById(created.id)
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // Simulate customer sale / stock reduction (triggers Settle Agent)
  fastify.post<{
    Body: { productId: string; quantity: number };
  }>('/api/inventory/sell', async (request, reply) => {
    const { productId, quantity = 1 } = request.body || {};
    if (!productId) {
      return reply.status(400).send({ error: 'productId is required' });
    }

    const product = await db.getProductById(productId);
    if (!product) {
      return reply.status(404).send({ error: 'Product not found' });
    }

    const newStock = Math.max(0, product.current_stock - quantity);
    await db.updateProductStock(productId, newStock);

    // Calculate revenue with 30% markup and convert to NGN
    const retailPriceUsdc = product.unit_cost_usdc * 1.30;
    const totalUsdcRevenue = retailPriceUsdc * quantity;
    const quote = fxService.getQuote(totalUsdcRevenue);
    const totalNgnRevenue = Math.round(totalUsdcRevenue * quote.rate);

    // Add sales revenue to merchant's database NGN balance
    const m = await db.getMerchant();
    if (m) {
      await db.updateMerchantBalances(m.id, 0, totalNgnRevenue);
    }

    await db.addLog('STOCK_SALE', 'INFO', `Simulated customer purchase: Sold ${quantity} unit(s) of ${product.name} for ₦${totalNgnRevenue.toLocaleString()} NGN ($${totalUsdcRevenue.toFixed(2)} USDC equiv). New stock: ${newStock}`, {
      productId,
      quantitySold: quantity,
      previousStock: product.current_stock,
      newStock,
      revenueNgn: totalNgnRevenue,
      revenueUsdc: totalUsdcRevenue
    });

    // Run agent scan to check if threshold breached
    const scanResult = await agentService.scanInventory();

    return reply.send({
      success: true,
      product: await db.getProductById(productId),
      triggeredReorder: scanResult.triggered > 0,
      proposals: scanResult.proposals
    });
  });

  // Direct stock update or threshold tuning
  fastify.post<{
    Body: {
      productId: string;
      currentStock?: number;
      minThreshold?: number;
      reorderQuantity?: number;
      unitCostUsdc?: number;
    };
  }>('/api/inventory/update', async (request, reply) => {
    const { productId, currentStock, minThreshold, reorderQuantity, unitCostUsdc } = request.body || {};
    if (!productId) {
      return reply.status(400).send({ error: 'productId is required' });
    }

    const product = await db.getProductById(productId);
    if (!product) {
      return reply.status(404).send({ error: 'Product not found' });
    }

    if (currentStock !== undefined) {
      await db.updateProductStock(productId, currentStock);
    }
    if (minThreshold !== undefined) {
      await db.updateProductField(productId, 'min_threshold', minThreshold);
    }
    if (reorderQuantity !== undefined) {
      await db.updateProductField(productId, 'reorder_quantity', reorderQuantity);
    }
    if (unitCostUsdc !== undefined) {
      await db.updateProductField(productId, 'unit_cost_usdc', unitCostUsdc);
    }

    // Check inventory
    await agentService.scanInventory();

    return reply.send({
      success: true,
      product: await db.getProductById(productId)
    });
  });
}
