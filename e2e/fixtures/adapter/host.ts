/**
 * The only host that the e2e API may call (`FOREMAN_ALLOWED_HOSTS`). It ends in `.test`, so it never
 * resolves. The synthetic adapter answers for it from fixture data and opens no connection.
 */
export const SYNTHETIC_HOST = "forge.synthetic.test";
