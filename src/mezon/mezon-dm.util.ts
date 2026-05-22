import { MezonClient } from 'mezon-sdk';

/**
 * SDK _onAddClanUserInternal caches User with dmChannelId="" before bot handlers run.
 * CacheManager.fetch() returns that stub and skips _fetchUserFromAPI (create DM via API).
 */
export async function fetchUserForDm(client: MezonClient, userId: string) {
  client.users.delete(userId);
  return client.users.fetch(userId);
}
