import { Module } from '@nestjs/common';
import Joi from 'joi';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BotModule } from './bot/bot.module';
import { MezonModule } from './mezon/mezon.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_DATA_SOURCE_MIGRATIONS } from './database/app-migrations';

@Module({
  imports: [
    ConfigModule.forRoot({
      validationSchema: Joi.object({
        POSTGRES_HOST: Joi.string().required(),
        POSTGRES_PORT: Joi.number().required(),
        POSTGRES_USER: Joi.string().required(),
        POSTGRES_PASSWORD: Joi.string().required(),
        POSTGRES_DB: Joi.string().required(),
        MEZON_TOKEN: Joi.string().required(),
        SUPERVISION_BOT_ID: Joi.string().required(),
        BOT_ADMIN_IDS: Joi.string().required(),
        // Optional: override default gateway gw.mezon.ai:443 (SDK default).
        MEZON_GATEWAY_HOST: Joi.string().optional(),
        MEZON_GATEWAY_PORT: Joi.string().optional(),
        MEZON_GATEWAY_USE_SSL: Joi.string().valid('true', 'false').optional(),
        REWARD_MAX_AMOUNT: Joi.string().optional(),
        REWARD_MAX_PER_DAY: Joi.string().optional(),
        REWARD_MENU_PREFIX: Joi.string().optional(),
        PORT: Joi.number().optional(),
        REDIS_HOST: Joi.string().optional(),
        REDIS_PORT: Joi.number().optional(),
        TYPEORM_LOGGING: Joi.string().valid('true', 'false').optional(),
      }),
    }),
    EventEmitterModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('POSTGRES_HOST'),
        port: configService.get('POSTGRES_PORT'),
        username: configService.get('POSTGRES_USER'),
        password: configService.get('POSTGRES_PASSWORD'),
        database: configService.get('POSTGRES_DB'),
        autoLoadEntities: true,
        synchronize: false,
        migrations: APP_DATA_SOURCE_MIGRATIONS,
        migrationsTableName: 'migrations_info',
        migrationsRun: true,
        logging: configService.get<string>('TYPEORM_LOGGING') === 'true',
      }),
    }),
    MezonModule.forRootAsync({
      imports: [ConfigModule],
    }),
    BotModule,
  ],
})
export class AppModule {}
