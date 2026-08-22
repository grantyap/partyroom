/**
 * The CSS palette is ordered and append-only. Keep this count aligned with the
 * `--member-*-N` variables in app.css so existing IDs retain their color index.
 */
export const MEMBER_COLOR_COUNT = 12;

function hashUserId(userId: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < userId.length; index += 1) {
    hash ^= userId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function getMemberColorIndex(userId: string) {
  return hashUserId(userId) % MEMBER_COLOR_COUNT;
}

export function getMemberColors(userId: string) {
  const index = getMemberColorIndex(userId);
  return {
    accent: `var(--member-accent-${index})`,
    fill: `var(--member-fill-${index})`,
    foreground: `var(--member-on-fill-${index})`,
  } as const;
}

export function getMemberColor(userId: string) {
  return getMemberColors(userId).accent;
}
