import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from './config/index.js';
import { db } from './db/index.js';
import { agentService } from './services/agent.service.js';
import { inventoryRoutes } from './routes/inventory.routes.js';
import { reordersRoutes } from './routes/reorders.routes.js';
import { walletRoutes, telegramRoutes, suppliersRoutes, statsRoutes } from './routes/api.routes.js';
import { authRoutes } from './routes/auth.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');

export async function createServer() {
  const fastify = Fastify({
    logger: {
      level: 'info'
    }
  });

  // Enable CORS
  await fastify.register(fastifyCors, {
    origin: true
  });

  // Serve static UI assets from public directory
  await fastify.register(fastifyStatic, {
    root: publicDir,
    prefix: '/'
  });

  // Register API routes
  await fastify.register(authRoutes);
  await fastify.register(inventoryRoutes);
  await fastify.register(reordersRoutes);
  await fastify.register(walletRoutes);
  await fastify.register(telegramRoutes);
  await fastify.register(suppliersRoutes);
  await fastify.register(statsRoutes);

  // Page route aliases
  fastify.get('/login', async (request, reply) => {
    return reply.sendFile('login.html');
  });

  fastify.get('/register', async (request, reply) => {
    return reply.sendFile('register.html');
  });

  fastify.get('/dashboard', async (request, reply) => {
    return reply.sendFile('dashboard.html');
  });

  // Health check
  fastify.get('/api/health', async () => {
    return {
      status: 'healthy',
      system: 'Settle Agent v1.0.0',
      network: CONFIG.SOLANA_NETWORK,
      timestamp: new Date().toISOString()
    };
  });

  return fastify;
}

async function start() {
  try {
    console.log('--- Initializing Settle Agent Database ---');
    await db.init();

    let currentPort = CONFIG.PORT;
    let server: any;
    let bound = false;

    for (let attempts = 0; attempts < 10; attempts++) {
      try {
        server = await createServer();
        await server.listen({
          port: currentPort,
          host: CONFIG.HOST
        });
        bound = true;
        break;
      } catch (listenErr: any) {
        if (listenErr.code === 'EADDRINUSE') {
          console.log(`Port ${currentPort} in use, trying next port ${currentPort + 1}...`);
          currentPort++;
        } else {
          throw listenErr;
        }
      }
    }

    if (!bound) {
      throw new Error('Could not bind to any available port after 10 attempts');
    }

    console.log(`\n======================================================`);
    console.log(`🚀 Settle Agent Server running at http://${CONFIG.HOST === '0.0.0.0' ? 'localhost' : CONFIG.HOST}:${currentPort}`);
    console.log(`📦 Autonomous AI Restock Engine & Solana Settlement active`);
    console.log(`🇳🇬 NGN Corridor Oracle active (1 USDC = ₦${CONFIG.DEFAULT_USDC_NGN_RATE})`);
    console.log(`======================================================\n`);

    // Start background autonomous agent
    await agentService.start();

  } catch (err) {
    console.error('Failed to start Settle Agent server:', err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  start();
}
