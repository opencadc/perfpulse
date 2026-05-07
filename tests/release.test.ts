import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

type ReleasePleaseConfig = {
  packages: Record<
    string,
    {
      "include-v-in-tag": boolean;
      "package-name": string;
      "release-type": string;
      "extra-files"?: Array<{ jsonpath?: string; path: string; type: string }>;
    }
  >;
};

const releasePleaseConfig = JSON.parse(
  readFileSync("release-please-config.json", "utf8"),
) as ReleasePleaseConfig;
const releasePleaseManifest = JSON.parse(
  readFileSync(".release-please-manifest.json", "utf8"),
) as Record<string, string>;
const releaseImageWorkflow = readFileSync(".github/workflows/cd.release.image.yml", "utf8");
const cronValues = readFileSync("charts/cron/values.yaml", "utf8");
const campaignValues = readFileSync("charts/campaign/values.yaml", "utf8");

describe("release automation contract", () => {
  test("updates npm package metadata and Helm chart release surfaces", () => {
    const packageConfig = releasePleaseConfig.packages["."];
    if (packageConfig === undefined) {
      throw new Error("Missing Release Please package config for repository root");
    }

    expect(packageConfig["package-name"]).toBe("perfpulse");
    expect(packageConfig["release-type"]).toBe("node");
    expect(packageConfig["include-v-in-tag"]).toBe(true);
    expect(packageConfig["extra-files"]).toEqual(
      expect.arrayContaining([
        { type: "yaml", path: "charts/cron/Chart.yaml", jsonpath: "$.version" },
        { type: "yaml", path: "charts/cron/Chart.yaml", jsonpath: "$.appVersion" },
        { type: "generic", path: "charts/cron/values.yaml" },
        { type: "yaml", path: "charts/campaign/Chart.yaml", jsonpath: "$.version" },
        { type: "yaml", path: "charts/campaign/Chart.yaml", jsonpath: "$.appVersion" },
        { type: "generic", path: "charts/campaign/values.yaml" },
      ]),
    );
    expect(JSON.stringify(packageConfig["extra-files"])).not.toContain("yamlpath");
    expect(cronValues).toContain(`tag: v${releasePleaseManifest["."]} # x-release-please-version`);
    expect(campaignValues).toContain(
      `tag: v${releasePleaseManifest["."]} # x-release-please-version`,
    );
  });

  test("publishes signed multi-arch release images with supply-chain metadata", () => {
    expect(releaseImageWorkflow).toContain("run: bun ci");
    expect(releaseImageWorkflow).toContain("run: bun run lint");
    expect(releaseImageWorkflow).toContain("run: bun run typecheck");
    expect(releaseImageWorkflow).toContain("run: bun test");
    expect(releaseImageWorkflow).toContain("run: bun run build");
    expect(releaseImageWorkflow).toContain("platforms: linux/amd64,linux/arm64");
    expect(releaseImageWorkflow).toContain("provenance: mode=max");
    expect(releaseImageWorkflow).toContain("sbom: true");
    expect(releaseImageWorkflow).toContain("actions/attest-build-provenance");
    expect(releaseImageWorkflow).toContain("sigstore/cosign-installer");
    expect(releaseImageWorkflow).toContain("cosign sign --yes");
    expect(releaseImageWorkflow).toContain("IMAGE_TAG:");
  });
});
