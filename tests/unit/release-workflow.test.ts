import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("release workflow", () => {
  it("imports the pinned GitHub signing key before verifying a release tag", async () => {
    const workflow = await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");
    const importStep = workflow.match(
      /      - name: Import pinned release signing key\n([\s\S]*?)(?=\n      - name: Verify release version and signed tag)/,
    )?.[0];

    expect(importStep).toContain("EXPECTED_GPG_FINGERPRINT: 0EB5965CB6DF87E3F7FFEA2758C03387F54FDA7A");
    expect(importStep).toContain("https://api.github.com/users/Eason0in/gpg_keys");
    expect(importStep).toContain('select(.key_id == "58C03387F54FDA7A")');
    expect(importStep).toContain("gpg --batch --import");
    expect(importStep).toContain('test "$actual_fingerprint" = "$EXPECTED_GPG_FINGERPRINT"');
    expect(workflow.indexOf(importStep ?? "")).toBeLessThan(workflow.indexOf('git verify-tag "$RELEASE_TAG"'));
  });

  it("installs the packed artifact through an absolute path for the smoke test", async () => {
    const workflow = await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");
    const smokeStep = workflow.match(
      /      - name: Smoke installed npm package\n([\s\S]*?)(?=\n      - name: Install and validate MCP publisher)/,
    )?.[0];

    expect(smokeStep).toContain(
      'npm install --ignore-scripts --prefix "$package_dir" "$GITHUB_WORKSPACE/dist/testlink-mcp-${RELEASE_TAG#v}.tgz"',
    );
    expect(smokeStep).toContain('node tests/smoke-installed.mjs node "$package_dir/node_modules/testlink-mcp/dist/cli.js"');
    expect(workflow.indexOf('- run: npm pack --pack-destination dist')).toBeLessThan(workflow.indexOf(smokeStep ?? ""));
  });

  it("publishes the packed artifact through trusted publishing", async () => {
    const workflow = await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");
    const publishStep = workflow.match(
      /      - name: Publish npm package through trusted publishing\n([\s\S]*?)(?=\n      - uses: docker\/login-action@v3)/,
    )?.[0];

    expect(publishStep).toContain(
      'npm publish "$GITHUB_WORKSPACE/dist/testlink-mcp-${RELEASE_TAG#v}.tgz" --provenance --access public',
    );
    expect(publishStep).toContain("unset NODE_AUTH_TOKEN");
    expect(workflow).not.toContain("registry-url: https://registry.npmjs.org");
    expect(workflow.indexOf('- run: npm pack --pack-destination dist')).toBeLessThan(workflow.indexOf(publishStep ?? ""));
    expect(workflow.indexOf('Container release preflight')).toBeLessThan(workflow.indexOf(publishStep ?? ""));
  });
});
