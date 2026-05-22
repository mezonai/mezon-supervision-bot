import { Injectable, Logger } from '@nestjs/common';
import { MezonClient } from 'mezon-sdk';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../models/user.entity';
import { UserCacheService } from './user-cache.service';
import { RedisCacheService } from './redis-cache.service';

interface SharedUserProperties {
  user_id: string;
  username: string;
  avatar: string;
  display_name?: string;
  message_id?: string;
  clan_avatar?: string;
  clan_nick?: string;
}
@Injectable()
export class ExtendersService {
  private readonly logger = new Logger(ExtendersService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private userCacheService: UserCacheService,
    private redisCacheService: RedisCacheService,
  ) {}

  async ensureBotUser(client: MezonClient): Promise<User | null> {
    const botId = process.env.SUPERVISION_BOT_ID?.trim();
    if (!botId) {
      this.logger.warn('SUPERVISION_BOT_ID is empty — skip bot user seed');
      return null;
    }

    const sessionUserId = this.getSessionUserId(client);
    if (sessionUserId && sessionUserId !== botId) {
      this.logger.error(
        `SUPERVISION_BOT_ID (${botId}) does not match session user_id (${sessionUserId}). Use appId from developer console.`,
      );
      return null;
    }
    if (!client.clientId || client.clientId !== botId) {
      this.logger.error(
        `SUPERVISION_BOT_ID (${botId}) must match SDK clientId (${client.clientId || 'missing'}). Check MEZON_TOKEN pairs with this appId.`,
      );
      return null;
    }

    let bot = await this.userRepository.findOne({ where: { user_id: botId } });
    if (bot) {
      if (!bot.bot) {
        bot.bot = true;
        await this.userRepository.save(bot);
      }
      await this.userCacheService.createUserIfNotExists(
        botId,
        bot.username,
        bot.clan_nick,
      );
      this.logger.log(`mebot_users bot ready user_id=${botId}`);
      return bot;
    }

    bot = this.userRepository.create({
      user_id: botId,
      username: process.env.SUPERVISION_BOT_USERNAME?.trim() || `bot_${botId}`,
      avatar: '',
      bot: true,
      display_name: process.env.SUPERVISION_BOT_USERNAME?.trim() || '',
      clan_nick: '',
      deactive: false,
      botPing: false,
      createdAt: Date.now(),
      amount: 0,
      rewardGrantors: {},
      invitor: {},
      ban: [],
    });

    await this.userRepository.save(bot);
    await this.userCacheService.createUserIfNotExists(
      botId,
      bot.username,
      bot.clan_nick,
    );
    this.logger.log(`mebot_users bot inserted user_id=${botId}`);
    return bot;
  }

  private getSessionUserId(client: MezonClient): string | undefined {
    const session = (
      client as MezonClient & {
        sessionManager?: { getSession(): { user_id?: string | number } | undefined };
      }
    ).sessionManager?.getSession();
    const raw = session?.user_id;
    if (raw === undefined || raw === null || raw === '') {
      return undefined;
    }
    const id = String(raw);
    if (id === '0') return undefined;
    return id;
  }

  async addDBUser(
    user: SharedUserProperties,
    invitor: string,
    clan_id: string,
  ) {
    const botId = process.env.SUPERVISION_BOT_ID;
    if (!user?.user_id || user.user_id === botId) return;
    if (user.user_id === '1767478432163172999') return; // ignored anonymous user

    const existing = await this.userRepository.findOne({
      where: { user_id: user.user_id },
    });

    if (existing) {
      existing.username = user.username || existing.username;
      existing.avatar = user.avatar || existing.avatar;
      existing.display_name = user.display_name ?? existing.display_name;
      existing.clan_nick = user.clan_nick || existing.clan_nick;
      if (user.message_id) {
        existing.last_message_id = user.message_id;
        existing.last_message_time = Date.now();
      }
      if (invitor && clan_id) {
        existing.invitor = { ...(existing.invitor || {}), [clan_id]: invitor };
      }
      await this.userRepository.save(existing);
      await this.userCacheService.updateUserCache(user.user_id, {
        username: existing.username,
        clan_nick: existing.clan_nick,
      });
      await this.redisCacheService.updateUserCache(user.user_id, {
        username: user.username,
        avatar: user.avatar,
        clan_nick: user.clan_nick,
      });
      return;
    }

    const newUser = this.userRepository.create({
      user_id: user.user_id,
      username: user.username,
      avatar: user.avatar,
      bot: false,
      display_name: user.display_name ?? '',
      clan_nick: user.clan_nick ?? '',
      last_message_id: user.message_id,
      last_message_time: user.message_id ? Date.now() : undefined,
      deactive: false,
      botPing: false,
      createdAt: Date.now(),
      amount: 0,
      invitor: invitor && clan_id ? { [clan_id]: invitor } : {},
    });

    try {
      await this.userRepository.save(newUser);
      await this.userCacheService.createUserIfNotExists(
        user.user_id,
        user.username,
        user.clan_nick,
      );
      this.logger.log(`mebot_users insert user_id=${user.user_id}`);
    } catch (error) {
      this.logger.error(
        `mebot_users insert failed user_id=${user.user_id}`,
        error,
      );
    }
  }
}
