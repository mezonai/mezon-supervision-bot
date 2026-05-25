import { Injectable, Logger } from '@nestjs/common';
import { MezonClient } from 'mezon-sdk';
import { fetchUserForDm } from '../mezon-dm.util';

export type MezonClientBootConfig = ConstructorParameters<typeof MezonClient>[0];

@Injectable()
export class MezonClientService {
  private readonly logger = new Logger(MezonClientService.name);
  private client: MezonClient;

  constructor(config: MezonClientBootConfig) {
    this.client = new MezonClient(config);
  }

  async initializeClient() {
    try {
      const result = await this.client.login();
      const session = MezonClientService.parseLoginSession(result);
      if (session?.ws_url) {
        this.logger.log(`socket ws_url=${session.ws_url}`);
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

  getClient() {
    return this.client;
  }

  fetchUserForDm(userId: string) {
    return fetchUserForDm(this.client, userId);
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
}
