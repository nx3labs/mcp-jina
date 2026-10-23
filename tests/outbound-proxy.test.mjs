import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { connect } from "node:net";
import { test } from "node:test";
import { getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { createOutboundDispatcher } from "../dist/node/proxy.js";

test("configured outgoing proxy tunnels HTTP requests without target DNS resolution", { timeout: 10000 }, async t => {
    const seen = [];
    const sockets = new Set();
    const backend = createServer((_request, response) => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end('{"proxied":true}');
    });
    backend.listen(0, "127.0.0.1");
    await once(backend, "listening");
    const proxy = createServer();
    proxy.on("connect", (request, client, head) => {
        seen.push(request.url);
        const upstream = connect(backend.address().port, "127.0.0.1");
        for (const socket of [client, upstream]) {
            sockets.add(socket);
            socket.on("close", () => sockets.delete(socket));
            socket.on("error", () => { client.destroy(); upstream.destroy(); });
        }
        upstream.on("connect", () => {
            client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            if (head.length) upstream.write(head);
            client.pipe(upstream);
            upstream.pipe(client);
        });
    });
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    const previous = getGlobalDispatcher();
    const proxyUrl = "http://127.0.0.1:" + proxy.address().port;
    const dispatcher = createOutboundDispatcher({ HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, NO_PROXY: "" });
    setGlobalDispatcher(dispatcher);
    t.after(async () => {
        setGlobalDispatcher(previous);
        await dispatcher.destroy();
        for (const socket of sockets) socket.destroy();
        backend.closeAllConnections();
        await Promise.all([
            new Promise(resolve => proxy.close(resolve)),
            new Promise(resolve => backend.close(resolve)),
        ]);
    });
    const response = await fetch("http://backend.example.test/resource", { signal: AbortSignal.timeout(5000) });
    assert.deepEqual(await response.json(), { proxied: true });
    assert.deepEqual(seen, ["backend.example.test:80"]);
});
