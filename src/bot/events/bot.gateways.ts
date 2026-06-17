import { Injectable, Logger } from '@nestjs/common';
import {
  ApiMessageReaction,
  MezonClient,
  Events,
  TokenSentEvent,
  StreamingJoinedEvent,
  StreamingLeavedEvent,
  UserChannelRemoved,
  GiveCoffeeEvent,
  AddClanUserEvent,
  QuickMenuEvent,
  ChannelCreatedEvent,
  ChannelDeletedEvent,
  ChannelUpdatedEvent,
  UserChannelAddedEvent,
  UserClanRemovedEvent,
} from 'mezon-sdk';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { ExtendersService } from '../services/extenders.services';
import { BotEmbedAuthorService } from '../services/bot-embed-author.service';
import { pickMessageAvatar } from '../utils/user-avatar.util';

@Injectable()
export class BotGateway {
  private readonly logger = new Logger(BotGateway.name);
  private client: MezonClient;

  constructor(
    clientService: MezonClientService,
    private extendersService: ExtendersService,
    private botEmbedAuthorService: BotEmbedAuthorService,
    private eventEmitter: EventEmitter2,
  ) {
    this.client = clientService.getClient();
  }

  initEvent() {
    this.client.onTokenSend((data: TokenSentEvent) => {
      this.eventEmitter.emit(Events.TokenSend, data);
    });

    this.client.onStreamingJoinedEvent((data: StreamingJoinedEvent) => {
      this.eventEmitter.emit(Events.StreamingJoinedEvent, data);
    });

    this.client.onStreamingLeavedEvent((data: StreamingLeavedEvent) => {
      this.eventEmitter.emit(Events.StreamingLeavedEvent, data);
    });

    this.client.onClanEventCreated((data) => {
      this.eventEmitter.emit(Events.ClanEventCreated, data);
    });

    this.client.onMessageReaction((msg: ApiMessageReaction) => {
      this.eventEmitter.emit(Events.MessageReaction, msg);
    });

    this.client.onChannelCreated((channel: ChannelCreatedEvent) => {
      this.eventEmitter.emit(Events.ChannelCreated, channel);
    });

    this.client.onUserClanRemoved((user: UserClanRemovedEvent) => {
      this.eventEmitter.emit(Events.UserClanRemoved, user);
    });

    this.client.onUserChannelAdded((event: UserChannelAddedEvent) => {
      this.eventEmitter.emit(Events.UserChannelAdded, event);
    });

    this.client.onChannelDeleted((channel: ChannelDeletedEvent) => {
      this.eventEmitter.emit(Events.ChannelDeleted, channel);
    });

    this.client.onChannelUpdated((channel: ChannelUpdatedEvent) => {
      this.eventEmitter.emit(Events.ChannelUpdated, channel);
    });

    this.client.onUserChannelRemoved((msg: UserChannelRemoved) => {
      this.eventEmitter.emit(Events.UserChannelRemoved, msg);
    });

    this.client.onGiveCoffee((data: GiveCoffeeEvent) => {
      this.eventEmitter.emit(Events.GiveCoffee, data);
    });

    this.client.onQuickMenuEvent((data) => {
      const payload = (data as QuickMenuEvent).quick_menu_event ?? data;
      this.eventEmitter.emit(Events.QuickMenu, {
        quick_menu_event: payload,
      } as QuickMenuEvent);
    });

    this.client.onAddClanUser(async (data: AddClanUserEvent) => {
      this.eventEmitter.emit(Events.AddClanUser, data);
      if (!data?.user?.user_id) return;
      try {
        await this.extendersService.addDBUser(
          {
            user_id: data.user.user_id,
            username: data.user.username || '',
            avatar: data.user.avatar || '',
            display_name: data.user.display_name,
          },
          data.invitor || '',
          data.clan_id || '',
        );
      } catch (err) {
        this.logger.warn(
          `addDBUser on AddClanUser failed user_id=${data.user.user_id}`,
          err,
        );
      }
    });

    this.client.onChannelMessage(async (message) => {
      ['attachments', 'mentions', 'references'].forEach((key) => {
        if (!Array.isArray(message[key])) message[key] = [];
      });
      try {
        if (message.sender_id && message.sender_id !== '0') {
          const botId = process.env.SUPERVISION_BOT_ID;
          if (botId && String(message.sender_id) === botId) {
            const botAvatar = pickMessageAvatar(
              message.avatar,
              message.clan_avatar,
            );
            if (botAvatar) {
              this.botEmbedAuthorService.syncFromAvatar(botAvatar);
            }
          }

          const user: any = {
            user_id: message.sender_id,
            username: message.username,
            avatar: message.avatar,
            display_name: message.display_name,
            message_id: message.message_id,
            clan_avatar: message.clan_avatar,
            clan_nick: message.clan_nick,
          };
          await this.extendersService.addDBUser(user, '', '');
        }
      } catch (e) {
        this.logger.warn('addDBUser on ChannelMessage failed', e);
      }
      this.eventEmitter.emit(Events.ChannelMessage, message);
    });
  }
}
