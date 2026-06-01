import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../models/user.entity';
import { RedisCacheService } from './redis-cache.service';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { setBotAuthorIconUrl } from '../utils/embed.util';
import { pickMessageAvatar } from '../utils/user-avatar.util';

@Injectable()
export class BotEmbedAuthorService implements OnModuleInit {
  private readonly logger = new Logger(BotEmbedAuthorService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private redisCacheService: RedisCacheService,
    private clientService: MezonClientService,
  ) {}

  async onModuleInit() {
    await this.syncFromStoredProfile();
  }

  async syncFromStoredProfile() {
    const botId = process.env.SUPERVISION_BOT_ID || '';
    if (!botId) return;

    const avatar = await this.resolveBotAvatar(botId);
    if (avatar) {
      setBotAuthorIconUrl(avatar);
      this.logger.log('Embed author icon synced from bot avatar');
      return;
    }

    this.logger.warn(
      'Bot avatar not found yet; embed author icon will sync when bot profile is cached',
    );
  }

  syncFromAvatar(avatar: string | undefined) {
    if (avatar?.trim()) {
      setBotAuthorIconUrl(avatar);
    }
  }

  private async resolveBotAvatar(botId: string): Promise<string | undefined> {
    const dbBot = await this.userRepository.findOne({
      where: { user_id: botId },
    });
    if (dbBot?.avatar?.trim()) {
      return dbBot.avatar.trim();
    }

    const cached = await this.redisCacheService.getUserCache(botId);
    if (cached?.avatar?.trim()) {
      return cached.avatar.trim();
    }

    const sdkUser = this.clientService.getClient()?.users.get(botId);
    return pickMessageAvatar(sdkUser?.avartar, sdkUser?.clan_avatar);
  }
}
