# Self-hosted Node runtime

The Node entry point is the supported runtime for self-hosted production. The
original Worker remains a development/upstream-compatibility path; it still uses
hosted Jina services. Do not expose or deploy that entry point expecting the
security policy described here.

This implementation exposes only `read_url` and `search_web`. It uses an explicitly
configured Reader and SearXNG, never a Jina cloud fallback. Incoming bearer tokens,
client IP addresses and browser cookies are not forwarded to either backend.

## Build and test

Use a maintained Node 22 release, at least 22.23.0.

```sh
npm ci --ignore-scripts
npm test
npm run type-check
npm start
```

Startup intentionally fails until the required environment variables are configured.
There is no anonymous mode. Package lifecycle scripts remain disabled during
installation. The Node build does not require native image-processing modules.

The tests use generated ephemeral signing keys and controlled backend fixtures.
They do not prove compatibility with a particular live Reader, SearXNG, identity
provider, reverse proxy or egress configuration.

## Private configuration

Keep real configuration outside the checkout and outside GitHub, including private
repositories. The checked-in `.env.example` lists names only. Omit optional variables rather than setting them to empty strings. The process does not
automatically load dotenv files; inject environment variables through your private
service manager or container configuration.

| Variable | Meaning |
| --- | --- |
| `MCP_PUBLIC_URL` | Canonical external HTTPS resource URL, with path `/mcp`; used as JWT audience and OAuth resource |
| `READER_URL` | Exact trusted Reader POST endpoint; use its HTTP/1.1 listener when appropriate |
| `SEARXNG_URL` | Exact trusted SearXNG search endpoint; enable JSON format on the instance |
| `OAUTH_ISSUER_URL` | Exact HTTPS issuer identifier from your established OAuth provider |
| `OAUTH_JWKS_URL` | Trusted HTTPS JWKS endpoint for that issuer |
| `OAUTH_ALLOWED_SUBJECTS` | Comma-separated immutable subject IDs allowed to use this service |
| `HOST` | Default `127.0.0.1`; use `0.0.0.0` only on an isolated container network |
| `PORT` | Default `3000` |
| `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` | Standard HTTP CONNECT proxy routing; lowercase equivalents also supported |

Endpoint configuration rejects embedded credentials, query strings and fragments.
This initial version assumes trusted backends reachable without backend-specific
authentication. Do not repurpose the incoming OAuth token as a backend credential.

## Authentication and reverse proxy

Use an existing authorization server. This application is an OAuth resource server,
not an authorization server: it does not implement login, consent, client
registration or token issuance.

Configure the provider to issue signed RS256 or ES256 JWT access tokens containing:
- issuer matching `OAUTH_ISSUER_URL`;
- audience matching `MCP_PUBLIC_URL` exactly;
- an allowed `sub`;
- `scope` containing `mcp:read`;
- `iat` and `exp`; tokens issued more than one hour ago are rejected.

Protected-resource metadata is available at
`/.well-known/oauth-protected-resource/mcp` and
`/.well-known/oauth-protected-resource`. The MCP endpoint challenges unauthenticated
clients with the metadata URL. Configure a compatible provider registration method
for your client; do not assume dynamic registration is mandatory.

Terminate HTTPS at your reverse proxy and preserve the canonical external Host
header and Authorization header. Route `/mcp` and the metadata paths to this process.
Only the canonical public Origin is accepted when an Origin header is present.
Do not trust caller-supplied forwarding headers for identity.

The server is stateless and returns JSON over Streamable HTTP; standalone GET
streams and persistent MCP sessions are not supported.

## Required network isolation

Proxy environment variables are routing conveniences, not an access-control
boundary. Enforce the policy outside the application:
- Expose only the authenticated ingress through the reverse proxy.
- Keep Reader, SearXNG, the identity services and the outgoing proxy private.
- Allow only explicitly required connections between services; do not give every
  container unrestricted access to the host or the same internal network.
- Force external traffic from Reader and SearXNG through controlled egress.
- Block private/reserved addresses, loopback, link-local and cloud metadata at
  egress, for IPv4 and IPv6, including DNS rebinding, redirects and browser
  subresources. Use an established SSRF-aware proxy/policy implementation.
- Keep DNS resolution constrained. Allow trusted JWKS retrieval without granting
  arbitrary internet access to the MCP process.
- Limit concurrency and resource consumption at the ingress and on each backend.

The application rejects unsafe literal addresses, local hostnames, credentials
in target URLs and nonstandard target ports. It does not resolve and pin target
DNS for Reader. A public-looking hostname can still resolve internally; the
Reader's enforced network policy is essential. MCP-to-backend redirects fail
closed, but redirects performed by Reader require its own protection.

Search forwards the query to the engines enabled by SearXNG. Reader contacts
requested websites and may fetch subresources. A self-hosted MCP does not remove
these intentional external data flows.

## Limits and unsupported features

Each HTTP body is limited to 64 KiB, each backend response to 1 MiB, each backend
request to 30 seconds, and the server accepts eight in-flight authenticated
requests. Each tool call can request at most five URLs/queries. Read responses
use a fixed local response-size guardrail; caller query parameters cannot disable
it or enable other tools.

Question-grounded passages, hosted OCR, model reranking, embeddings, screenshots,
PDF extraction tools and location targeting are unavailable. Ordinary PDFs may
still be read if the configured Reader supports them. Supported search age
filters are day, week, month and year.

## Container operation and release checks

The Dockerfile builds a non-root Node image with production dependencies only.
Its context uses an allowlist and excludes local environment files and keys.
Pin the base image by digest in private deployment configuration. Do not mount the
Docker socket, host directories, personal browser profiles or agent credentials.
Use a read-only filesystem, dropped capabilities, no-new-privileges and explicit
memory/CPU/PID limits in the private service definition. Do not publish the
application container port directly to the internet.

Before release, build the image, test live backend API compatibility and OAuth
linking, measure representative Reader/SearXNG memory usage, and verify that
direct egress, private-network targets and unauthorized access are blocked.
The repository does not deploy or change production services.
