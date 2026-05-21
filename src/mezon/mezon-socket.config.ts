/** MEZON_SOCKET_HOST=host:port (required). */
export function requireSocketHost(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new Error('MEZON_SOCKET_HOST is required (host:port)');
  }
  return trimmed;
}

export function parseSocketUseSsl(raw: string | undefined): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error('MEZON_SOCKET_USE_SSL must be "true" or "false"');
}

/** Optional MEZON_COMMAND_CHANNEL=clanId:channelId[:channelType] (bot restart only). */
export function parseCommandChannel(raw: string | undefined): {
  clanId: string;
  channelId: string;
  channelType: number;
} | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  const [clanId, channelId, typeRaw] = trimmed.split(':');
  if (!clanId || !channelId) return null;

  const channelType = typeRaw ? Number(typeRaw) : 1;
  return {
    clanId,
    channelId,
    channelType: Number.isNaN(channelType) ? 1 : channelType,
  };
}
