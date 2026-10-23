export interface RuntimeConfig {
	publicUrl: URL;
	readerUrl: URL;
	searxngUrl: URL;
	issuer: string;
	jwksUrl: URL;
	allowedSubjects: Set<string>;
	requiredScope: string;
	host: string;
	port: number;
	maxConcurrentRequests: number;
	maxRequestBytes: number;
	maxBackendBytes: number;
	backendTimeoutMs: number;
}
function required(environment: NodeJS.ProcessEnv, name: string): string {
	const value = environment[name]?.trim();
	if (!value) throw new Error(`Missing required configuration: ${name}`);
	return value;
}
function endpoint(value: string, name: string, httpsOnly = false): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`Invalid configuration: ${name}`);
	}
	if (
		!(httpsOnly
			? url.protocol === "https:"
			: ["http:", "https:"].includes(url.protocol)) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new Error(`Invalid configuration: ${name}`);
	}
	return url;
}
export function loadConfig(environment: NodeJS.ProcessEnv): RuntimeConfig {
	const publicUrl = endpoint(
		required(environment, "MCP_PUBLIC_URL"),
		"MCP_PUBLIC_URL",
		true,
	);
	if (publicUrl.pathname !== "/mcp")
		throw new Error("MCP_PUBLIC_URL must use the /mcp path");
	const issuerValue = required(environment, "OAUTH_ISSUER_URL");
	endpoint(issuerValue, "OAUTH_ISSUER_URL", true);
	const allowedSubjects = new Set(
		required(environment, "OAUTH_ALLOWED_SUBJECTS")
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean),
	);
	if (!allowedSubjects.size) throw new Error("Invalid OAUTH_ALLOWED_SUBJECTS");
	const portValue = environment.PORT ?? "3000";
	const port = Number(portValue);
	if (
		!/^\d+$/.test(portValue) ||
		!Number.isInteger(port) ||
		port < 1 ||
		port > 65535
	) {
		throw new Error("Invalid PORT");
	}
	const host = environment.HOST ?? "127.0.0.1";
	if (!["127.0.0.1", "::1", "0.0.0.0"].includes(host))
		throw new Error("Invalid HOST");
	return {
		publicUrl,
		issuer: issuerValue,
		readerUrl: endpoint(required(environment, "READER_URL"), "READER_URL"),
		searxngUrl: endpoint(required(environment, "SEARXNG_URL"), "SEARXNG_URL"),
		jwksUrl: endpoint(
			required(environment, "OAUTH_JWKS_URL"),
			"OAUTH_JWKS_URL",
			true,
		),
		allowedSubjects,
		requiredScope: "mcp:read",
		host,
		port,
		maxConcurrentRequests: 8,
		maxRequestBytes: 65536,
		maxBackendBytes: 1048576,
		backendTimeoutMs: 30000,
	};
}
