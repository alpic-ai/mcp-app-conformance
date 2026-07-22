import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { HOSTS } from "./hosts/index";
import { buildResults, finalizeVideo, writeResults } from "./results";
import { Runner } from "./runner";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER_DIR = join(HERE, "..");
const REPO_ROOT = join(HERE, "..", "..");

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

	const results = await runner.run();
	const data = buildResults(hostName, appName, results);
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
