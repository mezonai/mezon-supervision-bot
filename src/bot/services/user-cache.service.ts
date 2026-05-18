import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../models/user.entity';
import { RedisCacheService, UserCache } from './redis-cache.service';

@Injectable()
export class UserCacheService {
  private readonly logger = new Logger(UserCacheService.name);

  private userCache = new Map<string, UserCache>();
  private readonly CACHE_SYNC_INTERVAL = 5 * 60000;
  private readonly INACTIVE_USER_CLEANUP_INTERVAL = 10 * 60000;
  private readonly INACTIVE_USER_THRESHOLD = 30 * 60000;
  private readonly MAX_CONCURRENT_DB_UPDATES = 10;
  private readonly BATCH_SIZE = 50;

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private redisCacheService: RedisCacheService,
  ) {
    this.initializeCache();
  }

  private async initializeCache() {
    setInterval(() => {
      this.syncCacheToDatabase();
    }, this.CACHE_SYNC_INTERVAL);

    setInterval(() => {
      this.cleanupInactiveUsers();
    }, this.INACTIVE_USER_CLEANUP_INTERVAL);
  }

  private async syncCacheToDatabase() {
    try {
      const usersToSync: Array<{ userId: string; userCache: UserCache }> = [];

      for (const [userId, userCache] of this.userCache) {
        if (
          Date.now() - userCache.lastUpdated <=
          this.CACHE_SYNC_INTERVAL + 60 * 1000
        ) {
          usersToSync.push({ userId, userCache });
        }
      }

      if (usersToSync.length === 0) {
        return;
      }

      await this.processBatchUpdates(usersToSync);
    } catch (error) {
      this.logger.error('Error syncing cache to database:', error);
    }
  }

  private async processBatchUpdates(
    users: Array<{ userId: string; userCache: UserCache }>,
  ): Promise<PromiseSettledResult<any>[]> {
    const allResults: PromiseSettledResult<any>[] = [];

    for (let i = 0; i < users.length; i += this.BATCH_SIZE) {
      const batch = users.slice(i, i + this.BATCH_SIZE);

      try {
        await this.bulkUpdateUsersWithCaseWhen(batch);
      } catch (error) {
        this.logger.error(
          `Bulk update failed for batch, falling back to individual updates:`,
          error,
        );

        const updatePromises = batch.map(({ userId, userCache }) =>
          this.updateSingleUser(userId, userCache),
        );

        const batchResults = await this.limitConcurrency(
          updatePromises,
          this.MAX_CONCURRENT_DB_UPDATES,
        );

        allResults.push(...batchResults);
      }
    }

    return allResults;
  }

  private async bulkUpdateUsersWithCaseWhen(
    users: Array<{ userId: string; userCache: UserCache }>,
  ): Promise<void> {
    if (users.length === 0) return;

    const userIds = users.map(({ userId }) => userId);

    const amountCases = users
      .map(
        ({ userId, userCache }) =>
          `WHEN user_id = '${userId}' THEN ${Number(userCache.amount)}`,
      )
      .join(' ');

    const usernameCases = users
      .map(
        ({ userId, userCache }) =>
          `WHEN user_id = '${userId}' THEN '${(userCache.username || '').replace(/'/g, "''")}'`,
      )
      .join(' ');

    const clanNickCases = users
      .map(
        ({ userId, userCache }) =>
          `WHEN user_id = '${userId}' THEN '${(userCache.clan_nick || '').replace(/'/g, "''")}'`,
      )
      .join(' ');

    const queryBuilder = this.userRepository
      .createQueryBuilder()
      .update(User)
      .set({
        amount: () => `CASE ${amountCases} END`,
        username: () => `CASE ${usernameCases} END`,
        clan_nick: () => `CASE ${clanNickCases} END`,
      })
      .whereInIds(userIds);

    await queryBuilder.execute();
  }

  private async updateSingleUser(
    userId: string,
    userCache: UserCache,
  ): Promise<void> {
    await this.userRepository.update(
      { user_id: userId },
      {
        amount: Number(userCache.amount),
        username: userCache.username,
        clan_nick: userCache.clan_nick,
      },
    );
  }

  private async limitConcurrency<T>(
    promises: Promise<T>[],
    limit: number,
  ): Promise<PromiseSettledResult<T>[]> {
    const results: PromiseSettledResult<T>[] = [];

    for (let i = 0; i < promises.length; i += limit) {
      const chunk = promises.slice(i, i + limit);
      const chunkResults = await Promise.allSettled(chunk);
      results.push(...chunkResults);
    }

    return results;
  }

  private async cleanupInactiveUsers() {
    try {
      const now = Date.now();
      const usersToRemove: string[] = [];

      for (const [userId, userCache] of this.userCache) {
        if (now - userCache.lastUpdated > this.INACTIVE_USER_THRESHOLD) {
          usersToRemove.push(userId);
        }
      }

      if (usersToRemove.length === 0) {
        return;
      }

      usersToRemove.forEach((userId) => {
        this.userCache.delete(userId);
      });
    } catch (error) {
      this.logger.error('Error cleaning up inactive users:', error);
    }
  }

  async getUserFromCache(userId: string): Promise<UserCache | null> {
    try {
      const memoryCache = this.userCache.get(userId);
      if (memoryCache) {
        memoryCache.lastUpdated = Date.now();
        return memoryCache;
      }

      let redisCache = await this.redisCacheService.getUserCache(userId);

      if (redisCache) {
        redisCache.lastUpdated = Date.now();
        this.userCache.set(userId, redisCache);
        return redisCache;
      }

      const user = await this.userRepository.findOne({
        where: { user_id: userId },
      });

      if (!user) {
        return null;
      }

      const userCache: UserCache = {
        user_id: user.user_id,
        amount: Number(user.amount) || 0,
        ban: user.ban || [],
        username: user.username || '',
        clan_nick: user.clan_nick || '',
        lastUpdated: Date.now(),
      };

      this.userCache.set(userId, userCache);
      await this.redisCacheService.setUserCache(userId, userCache);

      return userCache;
    } catch (error) {
      this.logger.error(`Error getting user cache for ${userId}:`, error);
      return null;
    }
  }

  async createUserIfNotExists(
    userId: string,
    username?: string,
    clanNick?: string,
  ): Promise<UserCache | null> {
    try {
      const existingUser = await this.getUserFromCache(userId);
      if (existingUser) {
        return existingUser;
      }

      const newUser = this.userRepository.create({
        user_id: userId,
        amount: 0,
        username: username || '',
        clan_nick: clanNick || '',
        ban: [],
      });
      await this.userRepository.save(newUser);

      const userCache: UserCache = {
        user_id: userId,
        amount: 0,
        ban: [],
        username: username || '',
        clan_nick: clanNick || '',
        lastUpdated: Date.now(),
      };

      this.userCache.set(userId, userCache);
      await this.redisCacheService.setUserCache(userId, userCache);
      return userCache;
    } catch (error) {
      this.logger.error(`Error creating user ${userId}:`, error);
      return null;
    }
  }

  async updateUserCache(
    userId: string,
    updates: Partial<UserCache>,
  ): Promise<void> {
    try {
      const cached = this.userCache.get(userId);
      if (cached) {
        Object.assign(cached, updates, { lastUpdated: Date.now() });
      }

      await this.redisCacheService.updateUserCache(userId, updates);
    } catch (error) {
      this.logger.error(`Error updating user cache for ${userId}:`, error);
    }
  }

  async updateUserBalance(
    userId: string,
    amountChange: number,
    lockTimeout: number = 5,
  ): Promise<{ success: boolean; newBalance: number; error?: string }> {
    const lockKey = `user_balance_${userId}`;
    const lockAcquired = await this.redisCacheService.acquireLock(
      lockKey,
      lockTimeout,
    );

    if (!lockAcquired) {
      return {
        success: false,
        newBalance: 0,
        error: 'Unable to acquire lock for balance update',
      };
    }

    try {
      const user = await this.getUserFromCache(userId);
      if (!user) {
        return {
          success: false,
          newBalance: 0,
          error: 'User not found',
        };
      }

      const currentBalance = Number(user.amount) || 0;
      const newBalance = currentBalance + amountChange;

      if (newBalance < 0) {
        return {
          success: false,
          newBalance: currentBalance,
          error: 'Insufficient balance',
        };
      }

      await this.updateUserCache(userId, {
        amount: newBalance,
      });

      return {
        success: true,
        newBalance: newBalance,
      };
    } catch (error) {
      this.logger.error(`Error updating balance for ${userId}:`, error);
      return {
        success: false,
        newBalance: 0,
        error: error.message || 'Unknown error',
      };
    } finally {
      await this.redisCacheService.releaseLock(lockKey);
    }
  }

  async getUserBalance(
    userId: string,
  ): Promise<{ balance: number; error?: string }> {
    try {
      const user = await this.getUserFromCache(userId);
      if (!user) {
        return {
          balance: 0,
          error: 'User not found',
        };
      }

      return {
        balance: Number(user.amount) || 0,
      };
    } catch (error) {
      this.logger.error(`Error getting balance for ${userId}:`, error);
      return {
        balance: 0,
        error: error.message || 'Unknown error',
      };
    }
  }

  async hasEnoughBalance(
    userId: string,
    requiredAmount: number,
  ): Promise<boolean> {
    const { balance } = await this.getUserBalance(userId);
    return balance >= requiredAmount;
  }

  async getUserBanStatus(
    userId: string,
    funcType: string,
  ): Promise<{
    isBanned: boolean;
    banInfo?: any;
  }> {
    try {
      const user = await this.getUserFromCache(userId);
      if (!user || !Array.isArray(user.ban)) {
        return { isBanned: false };
      }

      const activeBan = user.ban.find(
        (ban) =>
          (ban.type === funcType || ban.type === 'ALL') &&
          ban.unBanTime > Math.floor(Date.now() / 1000),
      );

      return {
        isBanned: !!activeBan,
        banInfo: activeBan,
      };
    } catch (error) {
      this.logger.error(`Error checking ban status for ${userId}:`, error);
      return { isBanned: false };
    }
  }

  async clearUserCache(userId: string): Promise<void> {
    try {
      this.userCache.delete(userId);
      await this.redisCacheService.deleteUserCache(userId);
      this.logger.log(`Cleared cache for user: ${userId}`);
    } catch (error) {
      this.logger.error(`Error clearing cache for ${userId}:`, error);
    }
  }

  async getCacheStats(): Promise<{
    memoryUserCount: number;
    estimatedMemoryUsage: string;
    redisStats: any;
  }> {
    try {
      const redisStats = await this.redisCacheService.getCacheStats();
      const estimatedMemoryPerUser = 0.5;
      const estimatedMemoryUsageKB =
        this.userCache.size * estimatedMemoryPerUser;

      return {
        memoryUserCount: this.userCache.size,
        estimatedMemoryUsage:
          estimatedMemoryUsageKB > 1024
            ? `${(estimatedMemoryUsageKB / 1024).toFixed(2)} MB`
            : `${estimatedMemoryUsageKB.toFixed(2)} KB`,
        redisStats,
      };
    } catch (error) {
      this.logger.error('Error getting cache stats:', error);
      return {
        memoryUserCount: this.userCache.size,
        estimatedMemoryUsage: '0 KB',
        redisStats: {},
      };
    }
  }

  async forceSyncUser(userId: string): Promise<void> {
    try {
      const user = this.userCache.get(userId);
      if (user) {
        await this.userRepository.update(
          { user_id: userId },
          {
            amount: Number(user.amount),
            username: user.username,
            clan_nick: user.clan_nick,
          },
        );
        this.logger.debug(`Force synced user ${userId} to database`);
      }
    } catch (error) {
      this.logger.error(`Error force syncing user ${userId}:`, error);
    }
  }

  async clearAllMemoryCache(): Promise<{
    success: boolean;
    clearedCount: number;
    error?: string;
  }> {
    try {
      await this.syncCacheToDatabase();

      const clearedCount = this.userCache.size;
      this.userCache.clear();

      return {
        success: true,
        clearedCount,
      };
    } catch (error) {
      this.logger.error('Error clearing all memory cache:', error);
      return {
        success: false,
        clearedCount: 0,
        error: error.message || 'Unknown error',
      };
    }
  }

  async getAllCachedUsers(limit: number = 50): Promise<{
    users: Array<{
      userId: string;
      username: string;
      clanNick: string;
      balance: number;
      lastUpdated: string;
    }>;
    totalCount: number;
  }> {
    try {
      const users: Array<{
        userId: string;
        username: string;
        clanNick: string;
        balance: number;
        lastUpdated: string;
        lastUpdatedTimestamp: number;
      }> = [];

      for (const [userId, userCache] of this.userCache.entries()) {
        users.push({
          userId,
          username: userCache.username || 'Unknown',
          clanNick: userCache.clan_nick || 'Unknown',
          balance: Number(userCache.amount) || 0,
          lastUpdated: new Date(userCache.lastUpdated).toLocaleString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh',
            hour12: false,
          }),
          lastUpdatedTimestamp: userCache.lastUpdated,
        });
      }

      users.sort((a, b) => b.lastUpdatedTimestamp - a.lastUpdatedTimestamp);

      const limitedUsers = users
        .slice(0, limit)
        .map(({ lastUpdatedTimestamp, ...user }) => user);

      return {
        users: limitedUsers,
        totalCount: this.userCache.size,
      };
    } catch (error) {
      this.logger.error('Error getting all cached users:', error);
      return {
        users: [],
        totalCount: 0,
      };
    }
  }
}
