import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '../models/user.entity';

@Injectable()
export class PermissionService {
  private readonly logger = new Logger(PermissionService.name);
  private readonly adminIds: string[];
  private readonly adminIdSet: Set<string>;

  constructor(private configService: ConfigService) {
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

  isAdmin(userId: string): boolean {
    if (!userId) return false;
    return this.adminIdSet.has(userId);
  }

  getAdminIds(): string[] {
    return [...this.adminIds];
  }

  canReward(identity: string | undefined, clanId: string, bot: User): boolean {
    if (!identity || !clanId) return false;
    const grantors = bot.rewardGrantors?.[clanId] || [];
    return grantors.some(
      (g) => g === identity || g.toLowerCase() === identity.toLowerCase(),
    );
  }

  canRewardGrantor(
    userId: string | undefined,
    username: string | undefined,
    clanId: string,
    bot: User,
  ): boolean {
    if (userId && this.canReward(userId, clanId, bot)) return true;
    if (username && this.canReward(username, clanId, bot)) return true;
    return false;
  }
}
