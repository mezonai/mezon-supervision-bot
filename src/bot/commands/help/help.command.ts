import { ChannelMessage, EMarkdownType } from 'mezon-sdk';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { Command } from 'src/bot/base/commandRegister.decorator';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import {
  NO_ADMIN_PERMISSION_MESSAGE,
  PermissionService,
} from 'src/bot/services/permission.service';
import {
  MEZON_EMBED_AUTHOR,
  MEZON_EMBED_FOOTER,
} from 'src/bot/constants/configs';

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
        return this.replyEphemeralToSender(message, {
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
        return this.replyEphemeralToSender(message, {
          t: messageContent,
          mk: [{ type: EMarkdownType.PRE, s: 0, e: messageContent.length }],
        });
      }

      const users = Array.from(this.client.users.values());
      const countDMChannel = users.filter((u) => !!u.dmChannelId).length;
      return this.replyEphemeralToSender(message, {
        t: `Count init: ${countDMChannel}`,
      });
    }

    return this.replyEphemeralToSender(message, {
      embed: [
        {
          title: 'Help - Command List',
          description:
            'Here are the available commands for Mezon Supervision Bot.',
          fields: this.permissionService.formatHelpMessage(isAdmin),
          author: MEZON_EMBED_AUTHOR,
          timestamp: new Date().toISOString(),
          footer: MEZON_EMBED_FOOTER,
        },
      ],
    });
  }
}
