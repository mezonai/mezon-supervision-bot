import { InjectRepository } from '@nestjs/typeorm';
import { ChannelMessage } from 'mezon-sdk';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { Command } from 'src/bot/base/commandRegister.decorator';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { PermissionService } from 'src/bot/services/permission.service';
import { Repository } from 'typeorm';
import { WelcomeMessage } from 'src/bot/models/welcomeMessage.entity';
import {
  buildBotEmbedPayload,
  buildPermissionDeniedPayload,
  EMBED_COLOR,
} from 'src/bot/utils/embed.util';

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
      return this.replyToMessage(
        message,
        buildPermissionDeniedPayload('Welcome Message Command'),
      );
    }

    const messageChannel = await this.getChannelMessage(message);
    const helpDescription =
      'Example: *welcomemsg welcome message content\n[username]: to get the user name\n[clanname]: to get clan name';

    if (!args[0] || !message.content.t) {
      return await messageChannel?.reply(
        buildBotEmbedPayload({
          title: 'Welcome Message Command',
          description: helpDescription,
        }),
      );
    }

    const fullMessage = message.content.t;
    const commandPrefix = '*welcomemsg ';
    const contentWithoutCommand = fullMessage.startsWith(commandPrefix)
      ? fullMessage.slice(commandPrefix.length).trim()
      : fullMessage.slice('*'.length).trim();

    await this.welcomeMessageRepository.upsert(
      {
        botId: process.env.SUPERVISION_BOT_ID,
        content: contentWithoutCommand,
      },
      ['botId'],
    );

    return await messageChannel?.reply(
      buildBotEmbedPayload({
        title: 'Welcome Message Command',
        description: contentWithoutCommand,
        color: EMBED_COLOR.SUCCESS,
      }),
    );
  }
}
