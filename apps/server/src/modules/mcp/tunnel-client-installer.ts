import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import { APP_ROOT } from "../../env.js";
import { AppError } from "../../lib/errors.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("system");
const runFile = promisify(execFile);

const RELEASES_API = "https://api.github.com/repos/openai/tunnel-client/releases/latest";
const MCP_DIR = join(APP_ROOT, "data", "mcp");
const CLIENT_DIR = join(MCP_DIR, "tunnel-client");
const VERSION_FILE = join(CLIENT_DIR, "version.txt");

export interface InstalledTunnelClient {
  path: string;
  version: string;
}

interface ReleaseAsset {
  name: string;
  browserDownloadUrl: string;
}

interface TunnelRelease {
  tag: string;
  asset: ReleaseAsset;
  checksumsUrl: string;
}

interface GitHubRelease {
  tag_name?: unknown;
  assets?: unknown;
}

interface GitHubAsset {
  name?: unknown;
  browser_download_url?: unknown;
}

let cachedRelease: TunnelRelease | null = null;

function platformAssetSuffix(): string {
  const arch =
    process.arch === "x64"
      ? "amd64"
      : process.arch === "arm64"
        ? "arm64"
        : null;
  if (arch === null) {
    throw new AppError(
      500,
      "INTERNAL",
      `Secure MCP Tunnel does not support the server's CPU architecture (${process.arch}).`
    );
  }
  if (
    process.platform !== "win32" &&
    process.platform !== "linux" &&
    process.platform !== "darwin"
  ) {
    throw new AppError(
      500,
      "INTERNAL",
      `Secure MCP Tunnel does not support this operating system (${process.platform}).`
    );
  }
  const platform = process.platform === "win32" ? "windows" : process.platform;
  return `${platform}-${arch}`;
}

/** Resolve the latest official release and the matching platform archive. */
async function getLatestRelease(): Promise<TunnelRelease> {
  if (cachedRelease !== null) return cachedRelease;

  let response: Response;
  try {
    response = await fetch(RELEASES_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "freelance-copilot",
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      "Could not reach GitHub to download the Secure MCP Tunnel client. Check the server's internet connection and try again."
    );
  }
  if (!response.ok) {
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      `GitHub returned status ${response.status} while looking up the Secure MCP Tunnel client.`
    );
  }

  const release = (await response.json()) as GitHubRelease;
  const tag = typeof release.tag_name === "string" ? release.tag_name : "";
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || !Array.isArray(release.assets)) {
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      "GitHub returned an unexpected release for the Secure MCP Tunnel client."
    );
  }

  const suffix = platformAssetSuffix();
  const wanted = `tunnel-client-${tag}-${suffix}.zip`;
  const assets = release.assets
    .filter((asset): asset is GitHubAsset => asset !== null && typeof asset === "object")
    .map((asset) => ({
      name: typeof asset.name === "string" ? asset.name : "",
      browserDownloadUrl:
        typeof asset.browser_download_url === "string"
          ? asset.browser_download_url
          : "",
    }));
  const asset = assets.find((candidate) => candidate.name === wanted);
  const checksums = assets.find((candidate) => candidate.name === "SHA256SUMS.txt");
  if (
    asset === undefined ||
    asset.browserDownloadUrl === "" ||
    checksums === undefined ||
    checksums.browserDownloadUrl === ""
  ) {
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      `The latest Secure MCP Tunnel release does not include ${wanted}.`
    );
  }

  cachedRelease = {
    tag,
    asset: {
      name: asset.name,
      browserDownloadUrl: asset.browserDownloadUrl,
    },
    checksumsUrl: checksums.browserDownloadUrl,
  };
  return cachedRelease;
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { "User-Agent": "freelance-copilot" },
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) {
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      `Downloading the Secure MCP Tunnel client failed with status ${response.status}.`
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

async function expectedChecksum(url: string, assetName: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": "freelance-copilot" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      `Could not download the tunnel client checksums (status ${response.status}).`
    );
  }
  const text = await response.text();
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2 && parts.slice(1).join(" ") === assetName) {
      const hash = parts[0] ?? "";
      if (/^[a-f0-9]{64}$/i.test(hash)) return hash.toLowerCase();
    }
  }
  throw new AppError(
    502,
    "UPSTREAM_ERROR",
    `No SHA-256 checksum was published for ${assetName}.`
  );
}

async function extractZip(zipPath: string, destination: string): Promise<void> {
  mkdirSync(destination, { recursive: true });
  if (process.platform === "win32") {
    await runFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Expand-Archive -LiteralPath $env:TUNNEL_ZIP -DestinationPath $env:TUNNEL_DEST -Force",
      ],
      {
        env: { ...process.env, TUNNEL_ZIP: zipPath, TUNNEL_DEST: destination },
        timeout: 120_000,
        windowsHide: true,
      }
    );
    return;
  }
  await runFile("unzip", ["-q", zipPath, "-d", destination], {
    timeout: 120_000,
  });
}

function binaryName(): string {
  return process.platform === "win32" ? "tunnel-client.exe" : "tunnel-client";
}

/** The installed binary, or null when it has not been downloaded yet. */
export function getInstalledTunnelClient(): InstalledTunnelClient | null {
  const path = join(CLIENT_DIR, binaryName());
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  try {
    const version = readFileSync(VERSION_FILE, "utf8").trim();
    return version === "" ? null : { path, version };
  } catch {
    return null;
  }
}

/**
 * Download and install the official tunnel-client for this platform, verifying
 * the release SHA-256 before extracting. The binary and cloudflared live under
 * apps/server/data so upgrades never touch the source tree.
 */
export async function installTunnelClient(): Promise<InstalledTunnelClient> {
  const installed = getInstalledTunnelClient();
  if (installed !== null) return installed;

  const release = await getLatestRelease();
  const expected = await expectedChecksum(release.checksumsUrl, release.asset.name);
  const archive = await download(release.asset.browserDownloadUrl);
  const actual = createHash("sha256").update(archive).digest("hex");
  if (actual !== expected) {
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      "The downloaded tunnel client failed its SHA-256 checksum. Installation was aborted."
    );
  }

  mkdirSync(MCP_DIR, { recursive: true });
  const id = randomUUID();
  const zipPath = join(MCP_DIR, `tunnel-client-${id}.zip`);
  const extractDir = join(MCP_DIR, `extract-${id}`);
  try {
    writeFileSync(zipPath, archive);
    await extractZip(zipPath, extractDir);

    // The release archive may place files at its root or inside one folder.
    const entries = readdirSync(extractDir);
    const source =
      entries.length === 1 &&
      statSync(join(extractDir, entries[0]!)).isDirectory()
        ? join(extractDir, entries[0]!)
        : extractDir;

    rmSync(CLIENT_DIR, { recursive: true, force: true });
    mkdirSync(CLIENT_DIR, { recursive: true });
    for (const entry of readdirSync(source)) {
      cpSync(join(source, entry), join(CLIENT_DIR, entry), { recursive: true });
    }

    const path = join(CLIENT_DIR, binaryName());
    if (!existsSync(path)) {
      throw new Error(`Release archive did not contain ${basename(path)}`);
    }
    if (process.platform !== "win32") {
      chmodSync(path, 0o755);
    }
    writeFileSync(VERSION_FILE, `${release.tag}\n`);
    log.info("Installed Secure MCP Tunnel client", { version: release.tag });

    return { path, version: release.tag };
  } finally {
    rmSync(zipPath, { force: true });
    rmSync(extractDir, { recursive: true, force: true });
  }
}
