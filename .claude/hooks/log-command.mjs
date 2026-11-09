// PostToolUse / PostToolUseFailure hook for Bash: appends each command Claude
// runs to .claude/logs/commands.log (gitignored) with its time and outcome.
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

let input = "";
for await (const chunk of process.stdin) {
	input += chunk;
}

const { hook_event_name, session_id, tool_input } = JSON.parse(input);
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const logDir = path.join(projectDir, ".claude", "logs");

const outcome = hook_event_name === "PostToolUseFailure" ? "FAILED" : "ok";
// Keep one command per line so the log stays easy to grep.
const command = tool_input.command.replace(/\s*\n\s*/g, " ⏎ ");
const line = [
	new Date().toISOString(),
	session_id.slice(0, 8),
	outcome,
	command
].join("\t");

mkdirSync(logDir, { recursive: true });
appendFileSync(path.join(logDir, "commands.log"), `${line}\n`);
