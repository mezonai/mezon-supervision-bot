import { ChannelMessage, EMarkdownType, MezonClient } from 'mezon-sdk';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { Command } from 'src/bot/base/commandRegister.decorator';
import { CommandStorage } from 'src/bot/base/storage';
import { DynamicCommandService } from 'src/bot/services/dynamic.service';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { PermissionService } from 'src/bot/services/permission.service';

@Command('help')
export class HelpCommand extends CommandMessage {
  constructor(
    clientService: MezonClientService,
    private dynamicCommandService: DynamicCommandService,
    private permissionService: PermissionService,
  ) {
    super(clientService);
  }

  async execute(args: string[], message: ChannelMessage) {
    const messageChannel = await this.getChannelMessage(message);

    if (
      args[0] === 'user' &&
      this.permissionService.isAdmin(message.sender_id || '')
    ) {
      if (args[1]) {
        const user = this.client.users.get(args[1]);
        let messageContent = `userId: ${user?.id}, dmId: ${user?.dmChannelId}`;
        if (!user) {
          messageContent = 'Not found user';
        }
        return await messageChannel?.reply({
          t: messageContent,
          mk: [{ type: EMarkdownType.PRE, s: 0, e: messageContent.length }],
        });
      }

      const users = Array.from(this.client.users.values());
      const countDMChannel = users.filter((u) => !!u.dmChannelId).length;
      return await messageChannel?.reply({
        t: `Count init: ${countDMChannel}`,
      });
    }

    const allCommands = CommandStorage.getAllCommands();
    const allCommandsCustom =
      this.dynamicCommandService.getDynamicCommandList();
    const hidenCommandList = ['update', 'rewardsetup'];
    const allCommandKeys = Array.from(allCommands.keys()).filter(
      (item) => !hidenCommandList.includes(item),
    );
    const messageContent =
      'Mezon Supervision — Help' +
      '\n' +
      '• Commands (' +
      allCommandKeys.length +
      ')' +
      '\n' +
      allCommandKeys.join(', ');
    const messageSent = await messageChannel?.reply({
      t: messageContent,
      mk: [{ type: EMarkdownType.PRE, s: 0, e: messageContent.length }],
    });
    return messageSent;
  }
}
