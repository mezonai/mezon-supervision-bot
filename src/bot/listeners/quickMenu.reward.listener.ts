import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { EMarkdownType, Events, QuickMenuEvent } from 'mezon-sdk';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { User } from '../models/user.entity';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { PermissionService } from '../services/permission.service';
import { UserCacheService } from '../services/user-cache.service';
import { RedisCacheService } from '../services/redis-cache.service';
import { RewardService } from '../reward/reward.service';
import { FuncType } from '../constants/configs';

type QuickMenuPayload = QuickMenuEvent['quick_menu_event'];

@Injectable()
export class ListenerQuickMenuReward {
  private readonly logger = new Logger(ListenerQuickMenuReward.name);

  constructor(
    private clientService: MezonClientService,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private configService: ConfigService,
    private permissionService: PermissionService,
    private userCacheService: UserCacheService,
    private rewardService: RewardService,
    private redisCacheService: RedisCacheService,
  ) {}

  @OnEvent(Events.QuickMenu)
  async handleQuickMenuReward(rawEvent: QuickMenuEvent) {
    try {
      const event = this.normalizeEvent(rawEvent);
      if (!event?.menu_name || !event.message) {
        this.logger.debug('QuickMenu ignored: missing menu_name or message');
        return;
      }

      const amount = this.parseRewardAmount(event.menu_name);
      if (amount === null) {
        this.logger.debug(`QuickMenu ignored: unknown menu ${event.menu_name}`);
        return;
      }

      const msg = event.message;
      const clanId = String(msg.clan_id || '');
      const channelId = String(msg.channel_id || '');
      const messageId = (msg.id && msg.id !== '0') ? String(msg.id) : '';
      if (!clanId || !channelId) return;

      const bot = await this.userRepository.findOne({
        where: { user_id: process.env.SUPERVISION_BOT_ID || '' },
      });
      if (!bot) {
        this.logger.error(
          `Bot record (SUPERVISION_BOT_ID=${process.env.SUPERVISION_BOT_ID}) not found in DB. Reward disabled until admin records the bot user.`,
        );
        await this.replyChannel(
          clanId,
          channelId,
          messageId,
          'Bot chưa được khởi tạo trong DB. Liên hệ admin.',
          String(event.message_sender_id || ''),
          msg.content,
          msg.mode ?? 2,
        );
        return;
      }

      const grantor = this.resolveGrantor(event);
      if (!grantor.userId) {
        this.logger.warn(
          `Quick Menu event missing grantor sender_id (menu_name=${event.menu_name})`,
        );
        await this.replyChannel(
          clanId,
          channelId,
          messageId,
          'Không xác định được người thực hiện reward.',
          String(event.message_sender_id || ''),
          msg.content,
          msg.mode ?? 2,
        );
        return;
      }
      grantor.username = await this.resolveGrantorUsername(grantor);

      if (
        !(await this.permissionService.canRewardGrantor(
          grantor.userId,
          clanId,
        ))
      ) {
        this.logger.warn(
          `QuickMenu denied grantor=${grantor.userId} clan=${clanId}`,
        );
        await this.sendEphemeralToGrantor(
          clanId,
          channelId,
          messageId,
          'Bạn chưa được cấp quyền reward. Liên hệ admin.',
          grantor.userId,
        );
        return;
      }

      const banStatus = await this.userCacheService.getUserBanStatus(
        grantor.userId,
        FuncType.REWARD,
      );
      if (banStatus.isBanned) {
        await this.replyChannel(
          clanId,
          channelId,
          messageId,
          'Bạn đang bị ban chức năng reward.',
          String(event.message_sender_id || ''),
          msg.content,
          msg.mode ?? 2,
        );
        return;
      }

      const recipient = this.resolveRecipient(event);
      if (
        recipient.userId &&
        recipient.userId === grantor.userId
      ) {
        await this.replyChannel(
          clanId,
          channelId,
          messageId,
          'Không thể reward chính mình.',
          String(event.message_sender_id || ''),
          msg.content,
          msg.mode ?? 2,
        );
        return;
      }

      if (!recipient.userId) {
        await this.replyChannel(
          clanId,
          channelId,
          messageId,
          'Không xác định được người nhận. Chuột phải vào tin nhắn của họ rồi chọn Quick Menu reward.',
          String(event.message_sender_id || ''),
          msg.content,
          msg.mode ?? 2,
        );
        return;
      }

      const lockKey = `reward_qm:${clanId}:${channelId}:${event.menu_name}:${recipient.userId}:${grantor.userId}`;
      const lockAcquired = await this.redisCacheService.acquireLock(lockKey, 10);
      if (!lockAcquired) {
        this.logger.warn(`QuickMenu duplicate lock ${lockKey}`);
        return;
      }

      try {
        let recipientUsername = recipient.username;
        if (!recipientUsername) {
          const dbUser = await this.userRepository.findOne({
            where: { user_id: recipient.userId },
          });
          recipientUsername = dbUser?.username;
          if (!recipientUsername) {
            try {
              const fetched = await this.clientService
                .getClient()
                .users.fetch(recipient.userId);
              recipientUsername = fetched?.username;
            } catch {
              // ignore
            }
          }
        }

        const result = await this.rewardService.creditRecipient({
          rewarderId: grantor.userId,
          rewarderUsername: grantor.username || grantor.userId,
          recipientId: recipient.userId,
          recipientUsername,
          amount,
          clanId,
          note: `quick_menu:${event.menu_name}`,
        });

        if (!result.success) {
          this.logger.warn(`QuickMenu credit failed: ${result.error}`);
          await this.replyChannel(
            clanId,
            channelId,
            messageId,
            result.error || 'Reward thất bại.',
            String(event.message_sender_id || ''),
            msg.content,
            msg.mode ?? 2,
          );
          return;
        }

        this.logger.log(
          `QuickMenu reward ok amount=${amount} recipient=${recipient.userId} tx=${result.transactionId}`,
        );

        const displayRecipient = recipientUsername || recipient.userId;
        const content = `🎁 Reward thành công ${amount.toLocaleString('vi-VN')} points!
Người reward: ${grantor.username || grantor.userId}.
Người nhận: ${displayRecipient}.`;

        await this.replyChannel(clanId, channelId, messageId, content, String(event.message_sender_id || ''), msg.content, msg.mode ?? 2);
      } finally {
        await this.redisCacheService.releaseLock(lockKey);
      }
    } catch (error) {
      this.logger.error('Quick menu reward failed', error);
    }
  }

  private normalizeEvent(raw: QuickMenuEvent): QuickMenuPayload | null {
    if (!raw?.quick_menu_event) return null;
    return raw.quick_menu_event;
  }

  private parseRewardAmount(menuName: string): number | null {
    const rewardDash = menuName.match(/^\s*reward\s*-\s*(\d+)\s*$/i);
    if (rewardDash) {
      const n = Number(rewardDash[1]);
      if (!isNaN(n) && n > 0) return n;
    }

    const prefix =
      this.configService.get<string>('REWARD_MENU_PREFIX') || 'reward_';
    const lowerName = menuName.toLowerCase();
    const lowerPrefix = prefix.toLowerCase();
    if (!lowerName.startsWith(lowerPrefix)) return null;

    const suffix = menuName.slice(prefix.length).replace(/_/g, '');
    const amount = Number(suffix);
    if (isNaN(amount) || amount <= 0) return null;
    return amount;
  }

  /** Grantor = socket session user (mezon-sock sets sender_id). */
  private resolveGrantor(
    event: QuickMenuPayload,
  ): { userId?: string; username?: string } {
    const id = event.sender_id;
    if (!id || String(id) === '0') return {};
    return { userId: String(id) };
  }

  /** Recipient = target message author (client + sock message_sender_id). */
  private resolveRecipient(
    event: QuickMenuPayload,
  ): { userId?: string; username?: string } {
    const id = event.message_sender_id;
    if (!id || String(id) === '0') return {};
    return { userId: String(id) };
  }

  private async resolveGrantorUsername(grantor: {
    userId?: string;
    username?: string;
  }): Promise<string | undefined> {
    if (grantor.username) return grantor.username;
    if (!grantor.userId) return undefined;

    try {
      const cached = await this.userCacheService.getUserFromCache(
        grantor.userId,
      );
      if (cached?.username) return cached.username;
    } catch {
      // ignore
    }

    try {
      const dbUser = await this.userRepository.findOne({
        where: { user_id: grantor.userId },
      });
      if (dbUser?.username) return dbUser.username;
    } catch {
      // ignore
    }

    try {
      const fetched = await this.clientService
        .getClient()
        .users.fetch(grantor.userId);
      if (fetched?.username) return fetched.username;
    } catch {
      // ignore
    }

    return undefined;
  }

  private async sendEphemeralToGrantor(
    clanId: string,
    channelId: string,
    messageId: string,
    text: string,
    grantorId: string,
  ): Promise<void> {
    try {
      const client = this.clientService.getClient();
      const clan = client.clans.get(clanId);
      const channel = await clan?.channels.fetch(channelId);
      if (!channel) return;
 
      const payload = {
        t: text,
        mk: [{ type: EMarkdownType.PRE, s: 0, e: text.length }],
      };
 
      await channel.sendEphemeral(grantorId, payload, messageId || undefined);
    } catch (error) {
      this.logger.warn('Failed to send ephemeral reward message', error);
    }
  }

  private async replyChannel(
    clanId: string,
    channelId: string,
    messageId: string,
    text: string,
    msgSenderId?: string,
    msgContent?: any,
    mode: number = 2,
  ): Promise<void> {
    try {
      const client = this.clientService.getClient();
      const clan = client.clans.get(clanId);
      const channel = await clan?.channels.fetch(channelId);
      if (!channel) return;

      const payload = {
        t: text,
        mk: [{ type: EMarkdownType.PRE, s: 0, e: text.length }],
      };

      if (messageId) {
        let senderUsername = '';
        if (msgSenderId) {
          try {
            const user = await client.users.fetch(msgSenderId);
            senderUsername = user?.clan_nick || user?.display_name || user?.username || '';
          } catch {
          }
        }

        const socketManager = (channel as any).socketManager;
        const channelAny = channel as any;
        await socketManager.writeChatMessage({
          clan_id: clanId,
          channel_id: channelId,
          mode,
          is_public: !channelAny.is_private,
          content: payload,
          references: [
            {
              message_ref_id: messageId,
              message_sender_id: msgSenderId || '',
              message_sender_username: senderUsername,
              message_sender_avatar: '',
              content: typeof msgContent === 'string' ? msgContent : JSON.stringify(msgContent ?? {}),
            },
          ],
        });
        return;
      }

      await channel.send(payload);
    } catch (error) {
      this.logger.warn('Failed to reply quick menu reward', error);
    }
  }
}