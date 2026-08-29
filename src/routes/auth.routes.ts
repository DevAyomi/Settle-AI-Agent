import { FastifyInstance } from 'fastify';
import { authService, RegisterDTO } from '../services/auth.service.js';
import { db } from '../db/index.js';

export async function authRoutes(fastify: FastifyInstance) {
  // Register new merchant
  fastify.post<{
    Body: RegisterDTO;
  }>('/api/auth/register', async (request, reply) => {
    try {
      const { name, businessName, email, password, phone, country, currency } = request.body || {};
      
      if (!name || !email || !password) {
        return reply.status(400).send({
          success: false,
          error: 'Name, email, and password are required.'
        });
      }

      if (password.length < 6) {
        return reply.status(400).send({
          success: false,
          error: 'Password must be at least 6 characters long.'
        });
      }

      const result = await authService.register({
        name,
        businessName: businessName || name,
        email,
        password,
        phone,
        country,
        currency
      });

      return reply.send({
        success: true,
        message: 'Account created successfully!',
        ...result
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: err.message
      });
    }
  });

  // Login merchant
  fastify.post<{
    Body: { email: string; password?: string };
  }>('/api/auth/login', async (request, reply) => {
    try {
      const { email, password } = request.body || {};

      if (!email) {
        return reply.status(400).send({
          success: false,
          error: 'Email is required.'
        });
      }

      // If logging into default demo merchant without password
      const merchant = await db.getMerchantByEmail(email);
      if (merchant && !merchant.password_hash) {
        const token = authService.generateToken(merchant);
        const { password_hash, ...safeMerchant } = merchant;
        return reply.send({
          success: true,
          message: 'Logged in successfully!',
          user: safeMerchant,
          merchant: safeMerchant,
          token
        });
      }

      if (!password) {
        return reply.status(400).send({
          success: false,
          error: 'Password is required.'
        });
      }

      const result = await authService.login(email, password);
      return reply.send({
        success: true,
        message: 'Logged in successfully!',
        ...result,
        user: result.merchant
      });
    } catch (err: any) {
      return reply.status(401).send({
        success: false,
        error: err.message
      });
    }
  });

  // 1-Click Demo Login
  fastify.post('/api/auth/demo', async (request, reply) => {
    try {
      const result = await authService.getDemoMerchant();
      return reply.send({
        success: true,
        message: 'Authenticated as Demo Merchant (Kofi Retail Electronics)',
        ...result,
        user: result.merchant
      });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: err.message
      });
    }
  });

  // Current authenticated merchant
  fastify.get('/api/auth/me', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        success: false,
        error: 'Unauthorized: Missing or invalid authorization token.'
      });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const payload = authService.verifyToken(token);

    if (!payload || !payload.merchantId) {
      return reply.status(401).send({
        success: false,
        error: 'Unauthorized: Invalid or expired token.'
      });
    }

    const merchant = await db.getMerchantById(payload.merchantId);
    if (!merchant) {
      return reply.status(404).send({ success: false, error: 'Merchant profile not found.' });
    }

    const { password_hash, ...safeMerchant } = merchant;
    return reply.send({
      success: true,
      user: safeMerchant,
      merchant: safeMerchant
    });
  });

  // Logout
  fastify.post('/api/auth/logout', async (request, reply) => {
    return reply.send({
      success: true,
      message: 'Logged out successfully.'
    });
  });
}
