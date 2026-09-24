import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export const DEV_HOST = "127.0.0.1";

export function validateDevArguments(args) {
  const forbidden = args.find(
    (argument) =>
      argument.startsWith("--hostname") ||
      argument.startsWith("-H"),
  );
  if (forbidden) {
    throw new Error(
      `Development hostname overrides are disabled (${forbidden}).`,
    );
  }
  return args;
}

export function buildDevArguments(args) {
  return [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    DEV_HOST,
    ...validateDevArguments(args),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let args;
  try {
    args = buildDevArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid arguments.");
    process.exitCode = 2;
  }

  if (args) {
    const child = spawn(process.execPath, args, {
      env: process.env,
      stdio: "inherit",
    });
    child.on("exit", (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      else process.exitCode = code ?? 1;
    });
  }
}
