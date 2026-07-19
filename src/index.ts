import { buildApp } from "./app.js";
import { buildDbPool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { PostgresDoubtRepository } from "./doubts/postgres-repository.js";
import { HttpMatchingClient } from "./matching/client.js";
import { logger } from "./logger.js";

const port = Number(process.env.PORT ?? 3002);
const dbPool = buildDbPool();

runMigrations(dbPool)
  .then(() => {
    const app = buildApp(new PostgresDoubtRepository(dbPool), new HttpMatchingClient());
    return app.listen({ port, host: "0.0.0.0" }).then(() => app.log.info({ port }, "doubt-service listening"));
  })
  .catch((err) => {
    logger.error({ err }, "doubt-service failed to start");
    process.exit(1);
  });
