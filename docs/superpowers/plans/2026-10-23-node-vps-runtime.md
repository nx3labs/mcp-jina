# Node VPS Runtime Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in this session. The user approved the runtime choice and requested direct execution.

**Goal:** Add an authenticated Node MCP runtime with explicit self-hosted Reader and SearXNG backends.
**Architecture:** Use the SDK Node transport because the compatibility probe established that agents/mcp imports cloudflare-only modules. Reuse existing tools with injected read/search functions and a fixed server allowlist.
**Tech Stack:** TypeScript, Node 22.23+, MCP SDK 1.x, jose, Node test runner.
**Spec:** docs/superpowers/specs/2026-10-23-node-vps-runtime.md

## Global Constraints
- English only; no infrastructure details or secrets in repository artifacts.
- No deployment, production service changes, or main merge.
- Authentication mandatory; no external Jina fallback.
- Network-level egress protection remains a separate deployment requirement.

## Review Focus
- Invalid or differently scoped JWTs must fail before tool execution.
- Caller filters must not enable cloud tools.
- Oversized and redirected backend responses must fail safely.
- Internal target addresses and spoofed Host/Origin headers must be rejected.
- Concurrent requests and cancellation must not share credentials or leak resources.

### Task 1: Runtime compatibility and dependency baseline
- [x] Confirm a clean work branch and run baseline type check.
- [x] Probe agents/mcp under Node: fails on cloudflare module scheme.
- [x] Update vulnerable production dependencies; deduplicate the SDK and move Worker-only agents to dev dependencies.
- [x] Verify clean production audit after final dependency changes.

### Task 2: Explicit backends and OAuth resource-server authentication
Files: src/node/config.ts, src/node/auth.ts, src/node/backends.ts, tests/node-runtime.test.mjs.
Interfaces: loadConfig(environment), createTokenVerifier(config, fetchImpl), createBackends(config, fetchImpl, signal).
- [x] Write tests for required configuration, JWT claims, unsafe targets and backend boundaries; observe failure.
- [x] Implement the minimal validated configuration, jose verifier and bounded backend adapters.
- [x] Run the tests and inspect results.

### Task 3: Node transport and shared tools
Files: src/node/server.ts, src/node/main.ts, src/tools/jina-tools.ts, tsconfig.node.json, package.json, package-lock.json.
Interface: createNodeServer(config, options) returns a Node HTTP server; startup remains separate.
- [x] Write real HTTP/MCP tests for auth, allowlist, credential isolation, initialization, calls, concurrency and request limits; observe failure.
- [x] Implement per-request SDK server/transport, lifecycle cleanup, fixed tool allowlist and backend injection.
- [x] Run the full suite, type checking, lint and formatting. Keep unrelated source changes out of this branch.

### Task 4: Delivery and review
Files: Dockerfile, .dockerignore, .env.example, docs/self-hosting.md.
- [x] Document configuration and the security boundary; build a minimal non-root production image definition without private settings.
- [x] Review complete diff for credentials, private infrastructure data and security regressions.
- [x] Run final tests, both type checks and production audit.
- [x] Commit and push the work branch as required by repository instructions; do not merge or deploy.

## Verification record

- 18 tests passed in development and in a fresh production-only dependency installation.
- TypeScript check, Node Biome check, and production dependency audit passed.
- Independent review found a malformed-target crash and uncancelled backend error bodies; both received failing regression tests and were fixed.
- Container build, live backend/OAuth interoperability, capacity measurements and network enforcement remain operator release checks; no production services were changed.

- Published-file privacy scan passed for all changed files. Delivery command wrapper now aborts on any failed validation; origin uses an SSH alias for the expected fork.
