import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Transaction } from '../models/transaction.entity';
import { UserCacheService } from '../services/user-cache.service';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import {
  buildBotEmbedPayload,
  EMBED_COLOR,
} from '../utils/embed.util';

export interface RewardCreditParams {
  rewarderId: string;
  rewarderUsername: string;
  recipientId: string;
  recipientUsername?: string;
  amount: number;
  clanId: string;
  note?: string;
}

export interface RewardCreditResult {
  success: boolean;
  error?: string;
  newBalance?: number;
  transactionId?: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  amount: number;
}

export interface UserPointsRank {
  rank: number;
  userId: string;
  displayName: string;
  amount: number;
}

@Injectable()
export class RewardService {
  private readonly logger = new Logger(RewardService.name);

  constructor(
    @InjectRepository(Transaction)
    private transactionRepository: Repository<Transaction>,
    private userCacheService: UserCacheService,
    private dataSource: DataSource,
    private configService: ConfigService,
    private clientService: MezonClientService,
  ) {}

  private getMaxAmount(): number | undefined {
    const raw = this.configService.get<string>('REWARD_MAX_AMOUNT');
    if (!raw) return undefined;
    const n = Number(raw);
    return !isNaN(n) && n > 0 ? n : undefined;
  }

  private getMaxPerDay(): number | undefined {
    const raw = this.configService.get<string>('REWARD_MAX_PER_DAY');
    if (!raw) return undefined;
    const n = Number(raw);
    return !isNaN(n) && n > 0 ? n : undefined;
  }

  async getPointsLeaderboard(limit: number): Promise<LeaderboardEntry[]> {
    const rows = await this.userCacheService.getPointsLeaderboardFromCache(limit);

    return rows.map((user, index) => ({
      rank: index + 1,
      userId: user.userId,
      displayName: user.displayName,
      amount: user.amount,
    }));
  }

  async getUserPointsRank(userId: string): Promise<UserPointsRank | null> {
    const rank = await this.userCacheService.getUserPointsRankFromCache(userId);
    if (!rank) return null;

    return {
      rank: rank.rank,
      userId: rank.userId,
      displayName: rank.displayName,
      amount: rank.amount,
    };
  }

  async getGrantorDailyTotal(rewarderId: string): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const rows = await this.transactionRepository
      .createQueryBuilder('tx')
      .select('COALESCE(SUM(tx.amount), 0)', 'total')
      .where('tx.sender_id = :rewarderId', { rewarderId })
      .andWhere('tx.transactionId LIKE :prefix', { prefix: 'reward_%' })
      .andWhere('tx.createAt >= :start', { start: startOfDay.getTime() })
      .getRawOne();
    return Number(rows?.total || 0);
  }

  async creditRecipient(
    params: RewardCreditParams,
  ): Promise<RewardCreditResult> {
    const { rewarderId, rewarderUsername, recipientId, amount, note } = params;

    if (amount <= 0) {
      return { success: false, error: 'Số điểm phải lớn hơn 0.' };
    }

    const maxAmount = this.getMaxAmount();
    if (maxAmount !== undefined && amount > maxAmount) {
      return {
        success: false,
        error: `Số điểm vượt hạn mức mỗi lần (${maxAmount.toLocaleString('vi-VN')}).`,
      };
    }

    const maxPerDay = this.getMaxPerDay();
    if (maxPerDay !== undefined) {
      const dailyTotal = await this.getGrantorDailyTotal(rewarderId);
      if (dailyTotal + amount > maxPerDay) {
        return {
          success: false,
          error: `Vượt hạn mức reward trong ngày (${maxPerDay.toLocaleString('vi-VN')}). Đã dùng: ${dailyTotal.toLocaleString('vi-VN')}.`,
        };
      }
    }

    await this.userCacheService.createUserIfNotExists(
      recipientId,
      params.recipientUsername,
    );

    const balanceResult = await this.userCacheService.updateUserBalance(
      recipientId,
      amount,
      10,
    );

    if (!balanceResult.success) {
      return {
        success: false,
        error: balanceResult.error || 'Không thể cập nhật số dư người nhận.',
      };
    }

    const transactionId = `reward_${randomUUID()}`;

    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.insert(Transaction, {
          transactionId,
          sender_id: rewarderId,
          receiver_id: recipientId,
          amount,
          note: note || `reward by ${rewarderUsername}`,
          createAt: Date.now(),
        });
      });
    } catch (error) {
      const rollback = await this.userCacheService.updateUserBalance(
        recipientId,
        -amount,
        5,
      );
      if (!rollback.success) {
        this.logger.error(
          `CRITICAL: reward credit succeeded but Transaction insert AND rollback failed for recipient=${recipientId} amount=${amount}. Manual reconciliation required. Reason: ${rollback.error}`,
        );
      }
      this.logger.error('Failed to insert reward transaction:', error);
      return { success: false, error: 'Lỗi ghi giao dịch reward.' };
    }

    try {
      const client = this.clientService.getClient();
      const user = await client.users.fetch(recipientId);
      const dmText = `🎁 Bạn nhận ${amount.toLocaleString('vi-VN')} points rewarded từ ${rewarderUsername}!`;
      await user?.sendDM(
        buildBotEmbedPayload({
          title: 'Reward Points',
          description: dmText,
          color: EMBED_COLOR.SUCCESS,
        }),
      );
    } catch {
      // DM optional
    }

    return {
      success: true,
      newBalance: balanceResult.newBalance,
      transactionId,
    };
  }
}
