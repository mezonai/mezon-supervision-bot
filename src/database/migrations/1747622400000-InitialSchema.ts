import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fresh-install schema for supervision bot (local/dev).
 * TypeORM records executed migrations in table `migrations_info` (see AppModule).
 */
export class InitialSchema1747622400000 implements MigrationInterface {
  name = 'InitialSchema1747622400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "mebot_users" (
        "user_id" character varying NOT NULL,
        "username" text,
        "display_name" text,
        "clan_nick" text,
        "avatar" text,
        "bot" boolean,
        "last_message_id" text,
        "last_message_time" numeric,
        "last_mentioned_message_id" text,
        "last_bot_message_id" text,
        "deactive" boolean DEFAULT false,
        "botPing" boolean NOT NULL DEFAULT false,
        "createdAt" numeric,
        "amount" numeric DEFAULT 0,
        "invitor" jsonb DEFAULT '{}'::jsonb,
        "ban" jsonb DEFAULT '[]'::jsonb,
        CONSTRAINT "PK_mebot_users" PRIMARY KEY ("user_id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_mebot_users_bot_profile"
      ON "mebot_users" ("user_id", "username", "last_message_id", "last_bot_message_id", "deactive", "botPing")
    `);

    await queryRunner.query(`
      CREATE TABLE "mebot_transaction" (
        "id" SERIAL NOT NULL,
        "transactionId" text,
        "note" text,
        "amount" numeric DEFAULT 0,
        "sender_id" text,
        "receiver_id" text,
        "createAt" bigint,
        CONSTRAINT "PK_mebot_transaction" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_mebot_transaction_id_transactionId"
      ON "mebot_transaction" ("id", "transactionId")
    `);

    await queryRunner.query(`
      CREATE TABLE "mebot_welcomeMessage" (
        "botId" character varying NOT NULL,
        "content" text,
        CONSTRAINT "PK_mebot_welcomeMessage" PRIMARY KEY ("botId")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_mebot_welcomeMessage_botId"
      ON "mebot_welcomeMessage" ("botId")
    `);

    await queryRunner.query(`
      CREATE TABLE "mebot_reward_grantor" (
        "id" SERIAL NOT NULL,
        "rewarder_id" text NOT NULL,
        "clan_id" text NOT NULL,
        "granted_by" text,
        "createdAt" bigint NOT NULL DEFAULT (extract(epoch from now()) * 1000),
        CONSTRAINT "PK_mebot_reward_grantor" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_mebot_reward_grantor_clan_id"
      ON "mebot_reward_grantor" ("clan_id")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_mebot_reward_grantor_rewarder_clan"
      ON "mebot_reward_grantor" ("rewarder_id", "clan_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_mebot_reward_grantor_rewarder_clan"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_mebot_reward_grantor_clan_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "mebot_reward_grantor"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_mebot_welcomeMessage_botId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "mebot_welcomeMessage"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_mebot_transaction_id_transactionId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "mebot_transaction"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_mebot_users_bot_profile"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "mebot_users"`);
  }
}
