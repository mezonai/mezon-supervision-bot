import { ChannelMessage } from 'mezon-sdk';
import { Command } from 'src/bot/base/commandRegister.decorator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { User } from 'src/bot/models/user.entity';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { EUserError } from 'src/bot/constants/error';
import { PermissionService } from 'src/bot/services/permission.service';
import { RewardGrantorService } from './reward-grantor.service';
import {
  buildBotEmbedPayload,
  buildErrorPayload,
  buildPermissionDeniedPayload,
  EMBED_COLOR,
} from '../utils/embed.util';

@Command('rewardsetup')
export class RewardSetupCommand extends CommandMessage {
  constructor(
    clientService: MezonClientService,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private permissionService: PermissionService,
    private rewardGrantorService: RewardGrantorService,
  ) {
    super(clientService);
  }

  async execute(args: string[], message: ChannelMessage) {
    const senderId = String(message.sender_id || '');

    if (!this.permissionService.isAdmin(senderId)) {
      return this.replyToMessage(
        message,
        buildPermissionDeniedPayload('Reward Setup Command'),
      );
    }

    const bot = await this.userRepository.findOne({
      where: { user_id: process.env.SUPERVISION_BOT_ID || '' },
    });
    if (!bot) {
      return this.replyToMessage(
        message,
        buildErrorPayload('Reward Setup Command', EUserError.INVALID_USER),
      );
    }

    const clanId = message.clan_id || '';
    const { action, identities: usernames } =
      this.parseActionAndIdentities(args);

    if (action === 'list') {
      const grantors = await this.rewardGrantorService.listByClan(clanId);
      const content =
        grantors.length > 0
          ? `Danh sách người dùng được cấp quyền reward (clan ${clanId}):\n${grantors
              .map((entry) => `- ${entry.displayName} (${entry.rewarderId})`)
              .join('\n')}`
          : 'Chưa có ai được cấp quyền reward trong clan này.';

      return this.replyToMessage(
        message,
        buildBotEmbedPayload({
          title: 'Reward Setup Command',
          description: content,
        }),
      );
    }

    if (
      usernames.length === 0 ||
      !action ||
      (action !== 'add' && action !== 'remove')
    ) {
      return this.replyToMessage(
        message,
        buildBotEmbedPayload({
          title: 'Reward Setup Command',
          fields: [
            {
              name: 'add <user1 hoặc user1 + user2>',
              value:
                'Cấp quyền reward cho người dùng (theo username hoặc userId).',
            },
            {
              name: 'remove <user1 hoặc user1 + user2>',
              value:
                'Gỡ quyền reward của người dùng (theo username hoặc userId).',
            },
            {
              name: 'list',
              value: 'Xem danh sách grantor trong clan.',
            },
          ],
        }),
      );
    }

    if (action === 'add') {
      const result = await this.rewardGrantorService.addRewarders(
        clanId,
        usernames,
        senderId,
      );

      const lines: string[] = [];
      if (result.added.length > 0) {
        lines.push('Cấp quyền reward thành công:');
        lines.push(result.added.join(', '));
      }
      if (result.skipped.length > 0) {
        lines.push(`Đã có sẵn: ${result.skipped.join(', ')}`);
      }
      if (result.notFound.length > 0) {
        lines.push(
          `Không tìm thấy user (cần từng nhắn bot trước): ${result.notFound.join(', ')}`,
        );
      }

      return this.replyToMessage(
        message,
        buildBotEmbedPayload({
          title: 'Reward Setup Command',
          description: lines.join('\n'),
          color: EMBED_COLOR.SUCCESS,
        }),
      );
    }

    if (action === 'remove') {
      const result = await this.rewardGrantorService.removeRewarders(
        clanId,
        usernames,
      );

      const lines: string[] = [];
      if (result.removed.length > 0) {
        lines.push('Thu hồi quyền reward thành công:');
        lines.push(result.removed.join(', '));
      }
      if (result.notFound.length > 0) {
        lines.push(
          `Không tìm thấy trong danh sách: ${result.notFound.join(', ')}`,
        );
      }

      const hasSuccess = result.removed.length > 0;
      return this.replyToMessage(
        message,
        buildBotEmbedPayload({
          title: 'Reward Setup Command',
          description: lines.join('\n') || 'Không có thay đổi nào.',
          color: hasSuccess ? EMBED_COLOR.SUCCESS : EMBED_COLOR.ERROR,
        }),
      );
    }
  }

  private parseActionAndIdentities(args: string[]): {
    action: string;
    identities: string[];
  } {
    if (args.length === 0) {
      return { action: '', identities: [] };
    }

    const actionCandidate = args[0].toLowerCase();
    if (actionCandidate === 'list') {
      return { action: 'list', identities: [] };
    }

    if (actionCandidate !== 'add' && actionCandidate !== 'remove') {
      return { action: '', identities: [] };
    }

    const identities = args
      .slice(1)
      .join(' ')
      .split(/[+,]/)
      .map((part) => part.trim())
      .filter(Boolean);

    return { action: actionCandidate, identities };
  }
}
