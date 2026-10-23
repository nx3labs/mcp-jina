import { setGlobalDispatcher } from "undici";
import { loadConfig } from "./config.js";
import { createOutboundDispatcher } from "./proxy.js";
import { createNodeServer } from "./server.js";

try {
	const config = loadConfig(process.env);
	const dispatcher = createOutboundDispatcher();
	setGlobalDispatcher(dispatcher);
	const server = createNodeServer(config);
	server.once("close", () => {
		void dispatcher.close();
	});
	server.on("error", () => {
		console.error("MCP server failed");
		process.exitCode = 1;
	});
	server.listen(config.port, config.host, () =>
		console.log("MCP server started"),
	);
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, () => {
			server.close(() => {
				process.exitCode = 0;
			});
			const timeout = setTimeout(() => {
				server.closeAllConnections();
				process.exit(1);
			}, 10000);
			timeout.unref();
		});
	}
} catch {
	console.error("MCP startup failed: check required configuration");
	process.exitCode = 1;
}
