import {
  ChannelMessage,
  ChannelMessageContent,
  MezonClient,
} from 'mezon-sdk';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';

export abstract class CommandMessage {
  protected client: MezonClient;

  constructor(protected clientService: MezonClientService) {
    this.client = this.clientService.getClient();
  }

  protected async getChannelMessage(message: ChannelMessage) {
    const messageId = message.message_id || message.id;
    const clanId = message.clan_id;
    const channelId = message.channel_id;
    if (!clanId || !channelId || !messageId) return undefined;

    const channel = await this.resolveTextChannel(clanId, channelId);
    if (!channel) return undefined;

    try {
      return await channel.messages.fetch(messageId);
    } catch {
      // Race: command handler may run before _initChannelMessageCache persists the message.
      return undefined;
    }
  }

  protected async resolveTextChannel(clanId: string, channelId: string) {
    const clan = this.client.clans.get(clanId);
    const fromClan = clan
      ? await clan.channels.fetch(channelId).catch(() => null)
      : null;
    if (fromClan) return fromClan;
    return this.client.channels.fetch(channelId).catch(() => null);
  }

  /** Reply in-thread when possible; otherwise send a new channel message. */
  protected async replyToMessage(
    message: ChannelMessage,
    payload: ChannelMessageContent,
  ): Promise<void> {
    const existing = await this.getChannelMessage(message);
    if (existing) {
      await existing.reply(payload);
      return;
    }
    const channel = await this.resolveTextChannel(
      message.clan_id!,
      message.channel_id,
    );
    await channel?.send(payload);
  }

  abstract execute(
    args: string[],
    message: ChannelMessage,
    commandName?: string,
  ): any;
}
