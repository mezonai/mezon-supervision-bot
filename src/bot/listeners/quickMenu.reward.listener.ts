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
import { RewardMessageCacheService } from '../reward/reward-message-cache.service';
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
    private rewardMessageCache: RewardMessageCacheService,
    private redisCacheService: RedisCacheService,
  ) {}

  @OnEvent(Events.QuickMenu)
  async handleQuickMenuReward(rawEvent: QuickMenuEvent | QuickMenuPayload) {
    try {
      const event = this.normalizeEvent(rawEvent);
      if (!event?.menu_name || !event.message) return;

      const amount = this.parseRewardAmount(event.menu_name);
      if (amount === null) return;

      const msg = event.message as Record<string, unknown>;
      const clanId = String(msg.clan_id || '');
      const channelId = String(msg.channel_id || '');
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
          'Bot chưa được khởi tạo trong DB. Liên hệ admin.',
        );
        return;
      }

      const grantor = await this.resolveGrantor(msg, rawEvent);
      if (!grantor.userId) {
        this.logger.warn(
          `Quick Menu event missing grantor sender_id. Mezon server may not enrich the envelope on this build. Raw keys: ${Object.keys(
            (rawEvent as Record<string, unknown>) || {},
          ).join(',')}`,
        );
        await this.replyChannel(
          clanId,
          channelId,
          'Không xác định được người thực hiện reward. Cấu hình Mezon server chưa hỗ trợ Quick Menu reward.',
        );
        return;
      }
      grantor.username = await this.resolveGrantorUsername(grantor);

      if (
        !this.permissionService.canRewardGrantor(
          grantor.userId,
          grantor.username,
          clanId,
          bot,
        )
      ) {
        await this.replyChannel(
          clanId,
          channelId,
          'Bạn chưa được cấp quyền reward. Liên hệ admin (*rewardsetup).',
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
          'Bạn đang bị ban chức năng reward.',
        );
        return;
      }

      const recipient = await this.resolveRecipient(
        msg,
        channelId,
        grantor.userId,
      );
      if (!recipient.userId) {
        await this.replyChannel(
          clanId,
          channelId,
          'Không xác định được người nhận. Chuột phải vào tin nhắn của họ rồi chọn Quick Menu reward.',
        );
        return;
      }

      if (recipient.userId === grantor.userId) {
        await this.replyChannel(
          clanId,
          channelId,
          'Không thể reward chính mình.',
        );
        return;
      }

      const lockKey = `reward_qm:${clanId}:${channelId}:${event.menu_name}:${recipient.userId}:${grantor.userId}`;
      const locked = await this.redisCacheService.acquireLock(lockKey, 15);
      if (!locked) return;

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
            // optional
          }
        }
      }

      const result = await this.rewardService.creditRecipient({
        rewarderId: grantor.userId,
        rewarderUsername:
          grantor.username || grantor.userId,
        recipientId: recipient.userId,
        recipientUsername,
        amount,
        clanId,
        note: `quick_menu:${event.menu_name}`,
      });

      if (!result.success) {
        await this.replyChannel(
          clanId,
          channelId,
          result.error || 'Reward thất bại.',
        );
        return;
      }

      const displayRecipient = recipientUsername || recipient.userId;
      const content = `🎁 Reward thành công (Quick Menu)
Người reward: ${grantor.username || grantor.userId}
Người nhận: ${displayRecipient}
Số điểm: ${amount.toLocaleString('vi-VN')} mezon đồng
Số dư mới: ${(result.newBalance ?? 0).toLocaleString('vi-VN')}`;

      await this.replyChannel(clanId, channelId, content);
    } catch (error) {
      this.logger.error('Quick menu reward failed', error);
    }
  }

  private normalizeEvent(
    raw: QuickMenuEvent | QuickMenuPayload,
  ): QuickMenuPayload | null {
    if (!raw) return null;
    const wrapped = raw as QuickMenuEvent;
    if (wrapped.quick_menu_event) return wrapped.quick_menu_event;
    if ((raw as QuickMenuPayload).menu_name) return raw as QuickMenuPayload;
    return null;
  }

  private parseRewardAmount(menuName: string): number | null {
    const mapRaw = this.configService.get<string>('REWARD_MENU_MAP');
    if (mapRaw) {
      for (const part of mapRaw.split(',')) {
        const [name, value] = part.split(':').map((s) => s.trim());
        if (name && name === menuName) {
          const mapped = Number(value);
          if (!isNaN(mapped) && mapped > 0) return mapped;
        }
      }
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

  private async resolveGrantor(
    msg: Record<string, unknown>,
    rawEvent: unknown,
  ): Promise<{ userId?: string; username?: string }> {
    const raw = rawEvent as Record<string, unknown>;
    const nested = (raw?.quick_menu_event || raw) as Record<string, unknown>;
    const senderId =
      (nested.sender_id as string) || (nested.user_id as string);

    if (senderId && senderId !== '0') {
      return { userId: senderId };
    }

    return {};
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

  private async resolveRecipient(
    msg: Record<string, unknown>,
    channelId: string,
    grantorId?: string,
  ): Promise<{ userId?: string; username?: string }> {
    const messageId = (msg.id as string) || (msg.message_id as string);
    if (messageId) {
      const byId = await this.rewardMessageCache.getSenderByMessageId(
        channelId,
        messageId,
      );
      if (byId?.sender_id && byId.sender_id !== grantorId) return byId;
    }

    const byContent = await this.rewardMessageCache.getSenderByContent(
      channelId,
      msg.content,
    );
    if (byContent?.sender_id && byContent.sender_id !== grantorId)
      return byContent;

    const references =
      (msg.references as Array<{ message_sender_id?: string }>) || [];
    for (let i = references.length - 1; i >= 0; i--) {
      const ref = references[i];
      const refId = ref?.message_sender_id;
      if (refId && refId !== '0' && refId !== grantorId) {
        return { userId: refId };
      }
    }

    const mentions = (msg.mentions as Array<{ user_id?: string }>) || [];
    for (const m of mentions) {
      if (m?.user_id && m.user_id !== grantorId) {
        return { userId: m.user_id };
      }
    }

    return {};
  }

  private async replyChannel(
    clanId: string,
    channelId: string,
    text: string,
  ): Promise<void> {
    try {
      const client = this.clientService.getClient();
      const clan = client.clans.get(clanId);
      const channel = await clan?.channels.fetch(channelId);
      if (!channel) return;
      await channel.send({
        t: text,
        mk: [{ type: EMarkdownType.PRE, s: 0, e: text.length }],
      });
    } catch (error) {
      this.logger.warn('Failed to reply quick menu reward', error);
    }
  }
}
