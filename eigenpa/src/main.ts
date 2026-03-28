import { createServer } from "./server/index.js";

async function main() {
  const { app, config } = await createServer();

  await app.listen({ port: config.server.port, host: "0.0.0.0" });
  console.log(`EigenPA listening on http://0.0.0.0:${config.server.port}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
