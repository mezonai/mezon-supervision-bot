import { MezonClient } from 'mezon-sdk';

export async function fetchUserForDm(client: MezonClient, userId: string) {
  client.users.delete(userId);
  return client.users.fetch(userId);
}
