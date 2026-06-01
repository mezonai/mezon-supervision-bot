export function pickMessageAvatar(
  avatar?: string,
  clanAvatar?: string,
): string | undefined {
  const picked = clanAvatar?.trim() || avatar?.trim();
  return picked || undefined;
}

export function firstNonEmptyAvatar(
  ...candidates: Array<string | undefined>
): string | undefined {
  for (const value of candidates) {
    if (value?.trim()) {
      return value.trim();
    }
  }
  return undefined;
}
