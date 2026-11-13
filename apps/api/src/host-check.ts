import type { FastifyInstance } from "fastify";

// A loopback name, with an optional port. Anything else is a DNS rebinding risk.
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/i;

export function isLoopbackHost(host: string | undefined): boolean {
  return host !== undefined && LOOPBACK_HOST.test(host);
}

/** Rejects a request whose `Host` header is not a loopback name, with status 421. */
export function registerHostCheck(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    if (!isLoopbackHost(request.headers.host)) {
      return reply.status(421).send({ error: "Misdirected request", requestId: request.id });
    }
  });
}
