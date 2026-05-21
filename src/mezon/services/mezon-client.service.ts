import { Injectable, Logger } from '@nestjs/common';
import { MezonClient } from 'mezon-sdk';
import {
  joinSocketChat,
  MezonSocketEnv,
  reconnectSocketFromEnv,
} from '../mezon-client.internals';

export type MezonClientBootConfig = ConstructorParameters<typeof MezonClient>[0];

@Injectable()
export class MezonClientService {
  private readonly logger = new Logger(MezonClientService.name);
  private client: MezonClient;

  constructor(
    config: MezonClientBootConfig,
    private readonly socketEnv: MezonSocketEnv,
  ) {
    this.client = new MezonClient(config);
  }

  async initializeClient() {
    try {
      const result = await this.client.login();
      await reconnectSocketFromEnv(this.client, this.socketEnv);
      const scheme = this.socketEnv.useSSL ? 'wss' : 'ws';
      this.logger.log(`socket ${scheme}://${this.socketEnv.hostPort}`);

      const session = MezonClientService.parseLoginSession(result);
      if (session?.ws_url && session.ws_url !== this.socketEnv.hostPort) {
        this.logger.log(`API ws_url=${session.ws_url} (using .env socket)`);
      }
    } catch (error) {
      const detail = MezonClientService.describeLoginError(error);
      this.logger.error(
        `error authenticating.${detail ? ` ${detail}` : ''}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  /** UI messages / *commands use is_public=false on public channels. */
  async joinCommandChannel(
    clanId: string,
    channelId: string,
    channelType = 1,
  ): Promise<void> {
    await joinSocketChat(this.client, clanId, channelId, channelType, false);
    this.logger.log(`joined command channel ${clanId}/${channelId}`);
  }

  getClient() {
    return this.client;
  }

  private static parseLoginSession(
    loginResult: string,
  ): { api_url?: string; ws_url?: string } | null {
    try {
      const parsed = JSON.parse(loginResult) as {
        api_url?: string;
        ws_url?: string;
      };
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private static describeLoginError(error: unknown): string {
    if (error instanceof Error && error.message) {
      try {
        const parsed = JSON.parse(error.message) as unknown;
        if (parsed && typeof parsed === 'object') {
          return `parsed: ${JSON.stringify(parsed)}`;
        }
      } catch {
        return `message: ${error.message}`;
      }
    }
    return '';
  }

  static describeSocketError(error: unknown): string {
    if (error && typeof error === 'object') {
      const e = error as { code?: number; message?: string };
      if (e.message) {
        return e.code != null
          ? `code=${e.code} message=${e.message}`
          : `message=${e.message}`;
      }
    }
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return String(error);
  }
}
