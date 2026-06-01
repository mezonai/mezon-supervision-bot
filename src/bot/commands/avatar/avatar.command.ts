import { InjectRepository } from '@nestjs/typeorm';
import { ChannelMessage } from 'mezon-sdk';
import { CommandMessage } from 'src/bot/base/command.abstract';
import { Command } from 'src/bot/base/commandRegister.decorator';
import { EUserError } from 'src/bot/constants/error';
import { User } from 'src/bot/models/user.entity';
import {
  buildBotEmbed,
  buildErrorPayload,
} from 'src/bot/utils/embed.util';
import { getRandomColor } from 'src/bot/utils/helps';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { UserAvatarService } from 'src/bot/services/user-avatar.service';
import { Repository } from 'typeorm';

@Command('avatar')
export class AvatarCommand extends CommandMessage {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    clientService: MezonClientService,
    private userAvatarService: UserAvatarService,
  ) {
    super(clientService);
  }

  async execute(args: string[], message: ChannelMessage) {
    const messageChannel = await this.getChannelMessage(message);
    if (message.clan_id === '1779484504377790464') {
      return;
    }

    let referenceAvatar: string | undefined;
    let findUser: User | null = null;

    if (Array.isArray(message.references) && message.references.length) {
      const ref = message.references[0];
      referenceAvatar = ref.message_sender_avatar;
      if (ref.message_sender_id) {
        findUser = await this.userRepository.findOne({
          where: { user_id: ref.message_sender_id },
        });
      }
      if (!findUser && ref.message_sender_username) {
        findUser = await this.userRepository.findOne({
          where: { username: ref.message_sender_username },
        });
      }
    } else {
      let userQuery: string | undefined;

      if (
        Array.isArray(message.mentions) &&
        message.mentions.length &&
        args[0]?.startsWith('@')
      ) {
        const mention = message.mentions[0];
        findUser = await this.userRepository.findOne({
          where: { user_id: mention.user_id },
        });
        userQuery = findUser?.username;
      } else {
        userQuery = args.length ? args[0] : message.username;
      }

      if (args[0]) {
        const findUserArg = await this.userRepository
          .createQueryBuilder('user')
          .where(
            '(user.clan_nick = :query OR user.username = :query OR user.user_id = :query)',
            { query: args[0] },
          )
          .orderBy(
            'CASE WHEN user.clan_nick = :query THEN 1 WHEN user.username = :query THEN 2 ELSE 3 END',
          )
          .getOne();
        if (findUserArg) {
          findUser = findUserArg;
          userQuery = findUserArg.username;
        }
      }

      if (!findUser && userQuery) {
        findUser = await this.userRepository.findOne({
          where: { username: userQuery },
        });
      }
    }

    if (!findUser) {
      return await messageChannel?.reply(
        buildErrorPayload('Avatar Command', EUserError.INVALID_USER),
      );
    }

    const avatarUrl = await this.userAvatarService.resolveLatestAvatar(
      findUser.user_id,
      {
        dbAvatar: findUser.avatar,
        referenceAvatar,
      },
    );

    if (!avatarUrl) {
      return await messageChannel?.reply(
        buildErrorPayload('Avatar Command', EUserError.INVALID_USER),
      );
    }

    return messageChannel?.reply({
      embed: [
        buildBotEmbed({
          color: getRandomColor(),
          title: `${findUser.clan_nick || findUser.display_name || findUser.username}'s avatar`,
          image: { url: avatarUrl },
        }),
      ],
    });
  }
}
