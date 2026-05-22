import { OnEvent } from '@nestjs/event-emitter';
import { EMarkdownType, Events } from 'mezon-sdk';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AddClanUserEvent } from 'mezon-sdk/dist/cjs/rtapi/realtime';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { WelcomeMessage } from '../models/welcomeMessage.entity';

@Injectable()
export class WelcomeMessageHandler {
  private readonly logger = new Logger(WelcomeMessageHandler.name);

  constructor(
    @InjectRepository(WelcomeMessage)
    private WelcomeMsgRepository: Repository<WelcomeMessage>,
    private clientService: MezonClientService,
  ) {}

  @OnEvent(Events.AddClanUser)
  async handleGuildMemberAdd(addClanUser: AddClanUserEvent) {
    const userId = addClanUser.user?.user_id;
    if (!userId) return;

    const botId = process.env.SUPERVISION_BOT_ID;
    if (botId && userId === botId) return;

    const client = this.clientService.getClient();
    const clan = await client.clans.get(addClanUser.clan_id);
    const welcomeMessage = await this.WelcomeMsgRepository.findOne({
      where: { botId },
    });
    if (!welcomeMessage || !clan) return;
    if (!welcomeMessage.content?.trim()) return;

    const clanname = clan.name.toUpperCase();
    const username =
      addClanUser.user?.username ||
      addClanUser.user?.display_name ||
      'bạn';
    const content = welcomeMessage.content
      .replace('[username]', username)
      .replace('[clanname]', clanname);

    try {
      const user = await this.clientService.fetchUserForDm(userId);
      await user.sendDM({
        t: content,
        mk: [{ type: EMarkdownType.PRE, s: 0, e: content.length }],
      });
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Welcome DM skipped for user ${userId} in clan ${addClanUser.clan_id}: ${detail}`,
      );
    }
  }
}
