import { Injectable } from '@nestjs/common';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { RedisCacheService } from './redis-cache.service';
import { firstNonEmptyAvatar } from '../utils/user-avatar.util';

@Injectable()
export class UserAvatarService {
  constructor(
    private redisCacheService: RedisCacheService,
    private clientService: MezonClientService,
  ) {}

  async resolveLatestAvatar(
    userId: string,
    options?: {
      dbAvatar?: string;
      referenceAvatar?: string;
    },
  ): Promise<string | undefined> {
    const cached = await this.redisCacheService.getUserCache(userId);
    const sdkUser = this.clientService.getClient().users.get(userId);

    return firstNonEmptyAvatar(
      options?.referenceAvatar,
      options?.dbAvatar,
      cached?.avatar,
      sdkUser?.clan_avatar,
      sdkUser?.avartar,
    );
  }
}
