import { createApp } from "./app.ts";

const host = process.env.AITUBER_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.AITUBER_PORT ?? "4310", 10);

if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("AITUBER_PORT must be an integer between 1 and 65535");
}

const server = createApp();

server.listen(port, host, () => {
  process.stdout.write(`AITuber server listening on http://${host}:${port}\n`);
});

function shutdown() {
  server.close((error) => {
    if (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
