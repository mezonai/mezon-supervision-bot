import { ChannelMessage } from 'mezon-sdk';
import { Command } from 'src/bot/base/commandRegister.decorator';
import * as QRCode from 'qrcode';
import { EUserError } from 'src/bot/constants/error';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { User } from 'src/bot/models/user.entity';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import {
  buildBotEmbed,
  buildErrorPayload,
} from 'src/bot/utils/embed.util';
import { getRandomColor } from 'src/bot/utils/helps';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Command('qr')
export class QRCodeCommand extends CommandMessage {
  constructor(
    clientService: MezonClientService,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {
    super(clientService);
  }

  async execute(args: string[], message: ChannelMessage) {
    const messageChannel = await this.getChannelMessage(message);
    let userQuery: string = '';
    if (message.clan_id === '1779484504377790464') {
      return;
    }
    if (Array.isArray(message.references) && message.references.length) {
      userQuery = message.references[0].message_sender_username!;
    } else {
      if (
        Array.isArray(message.mentions) &&
        message.mentions.length &&
        args[0]?.startsWith('@')
      ) {
        const findUser = await this.userRepository.findOne({
          where: {
            user_id: message.mentions[0].user_id,
          },
        });
        userQuery = findUser?.username!;
      } else {
        userQuery = args.length ? args[0] : message.username!;
      }

      if (args[0]) {
        const findUserArg = await this.userRepository
          .createQueryBuilder('user')
          .where(
            '(user.clan_nick = :query OR user.username = :query OR user.user_id = :query)',
            { query: args[0] },
          )
          .getOne();
        if (findUserArg) {
          userQuery = findUserArg.username;
        }
      }
    }

    const findUser = await this.userRepository.findOne({
      where: { username: userQuery },
    });

    if (!findUser) {
      return await messageChannel?.reply(
        buildErrorPayload('QR Code Command', EUserError.INVALID_USER),
      );
    }

    const sendTokenData = {
      sender_id: message.sender_id,
      receiver_id: findUser.user_id,
      receiver_name: findUser.username,
    };
    const qrCodeDataUrl = await QRCode.toDataURL(
      JSON.stringify(sendTokenData),
      { errorCorrectionLevel: 'L' },
    );

    return await messageChannel?.reply({
      embed: [
        buildBotEmbed({
          color: getRandomColor(),
          title: `QR send Mezon Đồng to ${findUser.clan_nick || findUser.display_name || findUser.username}`,
          image: { url: qrCodeDataUrl },
        }),
      ],
    });
  }
}
