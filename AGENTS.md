# Instructions for coding agents

This is a public repository. Never commit private infrastructure details,
production domains or addresses, credentials, tokens, certificates, logs or
backups. This applies to commit messages, issues and pull requests as well.
Private GitHub repositories are not an approved destination for those details.

## Workflow

- Use English for all code, documentation, commit messages, pull requests and replies.
- Ask before major architecture changes unless the user has already approved them.
- Keep changes focused, with one topic per `work/<topic>` branch.
- Never work directly on `main`. Merge or push `main` only when explicitly requested.
- At the start, fetch refs and check the working tree. Do not discard another
  agent's changes. Resume a matching work branch or start from current `main`.
- Shared checkouts are used by one coding agent at a time.
- Before finishing, commit and push the work branch and leave the tree clean.
- Keep dependencies minimal and commit `package-lock.json` with dependency changes.
- Inspect every staged diff for secrets and private configuration before committing.

## Runtime and validation

Node.js/TypeScript is the primary runtime for self-hosted production. Keep the
Worker entry point available where inexpensive, but do not confuse its hosted
Jina behavior with the self-hosted security profile.

Install dependencies with `npm ci --ignore-scripts` unless a particular lifecycle
script has been reviewed and is necessary. Run `npm test`, `npm run type-check`,
and the appropriate Biome lint/format checks before committing. Avoid unrelated
upstream-wide formatting changes.

The local development server must remain private. Never run `npm run deploy`
or `wrangler deploy`, configure a Cloudflare login, expose public ports or change
production services as part of development. Production deployment is a separate
operator task.

Real settings belong outside the Git checkout. Public examples contain names or
placeholders only; they must not identify an actual installation. Keep private
files out of Docker build contexts and logs as well as out of Git.
