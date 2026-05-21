import { DynamicModule, Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MezonClientBootConfig,
  MezonClientService,
} from './services/mezon-client.service';
import { MezonModuleAsyncOptions } from './dto/MezonModuleAsyncOptions';
import {
  parseCommandChannel,
  parseSocketUseSsl,
  requireSocketHost,
} from './mezon-socket.config';

@Global()
@Module({})
export class MezonModule {
  static forRootAsync(options: MezonModuleAsyncOptions): DynamicModule {
    return {
      module: MezonModule,
      imports: options.imports,
      providers: [
        {
          provide: MezonClientService,
          useFactory: async (configService: ConfigService) => {
            const token = configService.get<string>('MEZON_TOKEN');
            const bot_id = process.env.SUPERVISION_BOT_ID;
            if (!token || !bot_id) return null;

            const clientConfig: MezonClientBootConfig = {
              botId: bot_id,
              token,
            };
            const gatewayHost = configService.get<string>('MEZON_GATEWAY_HOST');
            const gatewayPort = configService.get<string>('MEZON_GATEWAY_PORT');
            const gatewaySsl = configService.get<string>('MEZON_GATEWAY_USE_SSL');
            if (gatewayHost) clientConfig.host = gatewayHost;
            if (gatewayPort) clientConfig.port = gatewayPort;
            if (gatewaySsl === 'true' || gatewaySsl === 'false') {
              clientConfig.useSSL = gatewaySsl === 'true';
            }

            const socketEnv = {
              hostPort: requireSocketHost(
                configService.get<string>('MEZON_SOCKET_HOST'),
              ),
              useSSL: parseSocketUseSsl(
                configService.get<string>('MEZON_SOCKET_USE_SSL'),
              ),
            };

            const client = new MezonClientService(clientConfig, socketEnv);
            await client.initializeClient();

            const commandChannel = parseCommandChannel(
              configService.get<string>('MEZON_COMMAND_CHANNEL'),
            );
            if (commandChannel) {
              try {
                await client.joinCommandChannel(
                  commandChannel.clanId,
                  commandChannel.channelId,
                  commandChannel.channelType,
                );
              } catch (err) {
                Logger.error(
                  `MEZON_COMMAND_CHANNEL join failed (${MezonClientService.describeSocketError(err)})`,
                  err instanceof Error ? err.stack : undefined,
                  MezonModule.name,
                );
              }
            }

            return client;
          },
          inject: [ConfigService],
        },
      ],
      exports: [MezonClientService],
    };
  }
}
