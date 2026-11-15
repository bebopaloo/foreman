/** The plugin files and the forge files of the Factory health fixture sets. All data is synthetic. */

const FOLDER = "/synthetic/claude/plugins";

const stampLine = (plugin: string, version: string, name: string): string =>
  `<!-- ${plugin} ${version}: from Rule template ${name}. The team owns this file. -->\n`;

const CODING = "# Coding\n\n- Validate input at every boundary.\n";
const SECURITY_NEW = "# Security\n\n- Never log secrets.\n- Deny by default.\n";
const SECURITY_OLD = "# Security\n\n- Never log secrets.\n";
const TESTING_NEW = "# Testing\n\n- Test behaviour.\n";
const TESTING_OLD = "# Testing\n\n- Test first.\n";
const TESTING_TEAM = "# Testing\n\n- Our own testing rule.\n";
const TYPESCRIPT = "# TypeScript\n\n- Use strict mode.\n";

/** An unusual text that a Marketplace version must not show as markup. */
export const HOSTILE_VERSION = '<img src="https://evil.test/v.png"> **1.0.0**';

export interface HealthPluginOptions {
  /** The version of `factory-core` in the Marketplace copy. */
  factoryCoreInMarketplace?: string;
}

const installEntry = (plugin: string, version: string) => [
  {
    scope: "user",
    installPath: `${FOLDER}/cache/demo-market/${plugin}/${version}`,
    version,
    lastUpdated: "2026-11-01T09:00:00.000Z",
  },
];

/**
 * `factory-core` 0.30.0 and `stack-ts` 0.10.0 installed from the Marketplace `demo-market`, whose copy
 * gives 0.37.5 and 0.10.0, with the Rule templates of the installed versions and the older templates
 * of `factory-core` 0.8.1 in the plugin cache.
 */
export function healthPluginFiles({
  factoryCoreInMarketplace = "0.37.5",
}: HealthPluginOptions = {}): Record<string, string> {
  const cache = "plugins/cache/demo-market";
  return {
    "plugins/installed_plugins.json": JSON.stringify({
      version: 2,
      plugins: {
        "factory-core@demo-market": installEntry("factory-core", "0.30.0"),
        "stack-ts@demo-market": installEntry("stack-ts", "0.10.0"),
      },
    }),
    "plugins/known_marketplaces.json": JSON.stringify({
      "demo-market": {
        source: { source: "github", repo: "synthetic/demo-market" },
        installLocation: `${FOLDER}/marketplaces/demo-market`,
        lastUpdated: "2026-11-14T08:30:00.000Z",
      },
    }),
    "plugins/marketplaces/demo-market/.claude-plugin/marketplace.json": JSON.stringify({
      name: "demo-market",
      plugins: [
        { name: "factory-core", version: factoryCoreInMarketplace, source: "./factory-core" },
        { name: "stack-ts", version: "0.10.0", source: "./stack-ts" },
      ],
    }),
    [`${cache}/factory-core/0.30.0/templates/rules/coding.md`]: CODING,
    [`${cache}/factory-core/0.30.0/templates/rules/security.md`]: SECURITY_NEW,
    [`${cache}/factory-core/0.30.0/templates/rules/testing.md`]: TESTING_NEW,
    [`${cache}/factory-core/0.8.1/templates/rules/security.md`]: SECURITY_OLD,
    [`${cache}/factory-core/0.8.1/templates/rules/testing.md`]: TESTING_OLD,
    [`${cache}/stack-ts/0.10.0/templates/rules/typescript.md`]: TYPESCRIPT,
  };
}

/** `factory-core` and a hostile Marketplace version: Foreman shows "version not readable". */
export function hostileVersionFiles(): Record<string, string> {
  const files = healthPluginFiles();
  files["plugins/marketplaces/demo-market/.claude-plugin/marketplace.json"] = JSON.stringify({
    name: "demo-market",
    plugins: [
      { name: "factory-core", version: HOSTILE_VERSION },
      { name: "stack-ts", version: "0.10.0" },
    ],
  });
  return files;
}

/**
 * The files of a repo at its default branch: a factory config that lists four Repo rules, and rule
 * files of which one is current, one behind its template, one edited by the team and one of the Stack pack.
 */
export function healthRepoFiles(): Record<string, string> {
  return {
    ".claude/factory.json": JSON.stringify({
      rules: ["coding", "security", "testing", "typescript"],
      compliance: [],
      stack_pack: { name: "stack-ts", version: "0.10.0" },
      factory_core_version: "0.30.0",
    }),
    ".claude/rules/coding.md": stampLine("factory-core", "0.30.0", "coding") + CODING,
    ".claude/rules/security.md": stampLine("factory-core", "0.8.1", "security") + SECURITY_OLD,
    ".claude/rules/testing.md": stampLine("factory-core", "0.8.1", "testing") + TESTING_TEAM,
    ".claude/rules/typescript.md": stampLine("stack-ts", "0.10.0", "typescript") + TYPESCRIPT,
  };
}
