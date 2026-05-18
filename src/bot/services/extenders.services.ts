import { Injectable } from '@nestjs/common';
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
    if (user.user_id === botId) return;
    if (user.user_id === '1767478432163172999') return; // ignored anonymous user

    const cachedUser = await this.userCacheService.getUserFromCache(
      user.user_id,
    );

    if (cachedUser) {
      this.redisCacheService.updateUserCache(user.user_id, {
        username: user.username,
        avatar: user.avatar,
        clan_nick: user.clan_nick,
      });
      return;
    }

    const newUser = {
      user_id: user.user_id,
      username: user.username,
      avatar: user.avatar,
      bot: false,
      display_name: user.display_name ?? '',
      clan_nick: user.clan_nick ?? '',
      last_message_id: user.message_id,
      last_message_time: Date.now(),
      deactive: false,
      botPing: false,
      createdAt: Date.now(),
      whitelist: invitor ? { [clan_id]: [invitor] } : {},
      invitor: invitor ? { [clan_id]: invitor } : {},
    };

    await this.userRepository.insert(newUser);
  }
}
