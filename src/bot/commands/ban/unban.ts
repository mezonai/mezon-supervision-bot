import { ChannelMessage, EMarkdownType } from 'mezon-sdk';
import { Command } from 'src/bot/base/commandRegister.decorator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { User } from 'src/bot/models/user.entity';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { FuncType } from 'src/bot/constants/configs';
import { UserCacheService } from 'src/bot/services/user-cache.service';
import { PermissionService, NO_ADMIN_PERMISSION_MESSAGE } from 'src/bot/services/permission.service';

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
      return this.replyToMessage(message, {
        t: NO_ADMIN_PERMISSION_MESSAGE,
        mk: [
          {
            type: EMarkdownType.PRE,
            s: 0,
            e: NO_ADMIN_PERMISSION_MESSAGE.length,
          },
        ],
      });
    }

    const messageChannel = await this.getChannelMessage(message);
    const content = args.join(' ');
    const usernameMatch = content.match(/\[username\]:\s*([^\[\]]+)/);
    const typeMatch = content.match(/\[type\]:\s*(\w+)/);

    if (!typeMatch || !usernameMatch) {
      const content = `[Unban]
        - [username]: tên người bị ban
        - [type]: ban chức năng (reward, all)
        Ex: *unban [username]: a.nguyenvan, b.phamquoc [type]: reward`;

      return await messageChannel?.reply({
        t: content,
        mk: [
          {
            type: EMarkdownType.PRE,
            s: 0,
            e: content.length,
          },
        ],
      });
    }
    const usernameRaw = usernameMatch[1].trim();
    const usernames = usernameRaw.split(',').map((u) => u.trim());
    const type = typeMatch[1];

    const now = Math.floor(Date.now() / 1000);

    let funcType = '';
    switch (type) {
      case FuncType.REWARD:
        funcType = FuncType.REWARD;
        break;
      case FuncType.ALL:
        funcType = FuncType.ALL;
        break;
      default:
        const content = `[unban]
        - [username]: tên người bị ban
        - [type]: ban chức năng (reward, all)
        Ex: *unban [username]: a.nguyenvan, b.phamquoc [type]: reward`;

        return await messageChannel?.reply({
          t: content,
          mk: [
            {
              type: EMarkdownType.PRE,
              s: 0,
              e: content.length,
            },
          ],
        });
    }

    let unbanned: string[] = [];
    for (const username of usernames) {
      const findUser = await this.userRepository.findOne({
        where: {
          username: username,
        },
      });

      if (!findUser) {
        continue;
      }
      const user = await this.userCacheService.getUserFromCache(
        findUser.user_id,
      );
      if (!user) {
        continue;
      }

      const bans = Array.isArray(user.ban) ? user.ban : [];
      if (funcType === FuncType.ALL) {
        user.ban = [];
        await this.userCacheService.updateUserCache(findUser.user_id, user);
        unbanned.push(username);
        continue;
      }
      const updatedBans = bans.filter((b) => b.type !== funcType);
      if (updatedBans.length === bans.length) {
        continue;
      }

      user.ban = updatedBans;
      await this.userCacheService.updateUserCache(findUser.user_id, user);
      unbanned.push(username);
    }

    let contentMsg = '';
    if (unbanned.length > 0) {
      contentMsg = `${unbanned.join(', ')} đã được unban ${funcType}`;
      return await messageChannel?.reply({
        t: contentMsg,
        mk: [
          {
            type: EMarkdownType.PRE,
            s: 0,
            e: contentMsg.length,
          },
        ],
      });
    }
  }
}
