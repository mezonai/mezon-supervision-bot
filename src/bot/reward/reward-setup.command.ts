import { ChannelMessage, EMarkdownType } from 'mezon-sdk';
import { Command } from 'src/bot/base/commandRegister.decorator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { User } from 'src/bot/models/user.entity';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { EUserError } from 'src/bot/constants/error';
import { PermissionService } from 'src/bot/services/permission.service';
import { RewardGrantorService } from './reward-grantor.service';

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
    const reply = (text: string) =>
      this.replyToMessage(message, {
        t: text,
        mk: [{ type: EMarkdownType.PRE, s: 0, e: text.length }],
      });

    const senderId = String(message.sender_id || '');

    if (!this.permissionService.isAdmin(senderId)) {
      const content = '[RewardSetup] - You have no permission!';
      return reply(content);
    }

    const bot = await this.userRepository.findOne({
      where: { user_id: process.env.SUPERVISION_BOT_ID || '' },
    });
    if (!bot) {
      return reply(EUserError.INVALID_USER);
    }

    const clanId = message.clan_id || '';
    const [actionRaw, ...usersRaw] = args
      .join(' ')
      .split('+')
      .map((s) => s.trim());
    const actionMatch = actionRaw.match(/^\[(.+?)\]\s*(.+)?$/);

    let action = '';
    let usernames: string[] = [];

    if (actionMatch) {
      action = actionMatch[1].toLowerCase();
      const firstUser = actionMatch[2];
      usernames = [firstUser, ...usersRaw].filter(Boolean);
    } else if (actionRaw.toLowerCase() === 'list') {
      action = 'list';
    }

    if (action === 'list') {
      const grantors = await this.rewardGrantorService.listByClan(clanId);
      const content =
        grantors.length > 0
          ? `Danh sách được reward (clan ${clanId}):\n${grantors
              .map(
                (entry) =>
                  `- ${entry.displayName} (${entry.rewarderId})`,
              )
              .join('\n')}`
          : 'Chưa có ai được cấp quyền reward trong clan này.';
      return reply(content);
    }

    if (
      usernames.length === 0 ||
      !action ||
      (action !== 'add' && action !== 'remove')
    ) {
      const content = `[RewardSetup]
- [add] u1 + u2 : cấp quyền reward cho user (username hoặc userId Mezon)
- [remove] u1 + u2 : gỡ quyền
- [list] : xem danh sách grantor trong clan

Ví dụ: *rewardsetup [add] mod.alice + mod.bob

Sau khi setup, grantor reward bằng cách: chuột phải tin nhắn của người nhận → chọn Quick Menu reward_<amount>.`;
      return reply(content);
    }

    if (action === 'add') {
      const result = await this.rewardGrantorService.addRewarders(
        clanId,
        usernames,
        senderId,
      );

      const lines = ['✅ Đã thêm vào danh sách được reward:'];
      if (result.added.length > 0) {
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

      return reply(lines.join('\n'));
    }

    if (action === 'remove') {
      const result = await this.rewardGrantorService.removeRewarders(
        clanId,
        usernames,
      );

      const lines = ['✅ Đã xóa khỏi danh sách được reward:'];
      if (result.removed.length > 0) {
        lines.push(result.removed.join(', '));
      }
      if (result.notFound.length > 0) {
        lines.push(`Không tìm thấy trong danh sách: ${result.notFound.join(', ')}`);
      }

      return reply(lines.join('\n'));
    }
  }
}
