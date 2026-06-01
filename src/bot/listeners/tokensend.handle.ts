import { OnEvent } from '@nestjs/event-emitter';
import { Events, TokenSentEvent } from 'mezon-sdk';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/bot/models/user.entity';
import { Repository, DataSource } from 'typeorm';
import { Transaction } from '../models/transaction.entity';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { UserCacheService } from 'src/bot/services/user-cache.service';
import { RedisCacheService } from 'src/bot/services/redis-cache.service';
import { BaseQueueProcessor } from 'src/bot/base/queue-processor.base';
import { PermissionService } from 'src/bot/services/permission.service';
import {
  buildBotEmbedPayload,
  EMBED_COLOR,
} from 'src/bot/utils/embed.util';

@Injectable()
export class ListenerTokenSend extends BaseQueueProcessor<TokenSentEvent> {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Transaction)
    private transactionRepository: Repository<Transaction>,
    private clientService: MezonClientService,
    private dataSource: DataSource,
    private userCacheService: UserCacheService,
    private redisCacheService: RedisCacheService,
    private permissionService: PermissionService,
  ) {
    super('ListenerTokenSend', 1, 15000);
  }

  @OnEvent(Events.TokenSend)
  async handleRecharge(tokenEvent: TokenSentEvent) {
    if (tokenEvent.amount <= 0) return;

    const botId = process.env.SUPERVISION_BOT_ID;
    if (!botId) {
      console.error('SUPERVISION_BOT_ID is not defined');
      return;
    }

    if (tokenEvent.receiver_id === botId && tokenEvent.sender_id) {
      await this.addToQueue(tokenEvent);
    }
  }

  protected async processItem(tokenEvent: TokenSentEvent): Promise<void> {
    const amount = Number(tokenEvent.amount) || 0;
    const botId = process.env.SUPERVISION_BOT_ID;

    if (!botId) {
      throw new Error('SUPERVISION_BOT_ID is not defined');
    }

    const lockKey = `recharge_${tokenEvent.transaction_id}`;
    const lockAcquired = await this.redisCacheService.acquireLock(lockKey, 10);

    if (!lockAcquired) {
      this.logger.warn(
        `Duplicate recharge attempt detected: ${tokenEvent.transaction_id}`,
      );
      return;
    }

    try {
      const existingTransaction = await this.transactionRepository.findOne({
        where: { transactionId: tokenEvent.transaction_id },
      });

      if (existingTransaction) {
        this.logger.warn(
          `Transaction already processed: ${tokenEvent.transaction_id}`,
        );
        return;
      }

      const senderCache = await this.userCacheService.createUserIfNotExists(
        tokenEvent.sender_id as string,
      );

      if (!senderCache) {
        throw new Error('Failed to create or get user cache');
      }

      const balanceResult = await this.userCacheService.updateUserBalance(
        tokenEvent.sender_id as string,
        amount,
        10,
      );

      if (!balanceResult.success) {
        throw new Error(
          `Failed to update user balance: ${balanceResult.error}`,
        );
      }

      const botCache = await this.userCacheService.createUserIfNotExists(
        botId,
        'SupervisionBot',
        'SupervisionBot',
      );

      if (!botCache) {
        throw new Error('Failed to create or get bot cache');
      }

      const botBalanceResult = await this.userCacheService.updateUserBalance(
        botId,
        amount,
        10,
      );

      if (!botBalanceResult.success) {
        this.logger.error(
          `Failed to update bot balance: ${botBalanceResult.error}`,
        );
      }

      await this.dataSource.transaction(async (manager) => {
        await manager.insert(Transaction, {
          transactionId: tokenEvent.transaction_id,
          sender_id: tokenEvent.sender_id,
          receiver_id: tokenEvent.receiver_id,
          amount: tokenEvent.amount,
          note: tokenEvent.note,
          createAt: Date.now(),
        });
      });
      const client = this.clientService.getClient();
      try {
        const user = await client.users.fetch(tokenEvent.sender_id as string);
        const successMessage = `💸 Nạp ${tokenEvent.amount.toLocaleString('vi-VN')} mezon đồng thành công!`;
        await user?.sendDM(
          buildBotEmbedPayload({
            title: 'Nạp Mezon Đồng',
            description: successMessage,
            color: EMBED_COLOR.SUCCESS,
          }),
        );
      } catch (error) {
        this.logger.warn(
          `Failed to DM sender ${tokenEvent.sender_id}: ${error?.message || error}`,
        );
        const adminId = this.permissionService.getAdminIds()[0];
        if (adminId) {
          try {
            const adminUser = await client.users.fetch(adminId);
            const adminMessage = `Không send được DM cho user ${tokenEvent.sender_id}.\n${error}`;
            await adminUser?.sendDM(
              buildBotEmbedPayload({
                title: 'Token Recharge Alert',
                description: adminMessage,
                color: EMBED_COLOR.ERROR,
              }),
            );
          } catch (errorAdmin) {
            this.logger.error(
              `Failed to DM admin ${adminId}: ${errorAdmin?.message || errorAdmin}`,
            );
          }
        }
      }

      this.logger.log(
        `Token recharge processed successfully: ${tokenEvent.transaction_id}, Amount: ${amount}, User: ${tokenEvent.sender_id}, Bot Balance Updated: ${botBalanceResult.success}`,
      );
    } catch (error) {
      try {
        await this.userCacheService.updateUserBalance(
          tokenEvent.sender_id as string,
          -amount,
          5,
        );
      } catch (rollbackError) {
        this.logger.error('Error rolling back recharge:', rollbackError);
      }

      throw error;
    } finally {
      await this.redisCacheService.releaseLock(lockKey);
    }
  }

  protected async handleProcessingError(
    tokenEvent: TokenSentEvent,
    error: any,
  ): Promise<void> {
    this.logger.error(`Failed to process token recharge:`, {
      transactionId: tokenEvent.transaction_id,
      amount: tokenEvent.amount,
      senderId: tokenEvent.sender_id,
      error: error.message,
    });
  }
}
