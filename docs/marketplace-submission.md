# Marketplace submission checklist

This document prepares the project for the four requested directories. It does
not publish a package, create a Git tag, trigger a release workflow, or grant
credentials to GitHub.

## Canonical public details

| Field | Value |
| --- | --- |
| Repository | `https://github.com/Eason0in/testlink-mcp` |
| Package | `testlink-mcp` |
| MCP Registry name | `io.github.eason0in/testlink-mcp` |
| Distribution | npm (`stdio`) and GHCR image |
| License | MIT |
| Maintainer | GitHub `Eason0in` |

## npm

Before the first release, configure npm's Trusted Publisher for the exact
package and GitHub workflow:

- npm package: `testlink-mcp`
- GitHub owner/repository: `Eason0in/testlink-mcp`
- workflow file: `release.yml`
- protected environment: `release`
- publish permission: `npm publish`

The release workflow already requests `id-token: write` and publishes with
`--provenance`. Do not add a long-lived npm token to repository secrets. Verify
that the npm account is authorized to create or administer this unscoped public
package before making its first release.

## Model Context Protocol Registry

`server.json` is the checked-in source of truth and is validated in CI. The
release workflow authenticates through GitHub OIDC and publishes it only after
the npm package, image, release assets, and validation gates succeed.

Before release, run `mcp-publisher validate server.json` and verify that the
published npm version exactly matches `server.json.version`. The registry name
is deliberately stable and must not be changed after publication.

## Glama

`glama.json` declares `Eason0in` as the repository maintainer. After the public
repository is indexed, use Glama's **Claim ownership** flow while signed in to
that GitHub account, then request a sync after metadata changes. No GitHub token
belongs in this repository.

## MCP.so

Prepare the following submission values; enter them only in the MCP.so web form:

- repository URL: `https://github.com/Eason0in/testlink-mcp`
- name: `TestLink MCP`
- summary: `AI-friendly, safety-first MCP server for TestLink 1.9.20`
- installation: `npx -y testlink-mcp`
- transport: `stdio`
- required connection setting: `TESTLINK_URL`
- secret setting: `TESTLINK_DEV_KEY`

Submit only after npm exposes the matching public version. Do not paste a
developer key, TestLink URL, or other customer data into the directory listing.

## Evidence required before pressing publish

1. The protected `release` environment approves the signed `v<version>` tag.
2. npm package installation smoke test, registry metadata validation, and the
   GitHub release workflow are green.
3. The real TestLink smoke environment has been tested with its credentials kept
   in GitHub environment secrets.
4. The four public listings point to the same repository, version, and
   installation command.
