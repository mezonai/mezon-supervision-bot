import { MezonClient } from 'mezon-sdk';

export type MezonSocketEnv = {
  hostPort: string;
  useSSL: boolean;
};

type MezonClientInternals = {
  sessionManager: {
    getSession(): { ws_url?: string; token?: string } | undefined;
  };
  socketManager: {
    ws_url: string;
    useSSL: boolean;
    closeSocket(): void;
    createSocket(): void;
    connect(session: unknown): Promise<{ token?: string } | undefined>;
    connectSocket(token: string): Promise<void>;
    getSocket(): {
      joinChat(
        clanId: string,
        channelId: string,
        channelType: number,
        isPublic: boolean,
      ): Promise<void>;
    };
  };
};

function asInternals(client: MezonClient): MezonClientInternals {
  return client as unknown as MezonClientInternals;
}

/** Apply MEZON_SOCKET_* from .env after SDK login (no mezon-js config API). */
export async function reconnectSocketFromEnv(
  client: MezonClient,
  env: MezonSocketEnv,
): Promise<void> {
  const core = asInternals(client);
  const session = core.sessionManager.getSession();
  if (!session) {
    throw new Error('No session after login');
  }

  session.ws_url = env.hostPort;
  core.socketManager.ws_url = env.hostPort;
  core.socketManager.useSSL = env.useSSL;
  core.socketManager.closeSocket();
  core.socketManager.createSocket();

  const connected = await core.socketManager.connect(session);
  const token = connected?.token ?? session.token;
  if (!token) {
    throw new Error('Missing session token after socket reconnect');
  }
  await core.socketManager.connectSocket(token);
}

export async function joinSocketChat(
  client: MezonClient,
  clanId: string,
  channelId: string,
  channelType: number,
  isPublic: boolean,
): Promise<void> {
  await asInternals(client).socketManager
    .getSocket()
    .joinChat(clanId, channelId, channelType, isPublic);
}
