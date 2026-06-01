import { InjectRepository } from '@nestjs/typeorm';
import { ChannelMessage } from 'mezon-sdk';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { Command } from 'src/bot/base/commandRegister.decorator';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { Repository } from 'typeorm';
import { WelcomeMessage } from 'src/bot/models/welcomeMessage.entity';
import { buildBotEmbedPayload } from 'src/bot/utils/embed.util';

@Command('welcomemsginfo')
export class WelcomeMsgInfoCommand extends CommandMessage {
  constructor(
    clientService: MezonClientService,
    @InjectRepository(WelcomeMessage)
    private welcomeMessageRepository: Repository<WelcomeMessage>,
  ) {
    super(clientService);
  }

  async execute(args: string[], message: ChannelMessage) {
    const messageChannel = await this.getChannelMessage(message);
    const welcomeMessage = await this.welcomeMessageRepository.findOne({
      where: { botId: process.env.SUPERVISION_BOT_ID },
    });

    if (!welcomeMessage) {
      return await messageChannel?.reply(
        buildBotEmbedPayload({
          title: 'Welcome Message Info',
          description: 'Welcome message chưa được cập nhật.',
        }),
      );
    }

    return await messageChannel?.reply(
      buildBotEmbedPayload({
        title: 'Welcome Message Info',
        description: welcomeMessage.content,
      }),
    );
  }
}
