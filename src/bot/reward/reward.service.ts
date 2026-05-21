import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { EMarkdownType } from 'mezon-sdk';
import { Transaction } from '../models/transaction.entity';
import { User } from '../models/user.entity';
import { UserCacheService } from '../services/user-cache.service';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';

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
    @InjectRepository(User)
    private userRepository: Repository<User>,
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

  private getBotUserId(): string {
    return process.env.SUPERVISION_BOT_ID || '';
  }

  private displayName(user: User): string {
    return user.clan_nick || user.username || user.user_id;
  }

  private leaderboardBaseQuery() {
    const botId = this.getBotUserId();
    const qb = this.userRepository
      .createQueryBuilder('u')
      .where('(u.bot IS NULL OR u.bot = false)')
      .andWhere('COALESCE(u.amount, 0) > 0');
    if (botId) {
      qb.andWhere('u.user_id != :botId', { botId });
    }
    return qb;
  }

  async getPointsLeaderboard(limit: number): Promise<LeaderboardEntry[]> {
    const rows = await this.leaderboardBaseQuery()
      .orderBy('u.amount', 'DESC')
      .addOrderBy('u.username', 'ASC')
      .limit(limit)
      .getMany();

    return rows.map((user, index) => ({
      rank: index + 1,
      userId: user.user_id,
      displayName: this.displayName(user),
      amount: Number(user.amount) || 0,
    }));
  }

  async getUserPointsRank(userId: string): Promise<UserPointsRank | null> {
    const user = await this.userRepository.findOne({ where: { user_id: userId } });
    if (!user) return null;

    const amount = Number(user.amount) || 0;
    const higherCount = await this.leaderboardBaseQuery()
      .andWhere('u.amount > :amount', { amount })
      .getCount();

    return {
      rank: higherCount + 1,
      userId: user.user_id,
      displayName: this.displayName(user),
      amount,
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
      await user?.sendDM({
        t: dmText,
        mk: [{ type: EMarkdownType.PRE, s: 0, e: dmText.length }],
      });
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
