import { ChannelMessage } from 'mezon-sdk';
import { Command } from 'src/bot/base/commandRegister.decorator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { User } from 'src/bot/models/user.entity';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { FuncType } from 'src/bot/constants/configs';
import { UserCacheService } from 'src/bot/services/user-cache.service';
import { PermissionService } from 'src/bot/services/permission.service';
import {
  buildBotEmbedPayload,
  buildPermissionDeniedPayload,
  EMBED_COLOR,
} from 'src/bot/utils/embed.util';

const BAN_HELP_FIELDS = [
  {
    name: 'username',
    value: 'Tên người bị ban (có thể nhiều user, phân cách bằng dấu phẩy).',
  },
  {
    name: 'type',
    value: 'Chức năng bị ban: reward hoặc all.',
  },
  {
    name: 'time',
    value: 'Thời gian ban (đơn vị: s, m, h, d).',
  },
  {
    name: 'note',
    value: 'Lý do ban.',
  },
];

const BAN_HELP_EXAMPLE =
  'Ví dụ: *ban username: a.nguyenvan, b.phamquoc type: reward time: 5m note: phá hoại';

@Command('ban')
export class BanCommand extends CommandMessage {
  constructor(
    clientService: MezonClientService,
    @InjectRepository(User) private userRepository: Repository<User>,
    private userCacheService: UserCacheService,
    private permissionService: PermissionService,
  ) {
    super(clientService);
  }

  async execute(args: string[], message: ChannelMessage) {
    if (!this.permissionService.isAdmin(message.sender_id || '')) {
      return this.replyToMessage(
        message,
        buildPermissionDeniedPayload('Ban Command'),
      );
    }

    const messageChannel = await this.getChannelMessage(message);
    const content = args.join(' ');
    const usernameMatch = content.match(/username:\s*(.+?)(?=\s+type:)/);
    const typeMatch = content.match(/type:\s*(\w+)/);
    const timeMatch = content.match(/time:\s*(\d+)([smhd])/);
    const noteMatch = content.match(/note:\s*(.+)/);

    if (!typeMatch || !timeMatch || !usernameMatch) {
      return await messageChannel?.reply(
        buildBotEmbedPayload({
          title: 'Ban Command',
          description: BAN_HELP_EXAMPLE,
          fields: BAN_HELP_FIELDS,
        }),
      );
    }

    const usernameRaw = usernameMatch[1].trim();
    const usernames = usernameRaw.split(',').map((u) => u.trim());
    const type = typeMatch[1];
    const timeValue = parseInt(timeMatch[1], 10);
    const unit = timeMatch[2];
    const note = noteMatch ? noteMatch[1] : '';

    const now = Math.floor(Date.now() / 1000);
    let duration = 0;

    switch (unit) {
      case 's':
        duration = timeValue;
        break;
      case 'm':
        duration = timeValue * 60;
        break;
      case 'h':
        duration = timeValue * 3600;
        break;
      case 'd':
        duration = timeValue * 86400;
        break;
      default:
        return await messageChannel?.reply(
          buildBotEmbedPayload({
            title: 'Ban Command',
            description: BAN_HELP_EXAMPLE,
            fields: BAN_HELP_FIELDS,
          }),
        );
    }

    let funcType = '';
    switch (type) {
      case FuncType.REWARD:
        funcType = FuncType.REWARD;
        break;
      case FuncType.ALL:
        funcType = FuncType.ALL;
        break;
      default:
        return await messageChannel?.reply(
          buildBotEmbedPayload({
            title: 'Ban Command',
            description: BAN_HELP_EXAMPLE,
            fields: BAN_HELP_FIELDS,
          }),
        );
    }

    const expiresAt = now + duration;
    const userban: string[] = [];
    for (const username of usernames) {
      const findUser = await this.userRepository.findOne({
        where: { username },
      });

      if (!findUser) continue;

      const user = await this.userCacheService.getUserFromCache(findUser.user_id);
      if (!user) continue;

      const bans = Array.isArray(user.ban) ? user.ban : [];
      const idx = bans.findIndex((b) => b.type === funcType);

      if (idx >= 0) {
        bans[idx].unBanTime = expiresAt;
        bans[idx].note = note;
      } else {
        bans.push({ type: funcType, unBanTime: expiresAt, note });
      }

      user.ban = bans;
      await this.userCacheService.updateUserCache(findUser.user_id, user);
      userban.push(username);
    }

    if (userban.length > 0) {
      return await messageChannel?.reply(
        buildBotEmbedPayload({
          title: 'Ban Command',
          description: `${userban.join(', ')} đã bị ban ${funcType}`,
          color: EMBED_COLOR.SUCCESS,
        }),
      );
    }
  }
}
