/** Named groups every custom log regex must define (contract: `ts` and `level`). */
export const REQUIRED_GROUPS = ['ts', 'level'] as const;

/**
 * Groups missing from a custom regex. This is a text check only: the backend compiles the regex as Java,
 * whose syntax differs from JS, so the server has the final word on whether it compiles.
 */
export function missingGroups(regex: string): string[] {
  return REQUIRED_GROUPS.filter((g) => !regex.includes(`(?<${g}>`));
}

/** Light check for a logback-style rotated file pattern: `%d` / `%d{…}` exactly once. The backend checks the rest. */
export function rotatedPatternError(pattern: string): string | null {
  const count = pattern.match(/%d/g)?.length ?? 0;
  return count === 1 ? null : `%d must appear exactly once (found ${count})`;
}
