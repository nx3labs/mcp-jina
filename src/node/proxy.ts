import { EnvHttpProxyAgent } from "undici";

export function createOutboundDispatcher(
	environment: NodeJS.ProcessEnv = process.env,
) {
	return new EnvHttpProxyAgent({
		httpProxy: environment.HTTP_PROXY ?? environment.http_proxy,
		httpsProxy: environment.HTTPS_PROXY ?? environment.https_proxy,
		noProxy: environment.NO_PROXY ?? environment.no_proxy,
	});
}
