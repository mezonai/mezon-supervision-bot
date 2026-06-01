import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RewardGrantorService } from '../reward/reward-grantor.service';

export const NO_ADMIN_PERMISSION_MESSAGE = '[Bot] - You have no permission!';

export const PUBLIC_HELP_COMMANDS = [
  'help',
  'avatar',
  'qr',
  'welcomemsginfo',
  'leaderboard',
] as const;

export const ADMIN_ONLY_HELP_COMMANDS = [
  'ban',
  'unban',
  'update',
  'rewardsetup',
  'welcomemsg',
] as const;

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
        'BOT_ADMIN_IDS is empty — no admin will be able to run *ban/*unban/*update/*rewardsetup/*welcomemsg. Set BOT_ADMIN_IDS in env.',
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

  formatHelpMessage(isAdmin: boolean): Array<{
    name: string;
    value: string;
    inline?: boolean;
    options?: any[];
    inputs?: {};
    max_options?: number;
  }> {
    if (isAdmin) {
      return [
        {
          name: 'Commands',
          value: PUBLIC_HELP_COMMANDS.map((c) => `*${c}`).join(', '),
        },
        {
          name: 'Functionality',
          value: 'Dùng Quick Menu trên tin nhắn để reward điểm cho người khác.',
        },
        {
          name: 'Admin-only commands',
          value: ADMIN_ONLY_HELP_COMMANDS.map((c) => `*${c}`).join(', '),
        },
      ];
    } else {
      return [
        {
          name: 'Commands',
          value: PUBLIC_HELP_COMMANDS.map((c) => `*${c}`).join(', '),
        },
        {
          name: 'Functionality',
          value: 'Dùng Quick Menu trên tin nhắn để reward điểm cho người nhận.',
        },
      ];
    }
  }

  async canRewardGrantor(
    userId: string | undefined,
    clanId: string,
  ): Promise<boolean> {
    if (!userId || !clanId) return false;
    return this.rewardGrantorService.isRewardGrantor(userId, clanId);
  }
}
