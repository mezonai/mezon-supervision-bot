import { InjectRepository } from '@nestjs/typeorm';
import { ChannelMessage, EMarkdownType } from 'mezon-sdk';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { Command } from 'src/bot/base/commandRegister.decorator';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import {
  NO_ADMIN_PERMISSION_MESSAGE,
  PermissionService,
} from 'src/bot/services/permission.service';
import { Repository } from 'typeorm';
import { WelcomeMessage } from 'src/bot/models/welcomeMessage.entity';

@Command('welcomemsg')
export class WelcomeMsgCommand extends CommandMessage {
  constructor(
    clientService: MezonClientService,
    @InjectRepository(WelcomeMessage)
    private welcomeMessageRepository: Repository<WelcomeMessage>,
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
    let messageContent =
      'welcome message content is not given! \n Example: *welcomemsg welcome message content \n [username]: to get the user name \n [clanname]: to get clan name';
    if (!args[0] || !message.content.t) {
      return await messageChannel?.reply({
        t: messageContent,
        mk: [
          {
            type: EMarkdownType.PRE,
            s: 0,
            e: messageContent.length,
          },
        ],
      });
    }

    const fullMessage = message.content.t;
    const commandPrefix = '*welcomemsg ';
    const contentWithoutCommand = fullMessage.startsWith(commandPrefix)
      ? fullMessage.slice(commandPrefix.length).trim()
      : fullMessage.slice('*'.length).trim();
    const dataMezonBotMessage = {
      botId: process.env.SUPERVISION_BOT_ID,
      content: contentWithoutCommand,
    };
    await this.welcomeMessageRepository.upsert(dataMezonBotMessage, ['botId']);
    return await messageChannel?.reply({
      t: contentWithoutCommand,
      mk: [
        {
          type: EMarkdownType.PRE,
          s: 0,
          e: contentWithoutCommand.length,
        },
      ],
    });
  }
}
