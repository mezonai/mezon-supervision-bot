import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { ChannelMessage } from 'mezon-sdk';
import { RedisCacheService } from '../services/redis-cache.service';

export interface CachedMessageSender {
  sender_id: string;
  username?: string;
}

@Injectable()
export class RewardMessageCacheService {
  private readonly TTL_SEC = 7 * 24 * 3600;

  constructor(private redisCacheService: RedisCacheService) {}

  normalizeContent(content: unknown): string {
    if (content === undefined || content === null) return '';
    if (typeof content === 'string') {
      const trimmed = content.trim();
      if (!trimmed) return '';
      try {
        return JSON.stringify(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }

  contentKey(channelId: string, content: unknown): string {
    const normalized = this.normalizeContent(content);
    const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 32);
    return `${channelId}:${hash}`;
  }

  async rememberChannelMessage(message: ChannelMessage): Promise<void> {
    const senderId = message.sender_id;
    if (!senderId || senderId === '0' || !message.channel_id) return;

    const payload: CachedMessageSender = {
      sender_id: senderId,
      username: message.username,
    };
    const serialized = JSON.stringify(payload);

    const messageId = message.message_id || message.id;
    if (messageId) {
      await this.redisCacheService.setRewardCache(
        `msg:${message.channel_id}:${messageId}`,
        serialized,
        this.TTL_SEC,
      );
    }

    const key = this.contentKey(message.channel_id, message.content);
    await this.redisCacheService.setRewardCache(
      `content:${key}`,
      serialized,
      this.TTL_SEC,
    );

    const avatar = message.avatar || message.clan_avatar;
    if (avatar) {
      await this.redisCacheService.setRewardCache(
        `avatar:${avatar}`,
        serialized,
        this.TTL_SEC,
      );
    }
  }

  async getSenderByMessageId(
    channelId: string,
    messageId: string,
  ): Promise<CachedMessageSender | null> {
    return this.readCache(`msg:${channelId}:${messageId}`);
  }

  async getSenderByContent(
    channelId: string,
    content: unknown,
  ): Promise<CachedMessageSender | null> {
    const key = this.contentKey(channelId, content);
    return this.readCache(`content:${key}`);
  }

  async getSenderByAvatar(avatar: string): Promise<CachedMessageSender | null> {
    return this.readCache(`avatar:${avatar}`);
  }

  private async readCache(
    suffix: string,
  ): Promise<CachedMessageSender | null> {
    const raw = await this.redisCacheService.getRewardCache(suffix);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedMessageSender;
    } catch {
      return null;
    }
  }
}
