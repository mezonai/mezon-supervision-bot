import { ChannelMessage } from 'mezon-sdk';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { Command } from 'src/bot/base/commandRegister.decorator';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { PermissionService } from 'src/bot/services/permission.service';
import {
  buildBotEmbedPayload,
  buildPermissionDeniedPayload,
} from 'src/bot/utils/embed.util';

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
        return this.replyEphemeralToSender(
          message,
          buildPermissionDeniedPayload('Help Command'),
        );
      }

      if (args[1]) {
        const user = this.client.users.get(args[1]);
        const messageContent = user
          ? `userId: ${user.id}, dmId: ${user.dmChannelId}`
          : 'Not found user';
        return this.replyEphemeralToSender(
          message,
          buildBotEmbedPayload({
            title: 'Help - User Info',
            description: messageContent,
          }),
        );
      }

      const users = Array.from(this.client.users.values());
      const countDMChannel = users.filter((u) => !!u.dmChannelId).length;
      return this.replyEphemeralToSender(
        message,
        buildBotEmbedPayload({
          title: 'Help - User Stats',
          description: `Count init: ${countDMChannel}`,
        }),
      );
    }

    return this.replyEphemeralToSender(
      message,
      buildBotEmbedPayload({
        title: 'Help - Command List',
        description:
          'Here are the available commands for Mezon Supervision Bot.',
        fields: this.permissionService.formatHelpMessage(isAdmin),
      }),
    );
  }
}
