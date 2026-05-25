import { Injectable, Logger } from '@nestjs/common';
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

  async addDBUser(
    user: SharedUserProperties,
    invitor: string,
    clan_id: string,
  ) {
    const botId = process.env.SUPERVISION_BOT_ID;
    if (!user?.user_id) return;
    if (user.user_id === '1767478432163172999') return; // ignored anonymous user

    const isBot = Boolean(botId && user.user_id === botId);

    const existing = await this.userRepository.findOne({
      where: { user_id: user.user_id },
    });

    if (existing) {
      existing.username = user.username || existing.username;
      existing.avatar = user.avatar || existing.avatar;
      existing.display_name = user.display_name ?? existing.display_name;
      existing.clan_nick = user.clan_nick || existing.clan_nick;
      if (isBot) {
        existing.bot = true;
      }
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
      bot: isBot,
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
