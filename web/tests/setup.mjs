// node:test bootstrap (npm run test, loaded after tsx): `server-only` is a
// Next.js build-time alias with no package on disk; outside Next it resolves
// to an empty stub.
import Module, { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const stub = fileURLToPath(new URL("./stubs/server-only.cjs", import.meta.url));

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: new URL("./stubs/server-only.cjs", import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return stub;
  return resolveFilename.call(this, request, ...rest);
};
