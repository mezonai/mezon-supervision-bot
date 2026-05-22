import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { MezonClientService } from 'src/mezon/services/mezon-client.service';
import { ExtendersService } from './extenders.services';

@Injectable()
export class BotBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BotBootstrapService.name);

  constructor(
    private readonly clientService: MezonClientService,
    private readonly extendersService: ExtendersService,
  ) {}

  async onApplicationBootstrap() {
    try {
      await this.extendersService.ensureBotUser(this.clientService.getClient());
    } catch (error) {
      this.logger.error(
        'Failed to seed bot user in mebot_users — reward and rewardsetup will not work',
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
