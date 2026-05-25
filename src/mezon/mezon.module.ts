import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MezonClientBootConfig,
  MezonClientService,
} from './services/mezon-client.service';
import { MezonModuleAsyncOptions } from './dto/MezonModuleAsyncOptions';

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

            const client = new MezonClientService(clientConfig);
            await client.initializeClient();
            return client;
          },
          inject: [ConfigService],
        },
      ],
      exports: [MezonClientService],
    };
  }
}
