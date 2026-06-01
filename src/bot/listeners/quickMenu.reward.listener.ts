import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ApiMessageRef,
  ChannelMessageContent,
  ChannelStreamMode,
  ChannelType,
  Events,
  QuickMenuEvent,
  ReplyMessageData,
} from 'mezon-sdk';
import {
  buildBotEmbedPayload,
  EMBED_COLOR,
} from '../utils/embed.util';
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
type QuickMenuMessage = QuickMenuPayload['message'];

type ChannelMessageWriter = {
  clan: { id?: string };
  id?: string;
  is_private: boolean;
  channel_type?: number;
  messageQueue: {
    enqueue: <T>(fn: () => Promise<T>) => Promise<T>;
  };
  socketManager: {
    writeChatMessage: (data: ReplyMessageData) => Promise<unknown>;
  };
};

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
      const clanId = this.normalizeMezonId(msg.clan_id);
      const channelId = this.normalizeMezonId(msg.channel_id);
      const messageAuthorId = this.normalizeMezonId(event.message_sender_id);
      const targetMessageId = this.normalizeMezonId(msg.id);

      if (!this.isValidMezonId(clanId) || !this.isValidMezonId(channelId)) {
        this.logger.warn('QuickMenu ignored: invalid clan_id or channel_id');
        return;
      }

      const bot = await this.userRepository.findOne({
        where: { user_id: process.env.SUPERVISION_BOT_ID || '' },
      });
      if (!bot) {
        this.logger.error(
          `Bot record (SUPERVISION_BOT_ID=${process.env.SUPERVISION_BOT_ID}) not found in DB.`,
        );
        await this.replyChannel(
          clanId,
          channelId,
          targetMessageId,
          this.buildEmbedPayload(
            'Reward',
            'Bot chưa được khởi tạo trong DB. Liên hệ admin.',
            EMBED_COLOR.ERROR,
          ),
          msg,
          messageAuthorId,
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
          targetMessageId,
          this.buildEmbedPayload(
            'Reward',
            'Không xác định được người thực hiện reward.',
            EMBED_COLOR.ERROR,
          ),
          msg,
          messageAuthorId,
        );
        return;
      }
      grantor.username = await this.resolveGrantorUsername(grantor);

      if (!(await this.permissionService.canRewardGrantor(grantor.userId, clanId))) {
        this.logger.warn(`QuickMenu denied grantor=${grantor.userId} clan=${clanId}`);
        await this.sendEphemeralToGrantor(
          clanId,
          channelId,
          targetMessageId,
          'Bạn chưa được cấp quyền reward. Liên hệ admin (*rewardsetup).',
          grantor.userId,
        );
        return;
      }

      const banStatus = await this.userCacheService.getUserBanStatus(
        grantor.userId,
        FuncType.REWARD,
      );
      if (banStatus.isBanned) {
        await this.sendEphemeralToGrantor(
          clanId,
          channelId,
          targetMessageId,
          'Bạn đang bị ban chức năng reward.',
          grantor.userId,
        );
        return;
      }

      if (messageAuthorId === grantor.userId) {
        await this.sendEphemeralToGrantor(
          clanId,
          channelId,
          targetMessageId,
          'Không thể reward chính mình.',
          grantor.userId,
        );
        return;
      }

      const recipient = this.resolveRecipient(event);
      if (!recipient.userId) {
        await this.sendEphemeralToGrantor(
          clanId,
          channelId,
          targetMessageId,
          'Không xác định được người nhận. Chuột phải vào tin nhắn của họ rồi chọn Quick Menu reward.',
          grantor.userId,
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
              /* ignore */
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
          await this.sendEphemeralToGrantor(
            clanId,
            channelId,
            targetMessageId,
            result.error || 'Reward thất bại.',
            grantor.userId,
          );
          return;
        }

        this.logger.log(
          `QuickMenu reward ok amount=${amount} recipient=${recipient.userId} targetMsg=${targetMessageId} tx=${result.transactionId}`,
        );

        const displayRecipient = recipientUsername || recipient.userId;
        const content = `🎁 Reward thành công ${amount.toLocaleString('vi-VN')} points!\nNgười reward: ${grantor.username || grantor.userId}.\nNgười nhận: ${displayRecipient}.`;

        await this.replyChannel(
          clanId,
          channelId,
          targetMessageId,
          this.buildEmbedPayload('Reward', content, EMBED_COLOR.SUCCESS),
          msg,
          messageAuthorId,
        );
      } finally {
        await this.redisCacheService.releaseLock(lockKey);
      }
    } catch (error) {
      this.logger.error('Quick menu reward failed', error);
    }
  }

  private normalizeEvent(raw: QuickMenuEvent): QuickMenuPayload | null {
    const payload = raw?.quick_menu_event;
    if (!payload?.menu_name || !payload?.message) return null;
    return payload;
  }

  private normalizeMezonId(value: unknown): string {
    if (value === undefined || value === null) return '';
    return String(value).trim();
  }

  private isValidMezonId(id: string): boolean {
    return id.length > 0 && id !== '0';
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

  private resolveGrantor(event: QuickMenuPayload): {
    userId?: string;
    username?: string;
  } {
    const id = this.normalizeMezonId(event.sender_id);
    if (!this.isValidMezonId(id)) return {};
    return { userId: id };
  }

  private resolveRecipient(event: QuickMenuPayload): {
    userId?: string;
    username?: string;
  } {
    const id = this.normalizeMezonId(event.message_sender_id);
    if (!this.isValidMezonId(id)) return {};
    return { userId: id };
  }

  private async resolveGrantorUsername(grantor: {
    userId?: string;
    username?: string;
  }): Promise<string | undefined> {
    if (grantor.username) return grantor.username;
    if (!grantor.userId) return undefined;
    try {
      const cached = await this.userCacheService.getUserFromCache(grantor.userId);
      if (cached?.username) return cached.username;
    } catch {
      /* ignore */
    }
    try {
      const dbUser = await this.userRepository.findOne({
        where: { user_id: grantor.userId },
      });
      if (dbUser?.username) return dbUser.username;
    } catch {
      /* ignore */
    }
    try {
      const fetched = await this.clientService
        .getClient()
        .users.fetch(grantor.userId);
      if (fetched?.username) return fetched.username;
    } catch {
      /* ignore */
    }
    return undefined;
  }

  private buildEmbedPayload(title: string, description: string, color?: string) {
    return buildBotEmbedPayload({ title, description, color });
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
      await channel.sendEphemeral(
        grantorId,
        this.buildEmbedPayload('Reward', text, EMBED_COLOR.ERROR),
        this.isValidMezonId(messageId) ? messageId : undefined,
      );
    } catch (error) {
      this.logger.warn('Failed to send ephemeral reward message', error);
    }
  }

  private stringifyMessageContent(content: unknown): string {
    if (typeof content === 'string') {
      try {
        JSON.parse(content);
        return content;
      } catch {
        return JSON.stringify({ t: content });
      }
    }
    return JSON.stringify(content ?? { t: '' });
  }

  private async buildReplyReferences(
    refId: string,
    messageAuthorId: string,
    menuMsg: QuickMenuMessage,
  ): Promise<ApiMessageRef[]> {
    let username: string | undefined;
    let avatar: string | undefined;
    try {
      const user = await this.clientService
        .getClient()
        .users.fetch(messageAuthorId);
      username = user.clan_nick || user.display_name || user.username;
      avatar = user.clan_avatar || user.avartar;
    } catch {
      /* optional */
    }
    return [
      {
        message_ref_id: refId,
        ref_type: 0,
        message_sender_id: messageAuthorId,
        message_sender_username: username,
        message_sender_avatar: avatar,
        has_attachment: false,
        content: this.stringifyMessageContent(menuMsg.content),
      },
    ];
  }

  private resolveChannelMode(
    channel: ChannelMessageWriter,
    menuMsg: QuickMenuMessage,
  ): number {
    if (typeof menuMsg.mode === 'number' && menuMsg.mode !== 0) {
      return menuMsg.mode;
    }
    switch (Number(channel.channel_type)) {
      case ChannelType.CHANNEL_TYPE_DM:
        return ChannelStreamMode.STREAM_MODE_DM;
      case ChannelType.CHANNEL_TYPE_GROUP:
        return ChannelStreamMode.STREAM_MODE_GROUP;
      case ChannelType.CHANNEL_TYPE_THREAD:
        return ChannelStreamMode.STREAM_MODE_THREAD;
      case ChannelType.CHANNEL_TYPE_CHANNEL:
      case ChannelType.CHANNEL_TYPE_APP:
      case ChannelType.CHANNEL_TYPE_MEZON_VOICE:
      default:
        return ChannelStreamMode.STREAM_MODE_CHANNEL;
    }
  }

  private async replyChannel(
    clanId: string,
    channelId: string,
    targetMessageId: string,
    payload: ChannelMessageContent,
    menuMsg: QuickMenuMessage,
    messageAuthorId: string,
  ): Promise<void> {
    if (
      !this.isValidMezonId(targetMessageId) ||
      !this.isValidMezonId(messageAuthorId)
    ) {
      this.logger.warn(
        `QuickMenu reply skipped: targetMsg=${targetMessageId || 'empty'} author=${messageAuthorId || 'empty'}`,
      );
      return;
    }

    try {
      const client = this.clientService.getClient();
      const clan = client.clans.get(clanId);
      const channel = (await clan?.channels.fetch(channelId)) as unknown as
        | ChannelMessageWriter
        | undefined;
      if (!channel) {
        this.logger.warn(`QuickMenu reply: channel not found ${channelId}`);
        return;
      }

      const references = await this.buildReplyReferences(
        targetMessageId,
        messageAuthorId,
        menuMsg,
      );
      const data: ReplyMessageData = {
        clan_id: channel.clan.id!,
        channel_id: channel.id!,
        mode: this.resolveChannelMode(channel, menuMsg),
        is_public: menuMsg.is_public ?? !channel.is_private,
        content: payload,
        references,
        topic_id: menuMsg.topic_id,
      };

      await channel.messageQueue.enqueue(() =>
        channel.socketManager.writeChatMessage(data),
      );
    } catch (error) {
      this.logger.warn('Failed to reply quick menu reward', error);
    }
  }
}
