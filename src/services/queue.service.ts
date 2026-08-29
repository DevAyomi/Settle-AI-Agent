import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import EventEmitter from 'events';
import { CONFIG } from '../config/index.js';
import { db } from '../db/index.js';

export interface QueueJobData {
  jobType: 'CHECK_INVENTORY' | 'EXECUTE_SETTLEMENT' | 'NOTIFY_SUPPLIER';
  payload: Record<string, any>;
}

class QueueService extends EventEmitter {
  private redisClient: any = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private isUsingBullMQ = false;

  public async init(processor: (job: QueueJobData) => Promise<any>) {
    try {
      const redisConnection = new Redis(CONFIG.REDIS_URL, {
        maxRetriesPerRequest: null,
        connectTimeout: 2000,
        retryStrategy: () => null // Don't hang indefinitely if local redis isn't up
      });

      redisConnection.on('error', (err: any) => {
        if (!this.isUsingBullMQ) {
          // quiet error on fallback
        }
      });

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Redis connection timeout'));
        }, 1500);

        redisConnection.once('ready', () => {
          clearTimeout(timer);
          resolve();
        });

        redisConnection.once('error', (err: any) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      this.redisClient = redisConnection;
      this.queue = new Queue('settle-agent-queue', { connection: this.redisClient });
      this.worker = new Worker('settle-agent-queue', async (job) => {
        return processor(job.data);
      }, { connection: this.redisClient });

      this.isUsingBullMQ = true;
      console.log('[Queue] BullMQ connected successfully to Redis.');
    } catch (err) {
      console.log('[Queue] Redis not detected or unreachable. Using robust built-in in-memory asynchronous worker queue.');
      this.isUsingBullMQ = false;

      // In-memory queue processor
      this.on('in_memory_job', async (jobData: QueueJobData) => {
        try {
          await processor(jobData);
        } catch (jobErr: any) {
          console.error('[Queue] In-memory job execution error:', jobErr);
          await db.addLog('QUEUE_ERROR', 'ERROR', `Job failed: ${jobErr.message}`, { jobType: jobData.jobType });
        }
      });
    }
  }

  public async addJob(jobType: QueueJobData['jobType'], payload: Record<string, any> = {}, delayMs = 0) {
    if (this.isUsingBullMQ && this.queue) {
      await this.queue.add(jobType, { jobType, payload }, { delay: delayMs });
    } else {
      if (delayMs > 0) {
        setTimeout(() => {
          this.emit('in_memory_job', { jobType, payload });
        }, delayMs);
      } else {
        setImmediate(() => {
          this.emit('in_memory_job', { jobType, payload });
        });
      }
    }
  }

  public getQueueMode(): string {
    return this.isUsingBullMQ ? 'BullMQ (Redis)' : 'In-Memory Async Event Queue';
  }
}

export const queueService = new QueueService();
