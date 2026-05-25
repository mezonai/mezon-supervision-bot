import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RewardGrantorService } from '../reward/reward-grantor.service';

@Injectable()
export class PermissionService {
  private readonly logger = new Logger(PermissionService.name);
  private readonly adminIds: string[];
  private readonly adminIdSet: Set<string>;

  constructor(
    private configService: ConfigService,
    private rewardGrantorService: RewardGrantorService,
  ) {
    const envAdmins =
      this.configService.get<string>('BOT_ADMIN_IDS') ||
      process.env.BOT_ADMIN_IDS ||
      '';
    const ids = envAdmins
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      this.logger.warn(
        'BOT_ADMIN_IDS is empty — no admin will be able to run *ban/*unban/*update/*rewardsetup. Set BOT_ADMIN_IDS in env.',
      );
    }

    this.adminIds = ids;
    this.adminIdSet = new Set(ids);
  }

  isAdmin(userId: string | number | undefined): boolean {
    if (userId === undefined || userId === null || userId === '') return false;
    return this.adminIdSet.has(String(userId));
  }

  getAdminIds(): string[] {
    return [...this.adminIds];
  }

  async canRewardGrantor(
    userId: string | undefined,
    clanId: string,
  ): Promise<boolean> {
    if (!userId || !clanId) return false;
    return this.rewardGrantorService.isRewardGrantor(userId, clanId);
  }
}
