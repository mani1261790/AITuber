import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect } from "node:net";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveLanHost } from "./lan-host.ts";

export type Surface = "classroom" | "operator";

export function createBuiltSurfaceServer(options: { readonly surface: Surface; readonly distDirectory: string; readonly apiPort: number; readonly classroomOrigin?: string }): Server {
  const root = resolve(options.distDirectory);
  const server = createServer((incoming, response) => {
    const url = new URL(incoming.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/api/")) { proxyHttp(incoming, response, options.surface, options.apiPort); return; }
    if (url.pathname === "/aituber-runtime-config.json") { serveRuntimeConfig(incoming, response, options.classroomOrigin ?? "http://127.0.0.1:4311"); return; }
    void serveStatic(incoming, response, root, url.pathname);
  });
  server.on("upgrade", (incoming, socket, head) => {
    const url = new URL(incoming.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) { socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n"); return; }
    const upstream = connect(options.apiPort, "127.0.0.1", () => {
      const headers = proxyHeaders(incoming.headers, options.surface, options.apiPort);
      upstream.write(`${incoming.method ?? "GET"} ${incoming.url ?? "/"} HTTP/${incoming.httpVersion}\r\n${serializeHeaders(headers)}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", () => socket.destroy()); socket.on("error", () => upstream.destroy());
  });
  return server;
}

function serveRuntimeConfig(request: IncomingMessage, response: ServerResponse, classroomOrigin: string) {
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405, securityHeaders({ allow: "GET, HEAD" })); response.end(); return; }
  const body = JSON.stringify({ classroomOrigin });
  response.writeHead(200, securityHeaders({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": String(Buffer.byteLength(body)) }));
  response.end(request.method === "HEAD" ? undefined : body);
}

async function serveStatic(request: IncomingMessage, response: ServerResponse, root: string, pathname: string) {
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405, securityHeaders({ allow: "GET, HEAD" })); response.end(); return; }
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { response.writeHead(400, securityHeaders()); response.end("Bad request"); return; }
  if (decoded.includes("\0")) { response.writeHead(400, securityHeaders()); response.end("Bad request"); return; }
  const candidate = resolve(root, `.${decoded}`);
  const path = candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : "";
  const file = path && await regularFile(path)
    ? path
    : extname(decoded)
      ? ""
      : resolve(root, "index.html");
  if (!file.startsWith(`${root}${sep}`) || !await regularFile(file)) { response.writeHead(404, securityHeaders()); response.end("Not found"); return; }
  const immutable = file.includes(`${sep}assets${sep}`) && /-[A-Za-z0-9_-]{8,}\./.test(file);
  response.writeHead(200, securityHeaders({
    "content-type": mimeType(file),
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  }));
  if (request.method === "HEAD") { response.end(); return; }
  createReadStream(file).on("error", () => response.destroy()).pipe(response);
}

function proxyHttp(incoming: IncomingMessage, response: ServerResponse, surface: Surface, apiPort: number) {
  const upstream = httpRequest({ hostname: "127.0.0.1", port: apiPort, method: incoming.method, path: incoming.url, headers: proxyHeaders(incoming.headers, surface, apiPort) }, (result) => {
    response.writeHead(result.statusCode ?? 502, result.headers); result.pipe(response);
  });
  upstream.on("error", () => { if (!response.headersSent) response.writeHead(502, securityHeaders()); response.end("API unavailable"); });
  incoming.pipe(upstream);
}

function proxyHeaders(headers: IncomingHttpHeaders, surface: Surface, apiPort: number): IncomingHttpHeaders {
  const next = { ...headers };
  delete next["x-aituber-surface"]; delete next.host;
  next.host = `127.0.0.1:${apiPort}`; next["x-aituber-surface"] = surface;
  return next;
}

function serializeHeaders(headers: IncomingHttpHeaders): string {
  return Object.entries(headers).flatMap(([name, value]) => Array.isArray(value) ? value.map((item) => `${name}: ${item}`) : value === undefined ? [] : [`${name}: ${value}`]).join("\r\n");
}

function securityHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY", "content-security-policy": "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'", ...extra };
}

async function regularFile(path: string): Promise<boolean> { try { return (await stat(path)).isFile(); } catch { return false; } }
function mimeType(path: string): string { return ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf" } as Record<string, string>)[extname(path)] ?? "application/octet-stream"; }
function positivePort(value: string | undefined, fallback: number, name: string): number { const port = Number.parseInt(value ?? String(fallback), 10); if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error(`${name} must be an integer between 1 and 65535`); return port; }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const surface = process.argv[2];
  if (surface !== "classroom" && surface !== "operator") throw new Error("surface must be classroom or operator");
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)), `apps/${surface}/dist`);
  const port = positivePort(process.env[surface === "classroom" ? "AITUBER_CLASSROOM_PORT" : "AITUBER_OPERATOR_PORT"], surface === "classroom" ? 4311 : 4312, `${surface} port`);
  const apiPort = positivePort(process.env.AITUBER_PORT, 4310, "AITUBER_PORT");
  const host = surface === "classroom" ? resolveLanHost() : "127.0.0.1";
  const classroomHost = resolveLanHost();
  const classroomPort = positivePort(process.env.AITUBER_CLASSROOM_PORT, 4311, "classroom port");
  const classroomOrigin = `http://${urlHost(classroomHost)}:${classroomPort}`;
  createBuiltSurfaceServer({ surface, distDirectory: root, apiPort, classroomOrigin }).listen(port, host, () => process.stdout.write(`${surface}: http://${urlHost(host)}:${port}\n`));
}

function urlHost(host: string) { return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host; }
