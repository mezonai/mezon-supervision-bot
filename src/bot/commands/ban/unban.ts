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

const UNBAN_HELP_FIELDS = [
  {
    name: 'username',
    value: 'Tên người bị ban (có thể nhiều user, phân cách bằng dấu phẩy).',
  },
  {
    name: 'type',
    value: 'Chức năng bị ban: reward hoặc all.',
  },
];

const UNBAN_HELP_EXAMPLE =
  'Ví dụ: *unban username: a.nguyenvan, b.phamquoc type: reward';

@Command('unban')
export class UnbanCommand extends CommandMessage {
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
        buildPermissionDeniedPayload('Unban Command'),
      );
    }

    const messageChannel = await this.getChannelMessage(message);
    const content = args.join(' ');
    const usernameMatch = content.match(/username:\s*(.+?)(?=\s+type:|$)/);
    const typeMatch = content.match(/type:\s*(\w+)/);

    if (!typeMatch || !usernameMatch) {
      return await messageChannel?.reply(
        buildBotEmbedPayload({
          title: 'Unban Command',
          description: UNBAN_HELP_EXAMPLE,
          fields: UNBAN_HELP_FIELDS,
        }),
      );
    }

    const usernameRaw = usernameMatch[1].trim();
    const usernames = usernameRaw.split(',').map((u) => u.trim());
    const type = typeMatch[1];

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
            title: 'Unban Command',
            description: UNBAN_HELP_EXAMPLE,
            fields: UNBAN_HELP_FIELDS,
          }),
        );
    }

    const unbanned: string[] = [];
    for (const username of usernames) {
      const findUser = await this.userRepository.findOne({
        where: { username },
      });

      if (!findUser) continue;

      const user = await this.userCacheService.getUserFromCache(findUser.user_id);
      if (!user) continue;

      const bans = Array.isArray(user.ban) ? user.ban : [];
      if (funcType === FuncType.ALL) {
        user.ban = [];
        await this.userCacheService.updateUserCache(findUser.user_id, user);
        unbanned.push(username);
        continue;
      }

      const updatedBans = bans.filter((b) => b.type !== funcType);
      if (updatedBans.length === bans.length) continue;

      user.ban = updatedBans;
      await this.userCacheService.updateUserCache(findUser.user_id, user);
      unbanned.push(username);
    }

    if (unbanned.length > 0) {
      return await messageChannel?.reply(
        buildBotEmbedPayload({
          title: 'Unban Command',
          description: `${unbanned.join(', ')} đã được unban ${funcType}`,
          color: EMBED_COLOR.SUCCESS,
        }),
      );
    }
  }
}
