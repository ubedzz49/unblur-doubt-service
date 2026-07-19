import { Redis } from "ioredis";
import { buildApp } from "./app.js";
import { buildDbPool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { PostgresDoubtRepository } from "./doubts/postgres-repository.js";
import { HttpMatchingClient } from "./matching/client.js";
import { HttpInferenceClient } from "./matching/infer-client.js";
import { HttpTaxonomyClient } from "./taxonomy/custom-client.js";
import { RedisFeedCache } from "./cache/feed-cache.js";
import { logger } from "./logger.js";

const port = Number(process.env.PORT ?? 3002);
const dbPool = buildDbPool();

function buildRedisClient(): Redis {
  return new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_AUTH_TOKEN,
    tls: process.env.REDIS_TLS === "true" ? {} : undefined,
  });
}

runMigrations(dbPool)
  .then(() => {
    const app = buildApp(
      new PostgresDoubtRepository(dbPool),
      new HttpMatchingClient(),
      new RedisFeedCache(buildRedisClient()),
      new HttpInferenceClient(),
      new HttpTaxonomyClient(),
    );
    return app.listen({ port, host: "0.0.0.0" }).then(() => app.log.info({ port }, "doubt-service listening"));
  })
  .catch((err) => {
    logger.error({ err }, "doubt-service failed to start");
    process.exit(1);
  });
