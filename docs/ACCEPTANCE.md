# Local acceptance report

Date: 2026-08-18 (Asia/Taipei)

## Post-acceptance Toolkit integration

Toolkit integration found and fixed a camel-case normalization gap for
`externalId` and `executionType`. The updated source passes 50 tests and 9 evals
on Node 22.23.2, 24.19.0, and 26.7.0, and the local Toolkit demo integration
passes external-ID, suite, plan, and batch-create flows.

The package hashes and container digest recorded below belong to the original
`085da22` acceptance baseline. They must be regenerated before publishing the
post-acceptance normalization fix.

## Result

The local `testlink-mcp` 1.0.0 release candidate is accepted for implementation,
contract, packaging, container, and offline security readiness. No package,
container, repository, or registry entry was published.

Two environment-dependent checks remain intentionally incomplete:

- A live TestLink smoke test was skipped because fresh `TESTLINK_URL` and
  `TESTLINK_DEV_KEY` values were not supplied. Demo-mode end-to-end tests and an
  HTTP XML-RPC TestLink 1.9.20 fixture passed.
- The Homebrew Copilot CLI installation is present, but macOS endpoint security
  terminates and removes its native executable. The existing shell wrapper and
  prior npm installation were retained; this is an external workstation-policy
  blocker, not a `testlink-mcp` failure.

## Release-candidate identity

| Field | Accepted value |
| --- | --- |
| npm package | `testlink-mcp@1.0.0` |
| MCP name | `io.github.easonlin/testlink-mcp` |
| Transport | stdio |
| Compatibility target | TestLink 1.9.20 XML-RPC API |
| License | MIT |
| Node engines | `^22.23.2 || ^24.18.1 || ^26.5.1` |
| Development Node | `24.19.0` |

`package.json.mcpName` and `server.json.name` are identical. The server starts
without credentials, lists all tools, and has an explicit demo mode. Writes are
disabled by default.

## Functional acceptance

- All 15 planned tools are implemented, with input schemas, output schemas,
  `structuredContent`, annotations, cursor pagination, and consistent safe error
  objects.
- Resources and workflow prompts are available without credentials.
- Test case sync, plan membership, and execution-result writes use preview/apply.
- Apply requires `confirm: true`, an unexpired preview (10-minute lifetime), and
  a matching current-state hash. Operations are recorded in a JSONL ledger.
- Side-effecting calls are not retried, and no delete tool is exposed.
- XML-RPC handling covers scalars, arrays, structs, nil values, faults, malformed
  responses, HTML responses, timeouts, and response-size limits.
- Normalization removes markup and attachment bodies from model-facing output.

## Automated verification

| Check | Result |
| --- | --- |
| Node 22.23.2 | typecheck, 49 tests, 9 evals, build: pass |
| Node 24.19.0 | typecheck, 49 tests, 9 evals, build: pass |
| Node 26.7.0 | typecheck, 49 tests, 9 evals, build: pass |
| Test files | 10/10 pass on every Node version |
| MCP contract | no-credential, demo, tools, resources, prompts, schemas: pass |
| Demo E2E | sync, execution, conflict, expiry: pass |
| TestLink 1.9.20 fixture | XML-RPC HTTP mapping and workflows: pass |
| AI tool-selection eval | 9/9 pass |
| Production dependency audit | 0 vulnerabilities at all severities |
| Official MCP publisher validation | `server.json` valid |

The TypeScript strict check is the local static-analysis gate. A CodeQL workflow
is prepared for future public CI but was not uploaded or run on GitHub.

## Package verification

`npm pack --dry-run` and an actual pack both succeeded:

| Property | Value |
| --- | --- |
| Filename | `testlink-mcp-1.0.0.tgz` |
| Entries | 64 |
| Packed size | 32,977 bytes |
| Unpacked size | 135,230 bytes |
| SHA-1 | `5f8c97e5b45f533b37539489f16d847788fee513` |
| SHA-512 integrity | `sha512-Ep9cM70wpml42soBkedRWrp6hQBZcwdBM39hNkWtqEO34Syu3NcPvFEkMGeBgn0JafleX84mkgvTBNxdEOgQzQ==` |

A fresh local install from this tarball completed successfully. Its stdio smoke
test reported 15 tools, structured output enabled, and demo data as the source.

## Container and supply-chain verification

- The Docker base is Node `24.19.0-bookworm-slim`, pinned by multi-platform
  digest.
- Local `linux/arm64` and `linux/amd64` images both passed the MCP stdio smoke
  test.
- Both architectures run as `uid=1000(node)`, not root.
- Trivy reported 0 High and 0 Critical findings for both final images.
- The accepted local OCI manifest-list digest is
  `sha256:f42e5b98c0e3e6540b306a0db52c28f608282fd6616a8e60c8435501e1a2c107`.
- CycloneDX SBOMs were generated for the package and final image. Generated scan
  reports stay ignored because they contain machine-specific metadata.
- Future release automation includes npm provenance, image SBOM generation, and
  build attestation, and is gated behind an explicit manual release input.

## Data and secret hygiene

- `.env.example` contains only `testlink.example.com`, a fake development key,
  and other placeholders.
- No legacy TestLink environment file, credential, source history, or private
  dependency was copied into this repository.
- Gitleaks found no leaks in the worktree or unpacked npm tarball.
- A dedicated string scan found no private organization names, private package
  scopes, internal URLs, or private-key headers.
- The npm tarball contains only the license, README, compiled runtime files,
  `package.json`, and `server.json`.

## Local Node and CLI preparation

- nvm default is Node 24.19.0 with npm 11.17.0. Node 22 installations were
  retained for rollback, and Node 22.23.2 plus Node 26.7.0 were added for the
  supported-version matrix.
- Homebrew now manages pnpm, Pi Coding Agent, OpenSpec, OpenCode, Repomix,
  Mermaid CLI, JSDoc, Yarn, Docker tooling, Colima, Gitleaks, Trivy, Syft, and the
  MCP publisher CLI. Codex remains managed by its existing Homebrew cask.
- Local EWS MCP configurations were pinned to `ews-meeting-mcp@0.1.23` and its
  CLI startup was verified.
- The project-pinned Figma Code Connect entry and the fixed local Figma UI agent
  entry were verified before their replaced global copies were removed.
- Private localization tooling and unrelated Node 22 global packages were
  retained. No installed Node runtime was deleted.
- Homebrew's `ca-certificates` post-install hook reported a workstation
  permission warning; installed CLI version and functional checks otherwise
  completed.

## Publication boundary

The local Git repository has no remote. This acceptance did not create or push a
GitHub repository, publish to npm, push a GHCR image, submit to the MCP Registry,
Glama, or MCP.so, or remove the existing legacy TestLink package. Those actions
require a separate explicit approval after live TestLink verification.
