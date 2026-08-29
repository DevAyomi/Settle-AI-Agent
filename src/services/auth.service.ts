import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Keypair } from '@solana/web3.js';
import { CONFIG } from '../config/index.js';
import { db, Merchant, Supplier } from '../db/index.js';

export interface AuthTokenPayload {
  merchantId: string;
  email: string;
  businessName: string;
}

export interface RegisterDTO {
  name: string;
  businessName: string;
  email: string;
  password: string;
  phone?: string;
  country?: string;
  currency?: string;
}

export class AuthService {
  private saltRounds = 10;

  public async hashPassword(password: string): Promise<string> {
    return await bcrypt.hash(password, this.saltRounds);
  }

  public async verifyPassword(password: string, hash: string): Promise<boolean> {
    return await bcrypt.compare(password, hash);
  }

  public generateToken(merchant: Merchant): string {
    const payload: AuthTokenPayload = {
      merchantId: merchant.id,
      email: merchant.email,
      businessName: merchant.business_name || merchant.name
    };
    return jwt.sign(payload, CONFIG.JWT_SECRET, { expiresIn: '7d' });
  }

  public verifyToken(token: string): AuthTokenPayload | null {
    try {
      return jwt.verify(token, CONFIG.JWT_SECRET) as AuthTokenPayload;
    } catch (e) {
      return null;
    }
  }

  public async register(data: RegisterDTO): Promise<{ merchant: Omit<Merchant, 'password_hash'>; token: string; solanaPublicKey: string }> {
    const cleanEmail = data.email.toLowerCase().trim();
    const existing = await db.getMerchantByEmail(cleanEmail);
    if (existing) {
      throw new Error('A merchant account with this email already exists.');
    }

    const passwordHash = await this.hashPassword(data.password);
    
    // Generate dedicated non-custodial Solana wallet for the merchant
    const newKeypair = Keypair.generate();
    const solanaPublicKey = newKeypair.publicKey.toBase58();

    const merchantId = `merch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newMerchant = await db.createMerchant({
      id: merchantId,
      name: data.name,
      business_name: data.businessName || data.name,
      email: cleanEmail,
      password_hash: passwordHash,
      phone: data.phone || '',
      country: data.country || 'Ghana',
      currency: data.currency || 'USD',
      solana_public_key: solanaPublicKey,
      telegram_chat_id: CONFIG.TELEGRAM_CHAT_ID || ''
    });

    const token = this.generateToken(newMerchant);
    const { password_hash, ...safeMerchant } = newMerchant;

    await db.addLog('AUTH_REGISTER', 'SUCCESS', `New merchant registered: ${safeMerchant.business_name} (${safeMerchant.email})`, {
      merchantId: safeMerchant.id,
      solanaPublicKey
    });

    return { merchant: safeMerchant, token, solanaPublicKey };
  }

  public async login(email: string, password: string): Promise<{ merchant: Omit<Merchant, 'password_hash'>; token: string }> {
    const cleanEmail = email.toLowerCase().trim();

    const merchant = await db.getMerchantByEmail(cleanEmail);
    if (!merchant) {
      throw new Error('Invalid email or password.');
    }

    if (merchant.password_hash) {
      const isValid = await this.verifyPassword(password, merchant.password_hash);
      if (!isValid) throw new Error('Invalid email or password.');
    }

    const token = this.generateToken(merchant);
    const { password_hash, ...safeMerchant } = merchant;

    await db.addLog('AUTH_LOGIN', 'INFO', `Merchant logged in: ${safeMerchant.business_name || safeMerchant.name}`, {
      merchantId: safeMerchant.id
    });

    return { merchant: safeMerchant, token };
  }

  public async getDemoMerchant(): Promise<{ merchant: Omit<Merchant, 'password_hash'>; token: string }> {
    let merchant = await db.getMerchant();
    if (!merchant) {
      throw new Error('No merchant account configured.');
    }
    const token = this.generateToken(merchant);
    const { password_hash, ...safeMerchant } = merchant;
    return { merchant: safeMerchant, token };
  }
}

export const authService = new AuthService();
