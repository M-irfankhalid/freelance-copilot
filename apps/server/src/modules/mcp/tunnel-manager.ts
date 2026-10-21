import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { APP_ROOT } from "../../env.js";
import { AppError } from "../../lib/errors.js";
import { createLogger } from "../../lib/logger.js";
import { getOwnerUserId } from "../auth/auth.service.js";
import {
  getMcpConfiguration,
  getMcpSettings,
  setMcpEnabled,
} from "./mcp-settings.service.js";
import {
  getInstalledTunnelClient,
  installTunnelClient,
  type InstalledTunnelClient,
} from "./tunnel-client-installer.js";

const log = createLogger("system");
const runFile = promisify(execFile);
const MCP_DIR = join(APP_ROOT, "data", "mcp");
const PROFILE_PATH = join(MCP_DIR, "profile.yaml");

export type TunnelState =
  | "not_configured"
  | "disconnected"
  | "starting"
  | "connected"
  | "error";

export interface TunnelStatus {
  state: TunnelState;
  running: boolean;
  ready: boolean;
  installed: boolean;
  clientVersion: string | null;
  healthUrl: string | null;
  lastError: string | null;
  startedAt: string | null;
}

interface Runtime {
  userId: string;
  child: ChildProcess;
  healthPort: number;
  healthUrl: string;
  startedAt: string;
  lastError: string | null;
  stopping: boolean;
}

interface TransientState {
  userId: string;
  state: "starting" | "error";
  message: string | null;
}

let runtime: Runtime | null = null;
let transient: TransientState | null = null;
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function sanitizeMessage(message: string): string {
  return message
    .replace(/sk-[A-Za-z0-9_*.-]{6,}/g, "sk-…")
    .replace(/tunnel_[a-z0-9]{32}/gi, "tunnel_…")
    .slice(0, 400);
}

function messageFor(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error) return sanitizeMessage(error.message);
  return "The Secure MCP Tunnel client could not be started.";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function quoteArg(value: string): string {
  return `"${value.replace(/\\/g, "/").replace(/"/g, '\\"')}"`;
}

/**
 * Command tunnel-client will run. Prefer the TypeScript entry through tsx in
 * development; use the compiled entry in production. Both paths are absolute
 * and quoted so paths with spaces work.
 */
export function resolveMcpCommand(): string {
  const source = resolve(APP_ROOT, "src", "mcp", "index.ts");
  const tsx = resolve(APP_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  if (existsSync(source) && existsSync(tsx)) {
    return `${quoteArg(process.execPath)} ${quoteArg(tsx)} ${quoteArg(source)}`;
  }

  const built = resolve(APP_ROOT, "dist", "src", "mcp", "index.js");
  if (existsSync(built)) {
    return `${quoteArg(process.execPath)} ${quoteArg(built)}`;
  }

  throw new AppError(
    500,
    "INTERNAL",
    "Could not find the MCP server entry point. Build the server before connecting ChatGPT."
  );
}

function writeProfile(tunnelId: string, healthPort: number): string {
  mkdirSync(MCP_DIR, { recursive: true });
  const command = resolveMcpCommand();
  const yaml = [
    "config_version: 1",
    "control_plane:",
    `  base_url: ${JSON.stringify("https://api.openai.com")}`,
    `  tunnel_id: ${JSON.stringify(tunnelId)}`,
    `  api_key: ${JSON.stringify("env:CONTROL_PLANE_API_KEY")}`,
    "health:",
    `  listen_addr: ${JSON.stringify(`127.0.0.1:${healthPort}`)}`,
    "admin_ui:",
    "  open_browser: false",
    "log:",
    "  level: info",
    "  format: json",
    "mcp:",
    "  commands:",
    "    - channel: main",
    `      command: ${JSON.stringify(command)}`,
    "",
  ].join("\n");
  writeFileSync(PROFILE_PATH, yaml, { encoding: "utf8", mode: 0o600 });
  return PROFILE_PATH;
}

async function findFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Could not allocate a local health port");
    }
    return address.port;
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
}

async function isHealthy(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/readyz`, {
      signal: AbortSignal.timeout(800),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function describeTunnelLog(event: Record<string, unknown>): string | null {
  const level = typeof event.level === "string" ? event.level.toLowerCase() : "";
  if (level !== "warn" && level !== "error") return null;

  const code = typeof event.error_code === "string" ? event.error_code : "";
  if (code === "invalid_api_key" || event.status_code === 401) {
    return "OpenAI rejected the runtime API key. Check the key and reconnect.";
  }
  if (typeof event.error_message === "string") {
    return sanitizeMessage(event.error_message);
  }
  if (typeof event.error === "string") {
    return sanitizeMessage(event.error);
  }
  if (typeof event.msg === "string" && event.error !== undefined) {
    return sanitizeMessage(event.msg);
  }
  return null;
}

function handleLog(runtimeState: Runtime, line: string): void {
  const trimmed = line.trim();
  if (trimmed === "") return;

  if (!trimmed.startsWith("{")) {
    if (trimmed.startsWith("[mcp] Failed")) {
      runtimeState.lastError = sanitizeMessage(trimmed.replace(/^\[mcp\]\s*/, ""));
    }
    return;
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return;
  }

  // A successful metadata fetch proves the runtime key works again.
  if (event.msg === "tunnel metadata fetched") {
    runtimeState.lastError = null;
    return;
  }

  const message = describeTunnelLog(event);
  if (message !== null) {
    runtimeState.lastError = message;
  }
}

function attachChild(runtimeState: Runtime): void {
  let stdoutBuffer = "";
  runtimeState.child.stdout?.on("data", (chunk: Buffer | string) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) handleLog(runtimeState, line);
  });

  let stderrBuffer = "";
  runtimeState.child.stderr?.on("data", (chunk: Buffer | string) => {
    stderrBuffer += chunk.toString();
    const lines = stderrBuffer.split(/\r?\n/);
    stderrBuffer = lines.pop() ?? "";
    for (const line of lines) handleLog(runtimeState, line);
  });

  runtimeState.child.on("error", (error) => {
    runtimeState.lastError = sanitizeMessage(error.message);
  });

  runtimeState.child.on("exit", (code, signal) => {
    if (runtimeState.stopping) return;
    if (runtime?.child !== runtimeState.child) return;
    runtimeState.lastError =
      runtimeState.lastError ??
      `Tunnel client stopped unexpectedly (${signal ?? `exit ${code ?? "unknown"}`}).`;
  });
}

async function waitForHealth(
  runtimeState: Runtime,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (runtimeState.child.exitCode !== null) return false;
    if (await isHealthy(runtimeState.healthPort)) return true;
    await delay(250);
  }
  return false;
}

async function killTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === "win32" && child.pid !== undefined) {
    try {
      await runFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 10_000,
      });
    } catch {
      // It may have exited between the check and taskkill.
    }
  } else if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  } else {
    child.kill("SIGTERM");
  }

  await Promise.race([
    once(child, "exit").then(() => undefined),
    delay(3_000),
  ]);

  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === "win32" && child.pid !== undefined) {
      try {
        await runFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          timeout: 10_000,
        });
      } catch {
        // Nothing else to do.
      }
    } else {
      try {
        child.kill("SIGKILL");
      } catch {
        // Nothing else to do.
      }
    }
  }
}

async function stopRuntime(): Promise<void> {
  const current = runtime;
  if (current === null) return;
  current.stopping = true;
  runtime = null;
  await killTree(current.child);
}

function startProcess(
  userId: string,
  client: InstalledTunnelClient,
  tunnelId: string,
  port: number,
  allowWrites: boolean,
  apiKey: string
): Runtime {
  writeProfile(tunnelId, port);
  const child = spawn(
    client.path,
    ["run", "--profile-file", PROFILE_PATH, "--log.format", "json"],
    {
      cwd: MCP_DIR,
      env: {
        ...process.env,
        // tunnel-client reads the generic LOG_LEVEL variable. Keep it at info
        // so control-plane warnings (rejected key, network errors) reach us
        // even when the app itself is configured for error-only logging.
        LOG_LEVEL: "info",
        CONTROL_PLANE_API_KEY: apiKey,
        MCP_ALLOW_WRITES: allowWrites ? "true" : "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    }
  );

  const runtimeState: Runtime = {
    userId,
    child,
    healthPort: port,
    healthUrl: `http://127.0.0.1:${port}`,
    startedAt: new Date().toISOString(),
    lastError: null,
    stopping: false,
  };
  attachChild(runtimeState);
  runtime = runtimeState;
  return runtimeState;
}

/** Start (or restart) the tunnel for the given user. */
export function startTunnel(userId: string): Promise<void> {
  return serialize(async () => {
    transient = { userId, state: "starting", message: "Preparing tunnel client…" };
    try {
      await stopRuntime();

      const config = getMcpConfiguration(userId);
      if (config === null) {
        throw new AppError(
          400,
          "BAD_REQUEST",
          "Enter the tunnel ID and runtime API key before connecting."
        );
      }

      const client = await installTunnelClient();
      transient = { userId, state: "starting", message: "Starting Secure MCP Tunnel…" };
      const port = await findFreePort();
      const runtimeState = startProcess(
        userId,
        client,
        config.tunnelId,
        port,
        config.allowWrites,
        config.apiKey
      );

      setMcpEnabled(userId, true);
      transient = null;

      const ready = await waitForHealth(runtimeState, 20_000);
      if (!ready) {
        await stopRuntime();
        throw new AppError(
          502,
          "UPSTREAM_ERROR",
          "The Secure MCP Tunnel client did not become ready. Check the server logs and try again."
        );
      }

      // Give the control plane a moment to reject an invalid runtime key so the
      // first status response is honest instead of briefly claiming success.
      await delay(600);
    } catch (error) {
      const message = messageFor(error);
      transient = { userId, state: "error", message };
      setMcpEnabled(userId, false);
      await stopRuntime();
      throw error;
    }
  });
}

/** Stop the tunnel. The saved configuration stays in place. */
export function stopTunnel(): Promise<void> {
  return serialize(async () => {
    await stopRuntime();
    transient = null;
  });
}

/** Stop and mark the tunnel as disconnected so it will not resume on boot. */
export function disconnectTunnel(userId: string): Promise<void> {
  return serialize(async () => {
    await stopRuntime();
    transient = null;
    setMcpEnabled(userId, false);
  });
}

/** Restart after settings change, but only when the tunnel was meant to run. */
export async function refreshTunnel(userId: string): Promise<void> {
  const settings = getMcpSettings(userId);
  if (!settings.enabled) return;
  await startTunnel(userId);
}

/** Drop a previous start error after the user edits the configuration. */
export function clearTunnelFailure(userId: string): void {
  if (transient !== null && transient.userId === userId) {
    transient = null;
  }
}

/** Resume a previously connected tunnel after a server restart. */
export async function resumeTunnel(): Promise<void> {
  const userId = getOwnerUserId();
  if (userId === null) return;
  const settings = getMcpSettings(userId);
  if (!settings.enabled || !settings.configured) return;
  try {
    await startTunnel(userId);
  } catch (error) {
    log.warn("Could not resume the Secure MCP Tunnel", {
      error: messageFor(error),
    });
  }
}

/** Current runtime status, including the installed client version. */
export async function getTunnelStatus(userId: string): Promise<TunnelStatus> {
  const settings = getMcpSettings(userId);
  const installed = getInstalledTunnelClient();
  const base = {
    installed: installed !== null,
    clientVersion: installed?.version ?? null,
  };

  if (runtime !== null && runtime.userId === userId) {
    const running = runtime.child.exitCode === null && !runtime.stopping;
    if (running) {
      const ready = await isHealthy(runtime.healthPort);
      return {
        ...base,
        state: !ready ? "starting" : runtime.lastError === null ? "connected" : "error",
        running: true,
        ready,
        healthUrl: runtime.healthUrl,
        lastError: runtime.lastError,
        startedAt: runtime.startedAt,
      };
    }
    return {
      ...base,
      state: "error",
      running: false,
      ready: false,
      healthUrl: runtime.healthUrl,
      lastError:
        runtime.lastError ?? "Tunnel client stopped unexpectedly. Reconnect to try again.",
      startedAt: runtime.startedAt,
    };
  }

  if (transient !== null && transient.userId === userId) {
    return {
      ...base,
      state: transient.state,
      running: transient.state === "starting",
      ready: false,
      healthUrl: null,
      lastError: transient.state === "error" ? transient.message : null,
      startedAt: null,
    };
  }

  return {
    ...base,
    state: settings.configured ? "disconnected" : "not_configured",
    running: false,
    ready: false,
    healthUrl: null,
    lastError: null,
    startedAt: null,
  };
}
