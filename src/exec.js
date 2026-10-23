import { execFile } from "node:child_process"

// Never rejects: callers branch on exitCode, like Bun's `$` with .nothrow().
// Used instead of `$` because opencode V2 plugins do not get a shell helper.
export function run(file, args, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      const exitCode = error ? (typeof error.code === "number" ? error.code : 1) : 0
      resolve({ exitCode, stdout: String(stdout ?? ""), stderr: String(stderr ?? error?.message ?? "") })
    })
  })
}
