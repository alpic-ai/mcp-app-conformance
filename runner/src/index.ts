/**
 * The package entry point: everything a host implementer needs to run the
 * conformance suite against their own host.
 *
 * ```ts
 * import { BrowserHost, Runner } from "mcp-apps-conformance";
 *
 * class MyHost extends BrowserHost { ... }          // 3 hooks describe your UI
 * const { results } = await new Runner(new MyHost(), opts).run();
 * ```
 *
 * `./hosts/util` stays internal — its timeouts are implementation details.
 */

export * from "../../shared/protocol.js";
export type { Host, SetupOptions, SuiteBridge } from "./host.js";
export { BrowserHost } from "./hosts/browser.js";
export { HOSTS } from "./hosts/index.js";
export {
	buildResults,
	finalizeVideo,
	type ResultsFile,
	writeResults,
} from "./results.js";
export { Runner } from "./runner.js";
