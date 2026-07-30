#!/usr/bin/env node
import { join } from "node:path";
import { parseArgs } from "node:util";
import { HOSTS } from "./hosts/index.js";
import { buildResults, finalizeVideo, writeResults } from "./results.js";
import { Runner } from "./runner.js";

// Output data belongs to whoever runs the driver, so anchor it on the cwd — a
// module-relative path would write profiles and results inside node_modules once
// this is installed as a package. npm runs the repo's own scripts from the repo
// root, so these stay byte-identical to the paths used before packaging.
const RUNNER_DIR = join(process.cwd(), "runner");
const REPO_ROOT = process.cwd();

async function main(argv: string[]): Promise<number> {
	const { values } = parseArgs({
		args: argv,
		options: {
			host: { type: "string" },
			"app-name": { type: "string", default: "MCP Apps Conformance" },
			"profile-dir": { type: "string" },
			out: { type: "string" },
			"no-video": { type: "boolean", default: false },
		},
	});

	const hostName = values.host ?? "chatgpt";
	const make = HOSTS[hostName];
	if (!make) {
		console.error(
			`unknown --host ${hostName}; choose one of: ${Object.keys(HOSTS).join(", ")}`,
		);
		return 2;
	}

	const appName = values["app-name"] as string;
	const profileDir =
		(values["profile-dir"] as string | undefined) ??
		join(RUNNER_DIR, ".profiles", hostName);
	const outDir =
		(values.out as string | undefined) ?? join(RUNNER_DIR, "out", hostName);
	const recordVideoDir = values["no-video"]
		? undefined
		: join(outDir, ".video");

	const host = make();
	const runner = new Runner(host, { appName, profileDir, recordVideoDir });

	const { results, hostInfo } = await runner.run();
	const data = buildResults(hostName, appName, results, hostInfo);
	const path = writeResults(outDir, data);

	const video = recordVideoDir
		? finalizeVideo(
				recordVideoDir,
				join(REPO_ROOT, "docs", "recordings"),
				hostName,
			)
		: null;

	const c = data.counts;
	console.log(
		`\n[conformance] ${hostName}: PASS ${c.PASS} · FAIL ${c.FAIL} · TIMEOUT ${c.TIMEOUT} · SKIP ${c.SKIP}`,
	);
	console.log(`[conformance] results → ${path}`);
	if (video) console.log(`[conformance] recording → ${video}`);
	return 0;
}

main(process.argv.slice(2)).then(
	(code) => process.exit(code),
	(err) => {
		console.error(err);
		process.exit(1);
	},
);
