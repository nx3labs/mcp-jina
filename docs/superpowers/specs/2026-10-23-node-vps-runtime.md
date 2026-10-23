# Node VPS runtime design

Approved direction: Node.js/TypeScript as the primary production runtime. Develop in the existing remote workspace. Do not deploy or merge to main.

The runtime exposes only read_url and search_web over stateless MCP Streamable HTTP. It reuses existing tool registration and formatting through narrow backend interfaces. Reader and SearXNG addresses are mandatory operator configuration; there are no cloud defaults or cloud fallbacks.

Authentication uses signed JWT access tokens from an established OAuth provider, verified using jose against configured issuer, resource audience, expiry, scope and allowed subjects. Publish protected-resource metadata; do not implement an authorization server. Incoming credentials and client network information never reach backends.

Bind loopback by default. Enforce Host and Origin checks, request and backend size limits, cancellation, deadlines and concurrency limits. Reject unsafe literal target addresses and local hostnames. DNS rebinding, redirects and browser subresources require a separately enforced network/egress policy at Reader and SearXNG; application validation alone is insufficient.

Production settings, identities, credentials, service names and deployment files remain outside GitHub, including private repositories. Public examples contain placeholders only. Include no automatic deployment.

The current Worker entry point remains available for development where inexpensive; only Node is supported for this self-hosted production profile. Unsupported cloud tools and question-grounded extraction/OCR are unavailable in this profile. Acceptance: real MCP initialization/list/call tests against controlled backend fixtures, JWT rejection tests, no token forwarding, bounded responses, cancellation and a clean production dependency audit.
