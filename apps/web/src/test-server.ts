import { setupServer } from "msw/node";

/** Fakes the API over HTTP, the system boundary. Each test adds its handlers with `server.use`. */
export const server = setupServer();
