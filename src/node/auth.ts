import {
	createRemoteJWKSet,
	customFetch,
	type JWTPayload,
	jwtVerify,
} from "jose";
import type { RuntimeConfig } from "./config.js";

export function createTokenVerifier(
	config: RuntimeConfig,
	fetchImpl: typeof fetch = fetch,
) {
	const keys = createRemoteJWKSet(config.jwksUrl, {
		timeoutDuration: 5000,
		[customFetch]: (input, init) =>
			fetchImpl(input, { ...init, redirect: "error" }),
	});
	return async (token: string): Promise<JWTPayload> => {
		const { payload } = await jwtVerify(token, keys, {
			issuer: config.issuer,
			audience: config.publicUrl.href,
			algorithms: ["RS256", "ES256"],
			requiredClaims: ["exp", "iat", "sub"],
			maxTokenAge: "1h",
			clockTolerance: 5,
		});
		if (
			!payload.sub ||
			!config.allowedSubjects.has(payload.sub) ||
			typeof payload.scope !== "string" ||
			!payload.scope.split(/\s+/).includes(config.requiredScope)
		) {
			throw new Error("Access denied");
		}
		return payload;
	};
}
