import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from './models/user.entity';
import { ExtendersService } from './services/extenders.services';
import { HelpCommand } from './commands/help/help.command';
import { BotGateway } from './events/bot.gateways';
import { ListenerChannelMessage } from './listeners/onChannelMessage.listener';
import { CommandBase } from './base/command.handle';
import { AvatarCommand } from './commands/avatar/avatar.command';
import { QRCodeCommand } from './commands/qrcode/qrcode.command';
import { ListenerTokenSend } from './listeners/tokensend.handle';
import { WelcomeMessageHandler } from './listeners/welcomeMessages';
import { WelcomeMessage } from './models/welcomeMessage.entity';
import { WelcomeMsgCommand } from './commands/welcomeMessages/welcomeMessages.command';
import { WelcomeMsgInfoCommand } from './commands/welcomeMessages/welcomeMessagesInfo.command';
import { BanCommand } from './commands/ban/ban';
import { UnbanCommand } from './commands/ban/unban';
import { RewardGrantor } from './models/rewardGrantor.entity';
import { UpdateCommand } from './commands/update/update.command';
import { RedisCacheService } from './services/redis-cache.service';
import { UserCacheService } from './services/user-cache.service';
import { ReplyStatsService } from './services/reply-stats.service';
import { PermissionService } from './services/permission.service';
import { Transaction } from './models/transaction.entity';
import { RewardGrantorService } from './reward/reward-grantor.service';
import { RewardSetupCommand } from './reward/reward-setup.command';
import { RewardLeaderboardCommand } from './reward/reward-leaderboard.command';
import { RewardService } from './reward/reward.service';
import { ListenerQuickMenuReward } from './listeners/quickMenu.reward.listener';
import { BotEmbedAuthorService } from './services/bot-embed-author.service';
import { UserAvatarService } from './services/user-avatar.service';

@Module({
  imports: [
    DiscoveryModule,
    TypeOrmModule.forFeature([User, WelcomeMessage, Transaction, RewardGrantor]),
  ],
  providers: [
    CommandBase,
    BotGateway,
    ListenerChannelMessage,
    HelpCommand,
    AvatarCommand,
    QRCodeCommand,
    ExtendersService,
    RedisCacheService,
    UserCacheService,
    ReplyStatsService,
    ListenerTokenSend,
    WelcomeMessageHandler,
    WelcomeMsgCommand,
    WelcomeMsgInfoCommand,
    BanCommand,
    UnbanCommand,
    UpdateCommand,
    PermissionService,
    RewardGrantorService,
    RewardSetupCommand,
    RewardLeaderboardCommand,
    RewardService,
    ListenerQuickMenuReward,
    BotEmbedAuthorService,
    UserAvatarService,
  ],
  controllers: [],
})
export class BotModule {}
