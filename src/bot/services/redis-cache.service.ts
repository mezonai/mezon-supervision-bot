import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';

export interface UserCache {
  user_id: string;
  amount: number;
  ban?: any[];
  username?: string;
  clan_nick?: string;
  avatar?: string;
  lastUpdated: number;
}

@Injectable()
export class RedisCacheService {
  private readonly logger = new Logger(RedisCacheService.name);
  private redis: Redis;

  private readonly USER_PREFIX = 'user:supervision:';
  private readonly LOCK_PREFIX = 'lock:supervision:';
  private readonly COUNT_PREFIX = 'count:supervision:';
  private readonly MUTEX_PREFIX = 'mutex:supervision:';

  private readonly USER_TTL = 86400; // 1 day
  private readonly LOCK_TTL = 10;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: null,
    });

    this.redis.on('connect', () => {
      this.logger.log('Redis connected successfully');
    });

    this.redis.on('error', (error) => {
      this.logger.error('Redis connection error:', error);
    });
  }

  async onApplicationShutdown() {
    await this.redis.quit();
  }

  async getUserCache(userId: string): Promise<UserCache | null> {
    try {
      const cached = await this.redis.get(`${this.USER_PREFIX}${userId}`);
      if (!cached) return null;

      return JSON.parse(cached) as UserCache;
    } catch (error) {
      this.logger.error(`Error getting user cache for ${userId}:`, error);
      return null;
    }
  }

  async setUserCache(userId: string, data: UserCache): Promise<void> {
    try {
      await this.redis.setex(
        `${this.USER_PREFIX}${userId}`,
        this.USER_TTL,
        JSON.stringify(data),
      );
    } catch (error) {
      this.logger.error(`Error setting user cache for ${userId}:`, error);
    }
  }

  async updateUserCache(
    userId: string,
    updates: Partial<UserCache>,
  ): Promise<void> {
    try {
      const existing = await this.getUserCache(userId);
      if (existing) {
        const updated = { ...existing, ...updates, lastUpdated: Date.now() };
        await this.setUserCache(userId, updated);
      }
    } catch (error) {
      this.logger.error(`Error updating user cache for ${userId}:`, error);
    }
  }

  async deleteUserCache(userId: string): Promise<void> {
    try {
      await this.redis.del(`${this.USER_PREFIX}${userId}`);
    } catch (error) {
      this.logger.error(`Error deleting user cache for ${userId}:`, error);
    }
  }

  async acquireLock(
    key: string,
    ttl: number = this.LOCK_TTL,
  ): Promise<boolean> {
    try {
      const lockKey = `${this.LOCK_PREFIX}${key}`;
      const result = await this.redis.set(lockKey, '1', 'EX', ttl, 'NX');
      return result === 'OK';
    } catch (error) {
      this.logger.error(`Error acquiring lock for ${key}:`, error);
      return false;
    }
  }

  async incrementCount(
    key: string,
    windowSec: number,
  ): Promise<{ count: number; ttlLeft: number }> {
    const k = `${this.COUNT_PREFIX}${key}`;
    const count = await this.redis.incr(k);
    if (count === 1) {
      await this.redis.expire(k, Math.max(1, Math.floor(windowSec)));
    }
    const ttlLeft = await this.redis.ttl(k);
    return { count, ttlLeft };
  }

  async getCurrentCount(
    key: string,
  ): Promise<{ count: number; ttlLeft: number }> {
    const k = `${this.COUNT_PREFIX}${key}`;
    const results = await this.redis.multi().get(k).ttl(k).exec();

    if (!results) return { count: 0, ttlLeft: -2 };

    const [, valRaw] = results[0];
    const [, ttlRaw] = results[1];

    const count = valRaw ? parseInt(valRaw as string, 10) : 0;
    const ttlLeft = (ttlRaw as number) ?? -2;

    return { count, ttlLeft };
  }

  async acquireMutex(
    key: string,
    ttlSec = this.LOCK_TTL,
  ): Promise<string | null> {
    try {
      const mutexKey = `${this.MUTEX_PREFIX}${key}`;
      const token = randomUUID();

      let result: string | null;
      if (!Number.isFinite(ttlSec) || ttlSec <= 0) ttlSec = 1;

      if (Number.isInteger(ttlSec)) {
        result = await this.redis.set(mutexKey, token, 'EX', ttlSec, 'NX');
      } else {
        const ttlMs = Math.max(1, Math.round(ttlSec * 1000));
        result = await this.redis.set(mutexKey, token, 'PX', ttlMs, 'NX');
      }

      return result === 'OK' ? token : null;
    } catch (e) {
      this.logger.error(`acquireMutex error for ${key}:`, e);
      return null;
    }
  }

  async releaseMutex(key: string, token: string): Promise<boolean> {
    const mutexKey = `${this.MUTEX_PREFIX}${key}`;
    const lua = `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      else
        return 0
      end
    `;
    try {
      const res = await this.redis.eval(lua, 1, mutexKey, token);
      return res === 1;
    } catch (e) {
      this.logger.error(`releaseMutex error for ${key}:`, e);
      return false;
    }
  }

  async acquireCooldown(key: string, ttlSec = this.LOCK_TTL): Promise<boolean> {
    try {
      const lockKey = `${this.LOCK_PREFIX}${key}`;
      let result: string | null;
      if (!Number.isFinite(ttlSec) || ttlSec <= 0) ttlSec = 1;
      if (Number.isInteger(ttlSec)) {
        result = await this.redis.set(lockKey, '1', 'EX', ttlSec, 'NX');
      } else {
        const ttlMs = Math.max(1, Math.round(ttlSec * 1000));
        result = await this.redis.set(lockKey, '1', 'PX', ttlMs, 'NX');
      }
      return result === 'OK';
    } catch (e) {
      this.logger.error(`acquireCooldown error for ${key}:`, e);
      return false;
    }
  }

  async trySendWarnOnce(key: string, ttlSec: number): Promise<boolean> {
    const warnKey = `warn:supervision:${key}`;
    const r = await this.redis.set(warnKey, '1', 'EX', ttlSec, 'NX');
    return r === 'OK';
  }

  async releaseLock(key: string): Promise<void> {
    try {
      await this.redis.del(`${this.LOCK_PREFIX}${key}`);
    } catch (error) {
      this.logger.error(`Error releasing lock for ${key}:`, error);
    }
  }

  async listAllUserCaches(): Promise<Map<string, UserCache>> {
    try {
      const keys = await this.redis.keys(`${this.USER_PREFIX}*`);
      if (keys.length === 0) return new Map();

      const userIds = keys.map((key) => key.slice(this.USER_PREFIX.length));
      return await this.getUserCacheBatch(userIds);
    } catch (error) {
      this.logger.error('Error listing all user caches:', error);
      return new Map();
    }
  }

  async getUserCacheBatch(userIds: string[]): Promise<Map<string, UserCache>> {
    const result = new Map<string, UserCache>();

    if (userIds.length === 0) return result;

    try {
      const keys = userIds.map((id) => `${this.USER_PREFIX}${id}`);
      const values = await this.redis.mget(keys);

      for (let i = 0; i < userIds.length; i++) {
        if (values[i]) {
          try {
            result.set(userIds[i], JSON.parse(values[i]!));
          } catch (parseError) {
            this.logger.error(
              `Error parsing cache for user ${userIds[i]}:`,
              parseError,
            );
          }
        }
      }
    } catch (error) {
      this.logger.error('Error getting user cache batch:', error);
    }

    return result;
  }

  async setUserCacheBatch(users: Map<string, UserCache>): Promise<void> {
    if (users.size === 0) return;

    try {
      const pipeline = this.redis.pipeline();

      for (const [userId, data] of users) {
        pipeline.setex(
          `${this.USER_PREFIX}${userId}`,
          this.USER_TTL,
          JSON.stringify(data),
        );
      }

      await pipeline.exec();
    } catch (error) {
      this.logger.error('Error setting user cache batch:', error);
    }
  }

  async getCacheStats(): Promise<{
    userCacheKeys: number;
    activeLocks: number;
  }> {
    try {
      const [userKeys, lockKeys] = await Promise.all([
        this.redis.keys(`${this.USER_PREFIX}*`),
        this.redis.keys(`${this.LOCK_PREFIX}*`),
      ]);

      return {
        userCacheKeys: userKeys.length,
        activeLocks: lockKeys.length,
      };
    } catch (error) {
      this.logger.error('Error getting cache stats:', error);
      return {
        userCacheKeys: 0,
        activeLocks: 0,
      };
    }
  }

  async clearAllCache(): Promise<void> {
    try {
      const keys = await this.redis.keys(`${this.USER_PREFIX}*`);

      if (keys.length > 0) {
        await this.redis.del(...keys);
      }

      this.logger.log('All user cache cleared');
    } catch (error) {
      this.logger.error('Error clearing cache:', error);
    }
  }
}
