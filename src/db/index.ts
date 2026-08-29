import Database from 'better-sqlite3';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index.js';

export interface Merchant {
  id: string;
  name: string;
  business_name?: string;
  email: string;
  password_hash?: string;
  phone?: string;
  country?: string;
  currency?: string;
  solana_public_key: string;
  telegram_chat_id?: string;
  usdc_balance?: number;
  ngn_balance?: number;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  email: string;
  phone: string;
  country: string;
  corridor_currency: string;
  solana_public_key: string;
  bank_name: string;
  bank_account_number: string;
  bank_account_name: string;
  settlement_rail: string;
  category?: string;
  kyc_status?: 'VERIFIED' | 'PENDING' | 'COMING_SOON';
  password_hash?: string;
  is_registered_user?: number;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  description: string;
  current_stock: number;
  min_threshold: number;
  reorder_quantity: number;
  unit_cost_usdc: number;
  supplier_id: string;
  image_url?: string;
  updated_at: string;
}

export interface ReorderRequest {
  id: string;
  product_id: string;
  supplier_id: string;
  quantity: number;
  unit_cost_usdc: number;
  total_usdc: number;
  fx_rate_ngn: number;
  total_ngn: number;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EXECUTING' | 'COMPLETED' | 'FAILED';
  trigger_reason: string;
  solana_tx_signature?: string;
  solana_explorer_url?: string;
  approval_channel?: string;
  approved_at?: string;
  completed_at?: string;
  error_message?: string;
  created_at: string;
  // Join fields
  product_name?: string;
  product_sku?: string;
  supplier_name?: string;
  supplier_bank_name?: string;
  supplier_bank_account?: string;
}

export interface AgentLog {
  id: string;
  event_type: string;
  severity: 'INFO' | 'WARN' | 'ACTION' | 'ERROR' | 'SUCCESS';
  message: string;
  metadata_json?: string;
  created_at: string;
}

class DatabaseManager {
  private sqliteDb: Database.Database | null = null;
  private pgPool: pg.Pool | null = null;
  public isPostgres = false;

  public async init() {
    if (CONFIG.DATABASE_URL && CONFIG.DATABASE_URL.startsWith('postgres')) {
      console.log('Connecting to PostgreSQL database...');
      this.pgPool = new pg.Pool({ connectionString: CONFIG.DATABASE_URL });
      this.isPostgres = true;
      await this.initPostgresSchema();
    } else {
      const dbDir = path.dirname(CONFIG.DATABASE_FILE);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      this.sqliteDb = new Database(CONFIG.DATABASE_FILE);
      this.sqliteDb.pragma('journal_mode = WAL');
      await this.initSqliteSchema();
    }
  }

  private async query(sql: string, params: any[] = []): Promise<any[]> {
    if (this.isPostgres && this.pgPool) {
      let i = 1;
      const pgSql = sql.replace(/\?/g, () => `$${i++}`);
      const result = await this.pgPool.query(pgSql, params);
      return result.rows;
    } else if (this.sqliteDb) {
      const stmt = this.sqliteDb.prepare(sql);
      const upperSql = sql.trim().toUpperCase();
      if (upperSql.startsWith('SELECT') || upperSql.startsWith('PRAGMA') || upperSql.startsWith('WITH')) {
        return stmt.all(...params);
      } else {
        stmt.run(...params);
        return [];
      }
    }
    return [];
  }

  private async initSqliteSchema() {
    if (!this.sqliteDb) return;

    this.sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS merchants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        business_name TEXT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        phone TEXT,
        country TEXT DEFAULT 'Ghana',
        currency TEXT DEFAULT 'USD',
        solana_public_key TEXT NOT NULL,
        telegram_chat_id TEXT,
        usdc_balance REAL DEFAULT 0.00,
        ngn_balance REAL DEFAULT 0.00,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS suppliers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        country TEXT NOT NULL DEFAULT 'Nigeria',
        corridor_currency TEXT NOT NULL DEFAULT 'NGN',
        solana_public_key TEXT NOT NULL,
        bank_name TEXT NOT NULL,
        bank_account_number TEXT NOT NULL,
        bank_account_name TEXT NOT NULL,
        settlement_rail TEXT NOT NULL DEFAULT 'Solana_USDC_to_NGN_Instant',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sku TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        description TEXT,
        current_stock INTEGER NOT NULL,
        min_threshold INTEGER NOT NULL,
        reorder_quantity INTEGER NOT NULL,
        unit_cost_usdc REAL NOT NULL,
        supplier_id TEXT NOT NULL,
        image_url TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (supplier_id) REFERENCES suppliers (id)
      );

      CREATE TABLE IF NOT EXISTS reorder_requests (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        supplier_id TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_cost_usdc REAL NOT NULL,
        total_usdc REAL NOT NULL,
        fx_rate_ngn REAL NOT NULL,
        total_ngn REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
        trigger_reason TEXT,
        solana_tx_signature TEXT,
        solana_explorer_url TEXT,
        approval_channel TEXT,
        approved_at TEXT,
        completed_at TEXT,
        error_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products (id),
        FOREIGN KEY (supplier_id) REFERENCES suppliers (id)
      );

      CREATE TABLE IF NOT EXISTS agent_logs (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'INFO',
        message TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Auto-migrate new columns if missing
    try {
      this.sqliteDb.exec(`ALTER TABLE merchants ADD COLUMN business_name TEXT;`);
    } catch (e) {}
    try {
      this.sqliteDb.exec(`ALTER TABLE merchants ADD COLUMN password_hash TEXT;`);
    } catch (e) {}
    try {
      this.sqliteDb.exec(`ALTER TABLE merchants ADD COLUMN country TEXT DEFAULT 'Ghana';`);
    } catch (e) {}
    try {
      this.sqliteDb.exec(`ALTER TABLE merchants ADD COLUMN currency TEXT DEFAULT 'USD';`);
    } catch (e) {}
    try {
      this.sqliteDb.exec(`ALTER TABLE merchants ADD COLUMN usdc_balance REAL DEFAULT 0.00;`);
    } catch (e) {}
    try {
      this.sqliteDb.exec(`ALTER TABLE merchants ADD COLUMN ngn_balance REAL DEFAULT 0.00;`);
    } catch (e) {}

    await this.seedDefaultData();
  }

  private async initPostgresSchema() {
    if (!this.pgPool) return;
    const client = await this.pgPool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS merchants (
          id VARCHAR(64) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          business_name VARCHAR(255),
          email VARCHAR(255) NOT NULL UNIQUE,
          password_hash VARCHAR(255),
          phone VARCHAR(64),
          country VARCHAR(64) DEFAULT 'Ghana',
          currency VARCHAR(64) DEFAULT 'USD',
          solana_public_key VARCHAR(128) NOT NULL,
          telegram_chat_id VARCHAR(128),
          usdc_balance NUMERIC(16, 2) DEFAULT 0.00,
          ngn_balance NUMERIC(16, 2) DEFAULT 0.00,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS suppliers (
          id VARCHAR(64) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) NOT NULL,
          phone VARCHAR(64),
          country VARCHAR(64) NOT NULL DEFAULT 'Nigeria',
          corridor_currency VARCHAR(16) NOT NULL DEFAULT 'NGN',
          solana_public_key VARCHAR(128) NOT NULL,
          bank_name VARCHAR(255) NOT NULL,
          bank_account_number VARCHAR(64) NOT NULL,
          bank_account_name VARCHAR(255) NOT NULL,
          settlement_rail VARCHAR(128) NOT NULL DEFAULT 'Solana_USDC_to_NGN_Instant',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS products (
          id VARCHAR(64) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          sku VARCHAR(64) NOT NULL UNIQUE,
          category VARCHAR(128) NOT NULL,
          description TEXT,
          current_stock INTEGER NOT NULL,
          min_threshold INTEGER NOT NULL,
          reorder_quantity INTEGER NOT NULL,
          unit_cost_usdc NUMERIC(12, 2) NOT NULL,
          supplier_id VARCHAR(64) NOT NULL REFERENCES suppliers (id),
          image_url TEXT,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS reorder_requests (
          id VARCHAR(64) PRIMARY KEY,
          product_id VARCHAR(64) NOT NULL REFERENCES products (id),
          supplier_id VARCHAR(64) NOT NULL REFERENCES suppliers (id),
          quantity INTEGER NOT NULL,
          unit_cost_usdc NUMERIC(12, 2) NOT NULL,
          total_usdc NUMERIC(12, 2) NOT NULL,
          fx_rate_ngn NUMERIC(12, 2) NOT NULL,
          total_ngn NUMERIC(14, 2) NOT NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'PENDING_APPROVAL',
          trigger_reason TEXT,
          solana_tx_signature VARCHAR(255),
          solana_explorer_url TEXT,
          approval_channel VARCHAR(64),
          approved_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          error_message TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS agent_logs (
          id VARCHAR(64) PRIMARY KEY,
          event_type VARCHAR(64) NOT NULL,
          severity VARCHAR(16) NOT NULL DEFAULT 'INFO',
          message TEXT NOT NULL,
          metadata_json TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS app_settings (
          key VARCHAR(64) PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      // Auto-migrate new columns for Postgres if missing
      try {
        await client.query(`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS usdc_balance NUMERIC(16, 2) DEFAULT 0.00;`);
      } catch (e) {}
      try {
        await client.query(`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS ngn_balance NUMERIC(16, 2) DEFAULT 0.00;`);
      } catch (e) {}

      await this.seedDefaultData();
    } finally {
      client.release();
    }
  }

  private async seedDefaultData() {
    const suppliers = await this.query('SELECT COUNT(*) as count FROM suppliers');
    const supplierCount = Number(suppliers[0]?.count || 0);

    if (supplierCount === 0) {
      const now = new Date().toISOString();
      // Seed default merchant
      await this.query(`
        INSERT INTO merchants (id, name, email, phone, solana_public_key, telegram_chat_id, usdc_balance, ngn_balance, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        'merch_01',
        'Kofi Retail Electronics',
        'kofi.electronics@accra-hub.com',
        '+233 24 123 4567',
        'Awa1tingIn1t1al1zat1onMerchantKey111111111',
        CONFIG.TELEGRAM_CHAT_ID || '123456789',
        0.00,
        0.00,
        now
      ]);

      // Seed default primary supplier in Nigeria (NGN corridor)
      await this.query(`
        INSERT INTO suppliers (id, name, email, phone, country, corridor_currency, solana_public_key, bank_name, bank_account_number, bank_account_name, settlement_rail, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        'supp_ng_01',
        'Lagos Prime Wholesale & Tech Distributors',
        'orders@lagosprimetech.ng',
        '+234 803 555 0199',
        'Nigeria',
        'NGN',
        'Awa1tingIn1t1al1zat1onSupplierKey111111111',
        'Access Bank Nigeria Plc',
        '0123987654',
        'Lagos Prime Wholesale Tech Ltd',
        'Solana_USDC_to_NGN_Instant',
        now
      ]);

      // Seed flagship tracked product for the SME
      await this.query(`
        INSERT INTO products (id, name, sku, category, description, current_stock, min_threshold, reorder_quantity, unit_cost_usdc, supplier_id, image_url, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        'prod_01',
        'Samsung 25W Type-C Super Fast Charger',
        'SAM-25W-FAST-CHG',
        'Mobile Accessories',
        'High-turnover OEM fast charging adapter with high velocity sales.',
        8, // Stock starts below threshold (12)
        12, // Min threshold
        50, // Reorder quantity
        5.00, // $5.00 unit cost = $250.00 order
        'supp_ng_01',
        '/static/img/product_charger.png',
        now
      ]);

      // Seed additional product for rich catalog
      await this.query(`
        INSERT INTO products (id, name, sku, category, description, current_stock, min_threshold, reorder_quantity, unit_cost_usdc, supplier_id, image_url, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        'prod_02',
        'Anker PowerCore 20000mAh Power Bank',
        'ANK-PWR-20K',
        'Power & Batteries',
        'Heavy duty portable backup battery for high customer demand.',
        25,
        15,
        30,
        18.50,
        'supp_ng_01',
        '/static/img/product_powerbank.png',
        now
      ]);

      // Log initialization
      await this.addLog('SYSTEM_INIT', 'SUCCESS', 'Settle Agent database initialized with SME products & Lagos NGN supplier corridor.');
    }
  }

  public getDb(): Database.Database {
    if (!this.sqliteDb) {
      throw new Error('Database not initialized or running in PostgreSQL mode');
    }
    return this.sqliteDb;
  }

  public async addLog(eventType: string, severity: 'INFO' | 'WARN' | 'ACTION' | 'ERROR' | 'SUCCESS', message: string, metadata?: Record<string, any>) {
    const id = `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const metadataJson = metadata ? JSON.stringify(metadata) : null;
    const now = new Date().toISOString();

    await this.query(`
      INSERT INTO agent_logs (id, event_type, severity, message, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, eventType, severity, message, metadataJson, now]);
  }

  public async getRecentLogs(limit = 30): Promise<AgentLog[]> {
    const rows = await this.query('SELECT * FROM agent_logs ORDER BY created_at DESC LIMIT ?', [limit]);
    return rows as AgentLog[];
  }

  public async getProducts(): Promise<(Product & { supplier_name: string })[]> {
    const rows = await this.query(`
      SELECT p.*, s.name as supplier_name 
      FROM products p 
      JOIN suppliers s ON p.supplier_id = s.id 
      ORDER BY p.name ASC
    `);
    return rows.map((p: any) => ({
      ...p,
      current_stock: Number(p.current_stock),
      min_threshold: Number(p.min_threshold),
      reorder_quantity: Number(p.reorder_quantity),
      unit_cost_usdc: Number(p.unit_cost_usdc)
    })) as (Product & { supplier_name: string })[];
  }

  public async getProductById(id: string): Promise<(Product & { supplier_name: string }) | undefined> {
    const rows = await this.query(`
      SELECT p.*, s.name as supplier_name 
      FROM products p 
      JOIN suppliers s ON p.supplier_id = s.id 
      WHERE p.id = ?
    `, [id]);
    const p = rows[0];
    if (!p) return undefined;
    return {
      ...p,
      current_stock: Number(p.current_stock),
      min_threshold: Number(p.min_threshold),
      reorder_quantity: Number(p.reorder_quantity),
      unit_cost_usdc: Number(p.unit_cost_usdc)
    } as (Product & { supplier_name: string });
  }

  public async updateProductStock(id: string, newStock: number) {
    await this.query('UPDATE products SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newStock, id]);
  }

  public async updateProductField(id: string, field: string, value: any) {
    const allowedFields = ['min_threshold', 'reorder_quantity', 'unit_cost_usdc', 'current_stock'];
    if (!allowedFields.includes(field)) {
      throw new Error(`Invalid field update: ${field}`);
    }
    await this.query(`UPDATE products SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [value, id]);
  }

  public async createProduct(data: Omit<Product, 'updated_at'>): Promise<Product> {
    const now = new Date().toISOString();
    const fullProduct: Product = {
      ...data,
      updated_at: now
    };

    await this.query(`
      INSERT INTO products (id, name, sku, category, description, current_stock, min_threshold, reorder_quantity, unit_cost_usdc, supplier_id, image_url, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      fullProduct.id,
      fullProduct.name,
      fullProduct.sku,
      fullProduct.category,
      fullProduct.description || '',
      fullProduct.current_stock,
      fullProduct.min_threshold,
      fullProduct.reorder_quantity,
      fullProduct.unit_cost_usdc,
      fullProduct.supplier_id,
      fullProduct.image_url || '/static/img/product_charger.png',
      now
    ]);

    return fullProduct;
  }

  public async getSupplierById(id: string): Promise<Supplier | undefined> {
    const rows = await this.query('SELECT * FROM suppliers WHERE id = ?', [id]);
    return rows[0] as Supplier | undefined;
  }

  public async getAllSuppliers(searchQuery?: string, country?: string): Promise<Supplier[]> {
    let query = 'SELECT * FROM suppliers WHERE 1=1';
    const params: any[] = [];

    if (searchQuery && searchQuery.trim()) {
      query += ' AND (LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(bank_name) LIKE ?)';
      const term = `%${searchQuery.trim().toLowerCase()}%`;
      params.push(term, term, term);
    }

    if (country && country !== 'ALL') {
      query += ' AND LOWER(country) = LOWER(?)';
      params.push(country);
    }

    query += ' ORDER BY name ASC';
    const rows = await this.query(query, params);
    return rows as Supplier[];
  }

  public async getSupplierByEmail(email: string): Promise<Supplier | undefined> {
    const rows = await this.query('SELECT * FROM suppliers WHERE LOWER(email) = LOWER(?)', [email]);
    return rows[0] as Supplier | undefined;
  }

  public async createSupplier(data: Omit<Supplier, 'created_at'>): Promise<Supplier> {
    const now = new Date().toISOString();
    let defaultKyc: 'VERIFIED' | 'COMING_SOON' = data.country.toLowerCase() === 'nigeria' ? 'VERIFIED' : 'COMING_SOON';
    
    const fullSupplier: Supplier = {
      ...data,
      category: data.category || 'Electronics & Wholesale Spares',
      kyc_status: data.kyc_status || defaultKyc,
      created_at: now
    };

    await this.query(`
      INSERT INTO suppliers (id, name, email, phone, country, corridor_currency, solana_public_key, bank_name, bank_account_number, bank_account_name, settlement_rail, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      fullSupplier.id,
      fullSupplier.name,
      fullSupplier.email,
      fullSupplier.phone,
      fullSupplier.country,
      fullSupplier.corridor_currency,
      fullSupplier.solana_public_key,
      fullSupplier.bank_name,
      fullSupplier.bank_account_number,
      fullSupplier.bank_account_name,
      fullSupplier.settlement_rail,
      now
    ]);

    return fullSupplier;
  }

  public async getMerchant(): Promise<Merchant | undefined> {
    const rows = await this.query('SELECT * FROM merchants LIMIT 1');
    return rows[0] as Merchant | undefined;
  }

  public async getMerchantById(id: string): Promise<Merchant | undefined> {
    const rows = await this.query('SELECT * FROM merchants WHERE id = ?', [id]);
    return rows[0] as Merchant | undefined;
  }

  public async getMerchantByEmail(email: string): Promise<Merchant | undefined> {
    const rows = await this.query('SELECT * FROM merchants WHERE LOWER(email) = LOWER(?)', [email]);
    return rows[0] as Merchant | undefined;
  }

  public async createMerchant(data: Omit<Merchant, 'created_at'>): Promise<Merchant> {
    const now = new Date().toISOString();
    const fullMerchant: Merchant = {
      ...data,
      usdc_balance: data.usdc_balance ?? 0.00,
      ngn_balance: data.ngn_balance ?? 0.00,
      created_at: now
    };

    await this.query(`
      INSERT INTO merchants (id, name, business_name, email, password_hash, phone, country, currency, solana_public_key, telegram_chat_id, usdc_balance, ngn_balance, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      fullMerchant.id,
      fullMerchant.name,
      fullMerchant.business_name || fullMerchant.name,
      fullMerchant.email,
      fullMerchant.password_hash || null,
      fullMerchant.phone || null,
      fullMerchant.country || 'Ghana',
      fullMerchant.currency || 'USD',
      fullMerchant.solana_public_key,
      fullMerchant.telegram_chat_id || null,
      fullMerchant.usdc_balance,
      fullMerchant.ngn_balance,
      fullMerchant.created_at
    ]);

    return fullMerchant;
  }

  public async updateMerchantBalances(merchantId: string, usdcDelta: number, ngnDelta: number) {
    const m = await this.getMerchantById(merchantId);
    if (m) {
      const newUsdc = Number(m.usdc_balance || 0) + usdcDelta;
      const newNgn = Number(m.ngn_balance || 0) + ngnDelta;
      await this.query('UPDATE merchants SET usdc_balance = ?, ngn_balance = ? WHERE id = ?', [newUsdc, newNgn, m.id]);
    }
  }

  public async updateMerchantPublicKey(publicKey: string) {
    const m = await this.getMerchant();
    if (m) {
      await this.query('UPDATE merchants SET solana_public_key = ? WHERE id = ?', [publicKey, m.id]);
    }
  }

  public async updateSupplierPublicKey(supplierId: string, publicKey: string) {
    await this.query('UPDATE suppliers SET solana_public_key = ? WHERE id = ?', [publicKey, supplierId]);
  }

  public async createReorderRequest(data: Omit<ReorderRequest, 'created_at'>): Promise<ReorderRequest> {
    const now = new Date().toISOString();
    const fullData: ReorderRequest = { ...data, created_at: now };

    await this.query(`
      INSERT INTO reorder_requests (
        id, product_id, supplier_id, quantity, unit_cost_usdc, total_usdc,
        fx_rate_ngn, total_ngn, status, trigger_reason, solana_tx_signature,
        solana_explorer_url, approval_channel, approved_at, completed_at, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      fullData.id,
      fullData.product_id,
      fullData.supplier_id,
      fullData.quantity,
      fullData.unit_cost_usdc,
      fullData.total_usdc,
      fullData.fx_rate_ngn,
      fullData.total_ngn,
      fullData.status,
      fullData.trigger_reason,
      fullData.solana_tx_signature || null,
      fullData.solana_explorer_url || null,
      fullData.approval_channel || null,
      fullData.approved_at || null,
      fullData.completed_at || null,
      fullData.error_message || null,
      fullData.created_at
    ]);

    return fullData;
  }

  public async getReorderRequestById(id: string): Promise<ReorderRequest | undefined> {
    const rows = await this.query(`
      SELECT r.*, p.name as product_name, p.sku as product_sku, s.name as supplier_name,
             s.bank_name as supplier_bank_name, s.bank_account_number as supplier_bank_account
      FROM reorder_requests r
      JOIN products p ON r.product_id = p.id
      JOIN suppliers s ON r.supplier_id = s.id
      WHERE r.id = ?
    `, [id]);
    const r = rows[0];
    if (!r) return undefined;
    return {
      ...r,
      quantity: Number(r.quantity),
      unit_cost_usdc: Number(r.unit_cost_usdc),
      total_usdc: Number(r.total_usdc),
      fx_rate_ngn: Number(r.fx_rate_ngn),
      total_ngn: Number(r.total_ngn)
    } as ReorderRequest;
  }

  public async getPendingReorders(): Promise<ReorderRequest[]> {
    const rows = await this.query(`
      SELECT r.*, p.name as product_name, p.sku as product_sku, s.name as supplier_name,
             s.bank_name as supplier_bank_name, s.bank_account_number as supplier_bank_account
      FROM reorder_requests r
      JOIN products p ON r.product_id = p.id
      JOIN suppliers s ON r.supplier_id = s.id
      WHERE r.status = 'PENDING_APPROVAL'
      ORDER BY r.created_at DESC
    `);
    return rows.map((r: any) => ({
      ...r,
      quantity: Number(r.quantity),
      unit_cost_usdc: Number(r.unit_cost_usdc),
      total_usdc: Number(r.total_usdc),
      fx_rate_ngn: Number(r.fx_rate_ngn),
      total_ngn: Number(r.total_ngn)
    })) as ReorderRequest[];
  }

  public async getAllReorders(limit = 50): Promise<ReorderRequest[]> {
    const rows = await this.query(`
      SELECT r.*, p.name as product_name, p.sku as product_sku, s.name as supplier_name,
             s.bank_name as supplier_bank_name, s.bank_account_number as supplier_bank_account
      FROM reorder_requests r
      JOIN products p ON r.product_id = p.id
      JOIN suppliers s ON r.supplier_id = s.id
      ORDER BY r.created_at DESC
      LIMIT ?
    `, [limit]);
    return rows.map((r: any) => ({
      ...r,
      quantity: Number(r.quantity),
      unit_cost_usdc: Number(r.unit_cost_usdc),
      total_usdc: Number(r.total_usdc),
      fx_rate_ngn: Number(r.fx_rate_ngn),
      total_ngn: Number(r.total_ngn)
    })) as ReorderRequest[];
  }

  public async updateReorderStatus(id: string, updates: Partial<ReorderRequest>) {
    const fields: string[] = [];
    const values: any[] = [];

    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
    values.push(id);

    const query = `UPDATE reorder_requests SET ${fields.join(', ')} WHERE id = ?`;
    await this.query(query, values);
  }

  public async getStats(isLive?: boolean) {
    const filterCompleted = isLive 
      ? "status = 'COMPLETED' AND (error_message IS NULL OR error_message != 'SOLANA_FAUCET_RATE_LIMITED')"
      : "status = 'COMPLETED'";

    const resTotals = await this.query(`
      SELECT 
        COUNT(CASE WHEN ${filterCompleted} THEN 1 END) as completed_count,
        COALESCE(SUM(CASE WHEN ${filterCompleted} THEN total_usdc ELSE 0 END), 0) as total_volume_usdc,
        COUNT(CASE WHEN status = 'PENDING_APPROVAL' THEN 1 END) as pending_count
      FROM reorder_requests
    `);
    const totals = resTotals[0] || { completed_count: 0, total_volume_usdc: 0, pending_count: 0 };
    
    const resProdCount = await this.query('SELECT COUNT(*) as count FROM products');
    const productCount = Number(resProdCount[0]?.count || 0);

    const totalVolumeUsdc = Number(totals.total_volume_usdc || 0);
    const completedCount = Number(totals.completed_count || 0);
    const pendingCount = Number(totals.pending_count || 0);

    const savedFeesUsdc = totalVolumeUsdc * CONFIG.TRADITIONAL_WIRE_FEE_PERCENT;
    const savedHours = completedCount * (CONFIG.TRADITIONAL_SETTLEMENT_DAYS * 24);

    return {
      totalRestocks: completedCount,
      volumeSettledUsdc: Number(totalVolumeUsdc.toFixed(2)),
      volumeSettledNgn: Number((totalVolumeUsdc * CONFIG.DEFAULT_USDC_NGN_RATE).toFixed(2)),
      feeSavingsUsdc: Number(savedFeesUsdc.toFixed(2)),
      settlementTimeSavedHours: savedHours,
      pendingApprovals: pendingCount,
      productsTracked: productCount
    };
  }
}

export const db = new DatabaseManager();
