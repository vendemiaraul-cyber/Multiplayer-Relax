// Lets `node --test` import the Workers code by mapping Cloudflare-only modules to tiny mocks.
import { register } from "node:module";
register("./mocks/loader.mjs", import.meta.url);
