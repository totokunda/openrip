// Compare what persist saved with the project now (see persist.mjs).
import { run } from "./persist.mjs";
export default (ctx) => run(ctx, "check");
