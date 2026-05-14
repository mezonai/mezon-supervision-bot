import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { MulterModule } from '@nestjs/platform-express';

import { TypeOrmModule } from '@nestjs/typeorm';

import { ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { User } from './models/user.entity';
import { ExtendersService } from './services/extenders.services';
import { DynamicCommandService } from './services/dynamic.service';
import { HelpCommand } from './commands/help/help.command';
import { BotGateway } from './events/bot.gateways';
import { ListenerChannelMessage } from './listeners/onChannelMessage.listener';
import { CommandBase } from './base/command.handle';
import { AvatarCommand } from './commands/avatar/avatar.command';
import { MezonBotMessage } from './models/mezonBotMessage.entity';
import { ListenerMessageButtonClicked } from './listeners/onMessageButtonClicked.listener';
import { QRCodeCommand } from './commands/qrcode/qrcode.command';
import { ListenerTokenSend } from './listeners/tokensend.handle';
import { WelcomeMessageHandler } from './listeners/welcomeMessages';
import { WelcomeMessage } from './models/welcomeMessage.entity';
import { WelcomeMsgCommand } from './commands/welcomeMessages/welcomeMessages.command';
import { WelcomeMsgInfoCommand } from './commands/welcomeMessages/welcomeMessagesInfo.command';
import { RoleCommand } from './commands/selfAssignableRoles/role.command';
import { RoleService } from './commands/selfAssignableRoles/role.service';
import { WhiteListAddCommand } from './commands/selfAssignableRoles/whiteList';
import { LixiCommand } from './lixi/lixi.command';
import { LixiService } from './lixi/lixi.service';
import { BanCommand } from './commands/ban/ban';
import { UnbanCommand } from './commands/ban/unban';
import { Transaction } from './models/transaction.entity';
import { UpdateCommand } from './commands/update/update.command';
import { RedisCacheService } from './services/redis-cache.service';
import { UserCacheService } from './services/user-cache.service';
import { ReplyStatsService } from './services/reply-stats.service';

@Module({
  imports: [
    MulterModule.register({
      dest: './files',
    }),
    DiscoveryModule,
    TypeOrmModule.forFeature([
      User,
      MezonBotMessage,
      WelcomeMessage,
      Transaction,
    ]),
    HttpModule,
  ],
  providers: [
    CommandBase,
    BotGateway,
    ListenerChannelMessage,
    ListenerMessageButtonClicked,
    HelpCommand,
    AvatarCommand,
    QRCodeCommand,
    ConfigService,
    ExtendersService,
    DynamicCommandService,
    RedisCacheService,
    UserCacheService,
    ReplyStatsService,
    ListenerTokenSend,
    WelcomeMessageHandler,
    WelcomeMsgCommand,
    WelcomeMsgInfoCommand,
    RoleCommand,
    RoleService,
    WhiteListAddCommand,
    LixiCommand,
    LixiService,
    BanCommand,
    UnbanCommand,
    UpdateCommand,
  ],
  controllers: [],
})
export class BotModule {}
