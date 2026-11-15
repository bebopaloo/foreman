// The official SemVer 2.0.0 pattern, from semver.org.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

export interface SemVer {
  core: [bigint, bigint, bigint];
  prerelease: string[];
}

export function parseSemVer(version: string): SemVer | undefined {
  const match = SEMVER.exec(version);
  if (match === null) return undefined;
  const [, major, minor, patch, prerelease] = match;
  if (major === undefined || minor === undefined || patch === undefined) return undefined;
  return {
    core: [BigInt(major), BigInt(minor), BigInt(patch)],
    prerelease: prerelease === undefined ? [] : prerelease.split("."),
  };
}

function compareBig(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePrerelease(a: string[], b: string[]): number {
  // A version with no prerelease has the higher precedence.
  if (a.length === 0 || b.length === 0) return a.length === b.length ? 0 : a.length === 0 ? 1 : -1;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      const result = compareBig(BigInt(left), BigInt(right));
      if (result !== 0) return result;
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

/** SemVer 2.0.0 precedence: below 0, 0 or above 0. Build metadata does not count. */
export function compareSemVer(a: SemVer, b: SemVer): number {
  for (let index = 0; index < 3; index += 1) {
    const result = compareBig(a.core[index] ?? 0n, b.core[index] ?? 0n);
    if (result !== 0) return result;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}
