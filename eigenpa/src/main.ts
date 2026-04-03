import { createServer } from "./server/index.js";
import { startScheduler } from "./scheduler/index.js";
import { DBRouter } from "./db/router.js";

async function main() {
  const { app, config } = await createServer();

  // Start the background task scheduler
  const dbRouter = new DBRouter();
  const stopScheduler = startScheduler(dbRouter);

  await app.listen({ port: config.server.port, host: "0.0.0.0" });
  console.log(`EigenPA listening on http://0.0.0.0:${config.server.port}`);

  // Graceful shutdown
  const shutdown = async () => {
    stopScheduler();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
