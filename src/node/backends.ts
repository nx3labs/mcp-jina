import { BlockList, isIP } from "node:net";
import type { ReadUrlConfig, ReadUrlResponse } from "../utils/read.js";
import type { SearchResultOrError, SearchWebArgs } from "../utils/search.js";
import type { RuntimeConfig } from "./config.js";

const blocked = new BlockList();
for (const [address, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const)
	blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
	["::", 96],
	["::1", 128],
	["fc00::", 7],
	["fe80::", 10],
	["ff00::", 8],
	["2001:db8::", 32],
	["2001::", 32],
	["2002::", 16],
] as const)
	blocked.addSubnet(address, prefix, "ipv6");

export function validatePublicTarget(value: string): string {
	if (value.length > 8192) throw new Error("Target URL is too long");
	const url = new URL(value);
	const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	const version = isIP(hostname);
	if (
		!["https:", "http:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		(url.port && !["80", "443"].includes(url.port)) ||
		(version && blocked.check(hostname, version === 4 ? "ipv4" : "ipv6")) ||
		(!version &&
			(!hostname.includes(".") ||
				hostname.endsWith(".") ||
				/(^|\.)(localhost|local|internal|home\.arpa)$/.test(hostname)))
	) {
		throw new Error(
			"Only public HTTP(S) targets on standard ports are supported",
		);
	}
	url.hash = "";
	return url.href;
}
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid backend response");
	return value as Record<string, unknown>;
}
export function createBackends(
	config: RuntimeConfig,
	fetchImpl: typeof fetch = fetch,
	signal?: AbortSignal,
) {
	async function jsonRequest(
		endpoint: URL,
		init: RequestInit,
	): Promise<Record<string, unknown>> {
		const timeout = AbortSignal.timeout(config.backendTimeoutMs);
		const response = await fetchImpl(endpoint.href, {
			...init,
			redirect: "error",
			signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
		});
		if (!response.ok || !response.body) {
			await response.body?.cancel();
			throw new Error("Backend unavailable");
		}
		const declaredLength = Number(response.headers.get("Content-Length"));
		if (declaredLength > config.maxBackendBytes) {
			await response.body.cancel();
			throw new Error("Backend response too large");
		}
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let length = 0;
		try {
			for (;;) {
				const next = await reader.read();
				if (next.done) break;
				length += next.value.byteLength;
				if (length > config.maxBackendBytes) {
					await reader.cancel();
					throw new Error("Backend response too large");
				}
				chunks.push(next.value);
			}
		} finally {
			reader.releaseLock();
		}
		return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
	}
	async function readUrl(options: ReadUrlConfig): Promise<ReadUrlResponse> {
		try {
			const url = validatePublicTarget(options.url);
			if (
				options.question !== undefined ||
				options.ocr ||
				options.page !== undefined ||
				options.chunk_size !== undefined ||
				options.topk !== undefined
			) {
				return {
					error:
						"Question extraction and OCR are not supported by this runtime",
					url,
				};
			}
			const headers: Record<string, string> = {
				Accept: "application/json",
				"Content-Type": "application/json",
				"X-Retain-Images": options.withAllImages ? "all" : "none",
			};
			if (options.withAllLinks) headers["X-With-Links-Summary"] = "all";
			if (options.withAllImages) headers["X-With-Images-Summary"] = "true";
			const response = await jsonRequest(config.readerUrl, {
				method: "POST",
				headers,
				body: JSON.stringify({ url }),
			});
			const data = object(response.data);
			if (typeof data.content !== "string")
				throw new Error("Invalid Reader response");
			const structuredData: Record<string, unknown> = {
				url,
				title: typeof data.title === "string" ? data.title.slice(0, 1024) : "",
				content: data.content,
			};
			if (options.withAllLinks && Array.isArray(data.links))
				structuredData.links = data.links;
			if (options.withAllImages && Array.isArray(data.images))
				structuredData.images = data.images;
			return {
				success: true,
				url,
				structuredData,
				withAllLinks: Boolean(options.withAllLinks),
				withAllImages: Boolean(options.withAllImages),
			};
		} catch {
			return {
				error: "Reader request failed or target is not permitted",
				url: options.url,
			};
		}
	}
	async function searchWeb(args: SearchWebArgs): Promise<SearchResultOrError> {
		try {
			if (!args.query.trim() || args.query.length > 2048)
				throw new Error("Invalid query");
			if (args.location || args.gl)
				return { error: "Location targeting is not supported by this runtime" };
			const body = new URLSearchParams({ q: args.query, format: "json" });
			if (args.hl) {
				if (
					!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(args.hl) ||
					args.hl.length > 35
				)
					throw new Error("Invalid language");
				body.set("language", args.hl);
			}
			if (args.tbs) {
				const periods: Record<string, string> = {
					"qdr:d": "day",
					"qdr:w": "week",
					"qdr:m": "month",
					"qdr:y": "year",
				};
				if (!periods[args.tbs])
					return { error: "Unsupported search time range" };
				body.set("time_range", periods[args.tbs]);
			}
			const data = await jsonRequest(config.searxngUrl, {
				method: "POST",
				headers: {
					Accept: "application/json",
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: body.toString(),
			});
			if (!Array.isArray(data.results))
				throw new Error("Invalid SearXNG response");
			const results = [];
			for (const value of data.results) {
				try {
					const result = object(value);
					if (
						typeof result.url !== "string" ||
						typeof result.title !== "string"
					)
						continue;
					results.push({
						title: result.title.slice(0, 1024),
						url: validatePublicTarget(result.url),
						description:
							typeof result.content === "string"
								? result.content.slice(0, 4096)
								: "",
					});
					if (results.length >= Math.min(args.num ?? 10, 10)) break;
				} catch {
					/* Discard results that are not public URLs. */
				}
			}
			return { query: args.query, results };
		} catch {
			return { error: "Search request failed" };
		}
	}
	return { readUrl, searchWeb };
}
