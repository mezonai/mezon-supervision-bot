import { ChannelMessage, EMarkdownType } from 'mezon-sdk';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { Command } from 'src/bot/base/commandRegister.decorator';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import {
  NO_ADMIN_PERMISSION_MESSAGE,
  PermissionService,
} from 'src/bot/services/permission.service';

@Command('help')
export class HelpCommand extends CommandMessage {
  constructor(
    clientService: MezonClientService,
    private permissionService: PermissionService,
  ) {
    super(clientService);
  }

  async execute(args: string[], message: ChannelMessage) {
    const senderId = String(message.sender_id || '');
    const isAdmin = this.permissionService.isAdmin(senderId);

    if (args[0] === 'user') {
      if (!isAdmin) {
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

      if (args[1]) {
        const user = this.client.users.get(args[1]);
        let messageContent = `userId: ${user?.id}, dmId: ${user?.dmChannelId}`;
        if (!user) {
          messageContent = 'Not found user';
        }
        return this.replyToMessage(message, {
          t: messageContent,
          mk: [{ type: EMarkdownType.PRE, s: 0, e: messageContent.length }],
        });
      }

      const users = Array.from(this.client.users.values());
      const countDMChannel = users.filter((u) => !!u.dmChannelId).length;
      return this.replyToMessage(message, {
        t: `Count init: ${countDMChannel}`,
      });
    }

    const messageContent = this.permissionService.formatHelpMessage(isAdmin);
    return this.replyToMessage(message, {
      t: messageContent,
      mk: [{ type: EMarkdownType.PRE, s: 0, e: messageContent.length }],
    });
  }
}
