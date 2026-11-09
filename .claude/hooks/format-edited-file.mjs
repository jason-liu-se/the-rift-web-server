// PostToolUse hook: runs Prettier on the single file Claude just edited, so
// formatting matches the pre-commit hook without reformatting the whole repo.
// Exit code 2 sends Prettier's error (e.g. a syntax error) back to Claude.
import { execFileSync } from "node:child_process";
import path from "node:path";

let input = "";
for await (const chunk of process.stdin) {
	input += chunk;
}

const filePath = JSON.parse(input).tool_input?.file_path;
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const isInProject =
	filePath && !path.relative(projectDir, filePath).startsWith("..");

if (!isInProject) {
	process.exit(0);
}

try {
	// Respects .prettierignore; --ignore-unknown skips unsupported file types.
	execFileSync("npx", ["prettier", "--write", "--ignore-unknown", filePath], {
		cwd: projectDir,
		stdio: ["ignore", "ignore", "pipe"]
	});
} catch (error) {
	process.stderr.write(`Prettier failed on ${filePath}:\n${error.stderr}`);
	process.exit(2);
}
