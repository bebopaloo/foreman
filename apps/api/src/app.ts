import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import type { Database } from "@foreman/db";
import Fastify, { type FastifyServerOptions } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Config } from "./config.ts";
import { loggerOptions } from "./log.ts";
import { registerHostCheck } from "./host-check.ts";
import { factoryHealthRoutes } from "./routes/factory-health.ts";
import { healthRoutes } from "./routes/health.ts";
import { workRoutes } from "./routes/work.ts";
import { usageRoutes } from "./routes/usage.ts";
import { loadPriceTable } from "./usage/prices.ts";
import { createFetchSchedule, type FetchSchedule } from "./work/schedule.ts";
import { createRefresher, type Refresher } from "./usage/refresh.ts";

declare module "fastify" {
  interface FastifyContextConfig {
    /** Marks a route that needs no sign-in. Every other route needs an `onRequest` auth hook. */
    public?: boolean;
  }
  interface FastifyInstance {
    /** The refresh schedule and state. `server.ts` starts it. */
    refresher: Refresher;
    /** The fetch schedule and state. `server.ts` starts it. */
    fetcher: FetchSchedule;
  }
}

export interface AppOptions {
  config: Config;
  db: Database;
  logger?: FastifyServerOptions["logger"];
  /** Tests pass a fake. The default reads the folders of the config. */
  refresher?: Refresher;
  /** Tests pass a fake. The default runs the real fetch. */
  fetcher?: FetchSchedule;
}

export async function buildApp({ config, db, logger, refresher, fetcher }: AppOptions) {
  // The API stops here when the price table is invalid. Estimates use it as it was at start-up.
  const priceTable = await loadPriceTable(config.FOREMAN_PRICE_TABLE);
  const app = Fastify({
    logger: logger ?? loggerOptions(config.LOG_LEVEL),
  }).withTypeProvider<ZodTypeProvider>();

  const activeRefresher =
    refresher ??
    createRefresher({
      db,
      claudeDir: config.FOREMAN_CLAUDE_DIR,
      dataDir: config.FOREMAN_DATA_DIR,
      intervalMs: config.FOREMAN_USAGE_REFRESH_MINUTES * 60 * 1000,
      log: {
        info: (message) => {
          app.log.info(message);
        },
        warn: (message) => {
          app.log.warn(message);
        },
      },
    });
  app.decorate("refresher", activeRefresher);
  app.addHook("onClose", async () => {
    await activeRefresher.stop();
  });

  const activeFetcher =
    fetcher ??
    createFetchSchedule({
      db,
      claudeDir: config.FOREMAN_CLAUDE_DIR,
      tokensFile: config.FOREMAN_TOKENS_FILE,
      allowedHosts: config.FOREMAN_ALLOWED_HOSTS,
      timeoutMs: config.FOREMAN_ADAPTER_TIMEOUT_SECONDS * 1000,
      intervalMs: config.FOREMAN_FETCH_MINUTES * 60_000,
      log: {
        info: (message) => {
          app.log.info(message);
        },
        warn: (message) => {
          app.log.warn(message);
        },
      },
    });
  app.decorate("fetcher", activeFetcher);
  app.addHook("onClose", async () => {
    await activeFetcher.stop();
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((error, request, reply) => {
    const status = statusOf(error);
    if (status >= 500) {
      request.log.error({ err: error }, "request failed");
    }
    return reply
      .status(status)
      .send({ error: status >= 500 ? "Internal error" : "Bad request", requestId: request.id });
  });

  // First hook: a foreign Host never reaches CORS, auth or a route.
  registerHostCheck(app);

  await app.register(helmet);
  await app.register(cors, { origin: config.CORS_ORIGINS });

  // Deny by default: an app route without an auth decision fails at start-up.
  // Added after the CORS plugin, whose preflight route needs no sign-in.
  app.addHook("onRoute", (route) => {
    if (route.config?.public !== true && route.onRequest === undefined) {
      throw new Error(`Route ${route.method.toString()} ${route.url} has no auth decision`);
    }
  });

  await app.register(healthRoutes, { prefix: "/api", db });
  await app.register(factoryHealthRoutes, {
    prefix: "/api/factory-health",
    claudeDir: config.FOREMAN_CLAUDE_DIR,
    marketplaceDir: config.FOREMAN_MARKETPLACE_DIR,
  });
  await app.register(workRoutes, {
    prefix: "/api",
    db,
    claudeDir: config.FOREMAN_CLAUDE_DIR,
    schedule: activeFetcher,
    allowedOrigins: config.CORS_ORIGINS,
  });
  await app.register(usageRoutes, {
    prefix: "/api/usage",
    db,
    refresher: activeRefresher,
    priceTable,
    claudeDir: config.FOREMAN_CLAUDE_DIR,
    allowedOrigins: config.CORS_ORIGINS,
  });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;

function statusOf(error: unknown): number {
  if (typeof error !== "object" || error === null) {
    return 500;
  }
  if ("validation" in error && error.validation) {
    return 400;
  }
  if ("statusCode" in error && typeof error.statusCode === "number") {
    return error.statusCode;
  }
  return 500;
}
