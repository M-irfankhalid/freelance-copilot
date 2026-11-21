import { createLogger } from "../../lib/logger.js";
import { AppError } from "../../lib/errors.js";
import {
  buildJevGateQuestions,
  callJevApi,
  readJevScore,
} from "../ai/jev.service.js";
import type { BidAmountRequest, DeliveryTimelineRequest } from "../ai/ai.service.js";

/**
 * Lightweight credential verification against the real services. Each tester
 * performs one minimal authenticated call and reports what it learned,
 * including any rate-limit or credit information the service returns.
 * Credentials never appear in logs or results.
 */

const log = createLogger("system");

export interface TestResult {
  ok: boolean;
  /** Human-readable summary safe to show in the UI. */
  message: string;
  /** Optional quota/credit info surfaced by the service. */
  usage?: { label: string; used: number; limit: number };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 10_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function testFreelancerToken(token: string): Promise<TestResult> {
  try {
    const response = await fetchWithTimeout(
      "https://www.freelancer.com/api/users/0.1/self/?compact=true",
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: "Token was rejected by Freelancer.com" };
    }
    if (response.status === 429) {
      return {
        ok: false,
        message: "Freelancer.com rate limit hit — try again shortly",
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        message: `Freelancer.com responded with status ${response.status}`,
      };
    }

    const body = (await response.json()) as {
      status?: string;
      result?: { username?: string };
    };
    if (body.status !== "success" || body.result === undefined) {
      return { ok: false, message: "Token valid but profile request failed" };
    }

    const username = body.result.username ?? "unknown";
    log.info(`Freelancer.com token OK for @${username}`);
    const remaining = response.headers.get("x-ratelimit-remaining");
    const limit = response.headers.get("x-ratelimit-limit");
    const usage =
      remaining !== null && limit !== null && Number.isFinite(Number(limit))
        ? {
            label: "API quota this window",
            used: Math.max(Number(limit) - Number(remaining), 0),
            limit: Number(limit),
          }
        : undefined;
    return {
      ok: true,
      message: `Token valid — signed in as @${username}`,
      usage,
    };
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") {
      return { ok: false, message: "Freelancer.com did not respond in time" };
    }
    return { ok: false, message: "Could not reach Freelancer.com" };
  }
}

interface OpenRouterKeyBody {
  data?: {
    label?: string;
    usage?: number;
    limit?: number | null;
  };
}

export async function testOpenRouterKey(key: string): Promise<TestResult> {
  try {
    const response = await fetchWithTimeout(
      "https://openrouter.ai/api/v1/key",
      { headers: { Authorization: `Bearer ${key}` } }
    );

    if (response.status === 401) {
      return { ok: false, message: "Key was rejected by OpenRouter" };
    }
    if (!response.ok) {
      return {
        ok: false,
        message: `OpenRouter responded with status ${response.status}`,
      };
    }

    const body = (await response.json()) as OpenRouterKeyBody;
    const data = body.data ?? {};
    const label = data.label ?? "OpenRouter key";
    if (typeof data.usage === "number") {
      const limit = data.limit ?? null;
      return {
        ok: true,
        message:
          limit !== null
            ? `${label} — $${data.usage.toFixed(2)} of $${limit.toFixed(2)} used`
            : `${label} — $${data.usage.toFixed(2)} used`,
        usage:
          limit !== null && limit > 0
            ? {
                label: "Credits used",
                used: Math.round(data.usage * 100),
                limit: Math.round(limit * 100),
              }
            : undefined,
      };
    }
    return { ok: true, message: `${label} is valid` };
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") {
      return { ok: false, message: "OpenRouter did not respond in time" };
    }
    return { ok: false, message: "Could not reach OpenRouter" };
  }
}

export interface ModelOption {
  id: string;
  label: string;
  provider: string;
  contextLabel: string;
}

export async function listOpenRouterModels(
  key: string
): Promise<ModelOption[]> {
  const response = await fetchWithTimeout("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) {
    throw new Error(`OpenRouter responded with status ${response.status}`);
  }
  const body = (await response.json()) as {
    data?: Array<{
      id: string;
      name?: string;
      context_length?: number;
      pricing?: { prompt?: string };
    }>;
  };
  const models = body.data ?? [];
  return models
    .filter((m) => m.pricing?.prompt !== undefined)
    .map((m) => ({
      id: m.id,
      label: m.name ?? m.id,
      provider: m.id.split("/")[0] ?? "unknown",
      contextLabel:
        m.context_length !== undefined
          ? `${Math.round(m.context_length / 1000)}K context`
          : "",
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Verify the Jev (Decisions API) engine works for this key and model with one
 * minimal round trip. Kept separate from the OpenRouter key test on purpose:
 * the Decisions endpoint is alpha, so saving a key must never depend on it
 * being reachable.
 *
 * The probe deliberately mirrors the gate's own request shape, including the
 * delivery-timeline question when the user has it on — a simpler probe could
 * report success while every real screening call is rejected (this exact case
 * happened once when a `score` question was sent without its `criteria`).
 */
export async function testJevAccess(
  key: string,
  model: string,
  timeline?: DeliveryTimelineRequest,
  bidAmount?: BidAmountRequest
): Promise<TestResult> {
  try {
    const questions = buildJevGateQuestions(timeline, bidAmount);
    const response = await callJevApi(
      key,
      model,
      { probe: "Connectivity check from Freelance Copilot." },
      questions,
      // Shorter than the gate's budget — this runs while the user waits.
      15_000
    );
    // Reading the answer also proves it lands on the 0-100 scale the gate uses.
    const score = readJevScore(response);
    const extras = [
      timeline ? "delivery-time selection" : null,
      bidAmount ? "bid-amount selection" : null,
    ]
      .filter(Boolean)
      .join(" + ");
    const label = extras ? ` with ${extras}` : "";
    log.info(`Jev engine reachable (model: ${model}, probe score ${score}/100${label})`);
    return { ok: true, message: `Jev is reachable with ${model}${label}` };
  } catch (cause) {
    if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
      return { ok: false, message: "Jev did not respond in time" };
    }
    if (cause instanceof AppError) {
      if (cause.status === 401) {
        return { ok: false, message: "Key was rejected by OpenRouter" };
      }
      if (cause.status === 429) {
        return { ok: false, message: "Jev rate limit hit — try again shortly" };
      }
      // 404/400 here almost always means the model id is wrong or the alpha
      // endpoint no longer accepts it, so echo what the service said.
      return { ok: false, message: `Jev rejected the request: ${cause.message}` };
    }
    return { ok: false, message: "Could not reach Jev" };
  }
}
