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
import { healthRoutes } from "./routes/health.ts";

declare module "fastify" {
  interface FastifyContextConfig {
    /** Marks a route that needs no sign-in. Every other route needs an `onRequest` auth hook. */
    public?: boolean;
  }
}

export interface AppOptions {
  config: Config;
  db: Database;
  logger?: FastifyServerOptions["logger"];
}

const REDACTED_KEYS = ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token"];

export async function buildApp({ config, db, logger }: AppOptions) {
  const app = Fastify({
    logger: logger ?? { level: config.LOG_LEVEL, redact: REDACTED_KEYS },
  }).withTypeProvider<ZodTypeProvider>();

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
