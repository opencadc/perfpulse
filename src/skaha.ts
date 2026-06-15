import type { RunConfig } from "./config";
import type { LifecycleRecorder } from "./metrics";
import { type MetricTags, metricTags } from "./metrics-contract";

export interface SkahaHttpResponseLike {
  body?: unknown;
  status: number;
}

export interface SkahaHttpRequestOptions {
  headers: Record<string, string>;
  tags: { name: string } & MetricTags;
  timeout: string;
}

export interface SkahaHttpClientLike {
  del(url: string, body: string | null, options: SkahaHttpRequestOptions): SkahaHttpResponseLike;
  get(url: string, options: SkahaHttpRequestOptions): SkahaHttpResponseLike;
  post(url: string, body: string, options: SkahaHttpRequestOptions): SkahaHttpResponseLike;
}

export interface SkahaClientConfig {
  apiUrl: string;
  http: SkahaHttpClientLike;
  registryAuthHeader?: string | undefined;
  runConfig: RunConfig;
  token: string;
}

export interface SkahaCreateSessionParams {
  args: string[];
  cmd: string;
  cores?: number;
  env?: Record<string, string>;
  image: string;
  name: string;
  ram?: number;
}

export interface SkahaCreateSessionResult {
  accepted: boolean;
  failure?: string;
  sessionId?: string;
  statusCode: number;
}

export type SkahaSessionStatus =
  | "Pending"
  | "Running"
  | "Terminating"
  | "Succeeded"
  | "Completed"
  | "Error"
  | "Failed";

export interface SkahaSessionLike {
  id?: string;
  status?: string;
}

export interface SkahaGetSessionResult {
  found: boolean;
  session?: SkahaSessionLike;
  status?: SkahaSessionStatus;
  statusCode: number;
}

export interface SkahaCleanupResult {
  cleanupSucceeded: boolean;
  deleted: boolean;
  failure?: string;
  statusCode: number;
}

export interface SkahaSurfaceClient {
  createSession(params: SkahaCreateSessionParams): SkahaCreateSessionResult;
  deleteSession(sessionId: string): SkahaCleanupResult;
  getSession(sessionId: string): SkahaGetSessionResult;
}

export type SkahaClient = SkahaSurfaceClient;

export type SkahaPollUntil = <T>(
  timeoutSeconds: number,
  intervalSeconds: number,
  read: () => T,
  done: (value: T) => boolean,
  jitterMaxMs?: number,
) => T | undefined;

export type SkahaFailureStage = "submission" | "visibility" | "completion";

export interface SkahaSurfaceFailure {
  message: string;
  stage: SkahaFailureStage;
}

export interface SkahaSurfaceConfig {
  completionTimeoutSeconds: number;
  pollIntervalSeconds: number;
  pollJitterMaxMs: number;
  requireCompletion?: boolean;
  session: SkahaCreateSessionParams;
  visibilityGateSeconds: number;
}

export interface SkahaSurfaceResult {
  completed: boolean;
  completionLatencyMs?: number;
  createResponse: SkahaCreateSessionResult;
  failure?: SkahaSurfaceFailure;
  submissionDurationMs: number;
  visible: boolean;
  visibilityLatencyMs?: number;
}

type SkahaLifecycleRecorder = Pick<
  LifecycleRecorder,
  "recordCompleted" | "recordFailure" | "recordSubmitted" | "recordVisible"
>;

export function createSkahaClient(config: SkahaClientConfig): SkahaClient {
  const sessionUrl = `${config.apiUrl.replace(/\/+$/u, "")}/session`;
  const tags = metricTags(config.runConfig);
  const token = config.token.trim();
  const timeout = `${config.runConfig.skaha.requestTimeoutSeconds}s`;
  if (token.length === 0) {
    throw new Error("Skaha bearer token is required");
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "X-Skaha-Authentication-Type": "RUNTIME-TOKEN",
  };
  const registryAuthHeader = config.registryAuthHeader?.trim();
  if (registryAuthHeader !== undefined && registryAuthHeader.length > 0) {
    headers["X-Skaha-Registry-Auth"] = registryAuthHeader;
  }

  return {
    createSession(params) {
      const response = config.http.post(createSessionUrl(sessionUrl, params), "", {
        headers,
        tags: requestTags("skaha_create_session", tags),
        timeout,
      });
      const sessionId = String(response.body ?? "").trim();
      const accepted = response.status >= 200 && response.status < 300 && sessionId.length > 0;
      return {
        accepted,
        ...(accepted ? { sessionId } : {}),
        statusCode: response.status,
      };
    },
    deleteSession(sessionId) {
      const response = config.http.del(`${sessionUrl}/${encodeURIComponent(sessionId)}`, null, {
        headers,
        tags: requestTags("skaha_delete_session", tags),
        timeout,
      });
      const cleanupSucceeded =
        response.status === 200 ||
        response.status === 202 ||
        response.status === 204 ||
        response.status === 404;
      const result: SkahaCleanupResult = {
        cleanupSucceeded,
        deleted: response.status === 200 || response.status === 202 || response.status === 204,
        statusCode: response.status,
      };
      if (!cleanupSucceeded) {
        result.failure = "cleanup_failed";
      }
      return result;
    },
    getSession(sessionId) {
      const response = config.http.get(`${sessionUrl}/${encodeURIComponent(sessionId)}`, {
        headers,
        tags: requestTags("skaha_get_session", tags),
        timeout,
      });
      if (response.status !== 200) {
        return { found: false, statusCode: response.status };
      }
      const session = parseSessionBody(response.body);
      const status = parseSkahaStatus(session?.status);
      const result: SkahaGetSessionResult = {
        found: session !== undefined && status !== undefined,
        statusCode: response.status,
      };
      if (session !== undefined) {
        result.session = session;
      }
      if (status !== undefined) {
        result.status = status;
      }
      return result;
    },
  };
}

function createSessionUrl(sessionUrl: string, params: SkahaCreateSessionParams): string {
  return `${sessionUrl}?${encodeCreateSessionParams(params)}`;
}

function requestTags(name: string, tags: MetricTags): { name: string } & MetricTags {
  return { name, ...tags };
}

export function runSkahaSurface(
  config: SkahaSurfaceConfig,
  client: SkahaSurfaceClient,
  pollUntil: SkahaPollUntil,
  now: () => number = Date.now,
  recorder?: SkahaLifecycleRecorder,
): SkahaSurfaceResult {
  const createStartedAt = now();
  const createResponse = client.createSession(config.session);
  const submittedAt = now();
  const submissionDurationMs = submittedAt - createStartedAt;

  if (!createResponse.accepted || createResponse.sessionId === undefined) {
    recorder?.recordFailure("submission");
    return {
      completed: false,
      createResponse,
      failure: {
        message: `Skaha session create failed with HTTP ${createResponse.statusCode}`,
        stage: "submission",
      },
      submissionDurationMs,
      visible: false,
    };
  }

  recorder?.recordSubmitted(submissionDurationMs);

  const visibleSession = pollUntil(
    config.visibilityGateSeconds,
    config.pollIntervalSeconds,
    () => client.getSession(createResponse.sessionId as string),
    (result) => result.found && result.status !== undefined,
    config.pollJitterMaxMs,
  );
  if (visibleSession === undefined || !visibleSession.found) {
    recorder?.recordFailure("visibility");
    return {
      completed: false,
      createResponse,
      failure: {
        message: `Skaha session was not visible within ${config.visibilityGateSeconds}s`,
        stage: "visibility",
      },
      submissionDurationMs,
      visible: false,
    };
  }

  const visibilityLatencyMs = now() - submittedAt;
  recorder?.recordVisible(visibilityLatencyMs);
  if (config.requireCompletion === false) {
    return {
      completed: false,
      createResponse,
      submissionDurationMs,
      visible: true,
      visibilityLatencyMs,
    };
  }

  const completedSession = pollUntil(
    config.completionTimeoutSeconds,
    config.pollIntervalSeconds,
    () => client.getSession(createResponse.sessionId as string),
    (result) =>
      isSuccessfulCompletionStatus(result.status) || isTerminalFailureStatus(result.status),
    config.pollJitterMaxMs,
  );

  if (!isSuccessfulCompletionStatus(completedSession?.status)) {
    recorder?.recordFailure("completion");
    const failureMessage = isTerminalFailureStatus(completedSession?.status)
      ? `Skaha session ${createResponse.sessionId} reached terminal status ${completedSession?.status}`
      : `Skaha session ${createResponse.sessionId} did not reach Succeeded or Completed within ${config.completionTimeoutSeconds}s`;
    return {
      completed: false,
      createResponse,
      failure: {
        message: failureMessage,
        stage: "completion",
      },
      submissionDurationMs,
      visible: true,
      visibilityLatencyMs,
    };
  }

  const completionLatencyMs = now() - submittedAt;
  recorder?.recordCompleted(completionLatencyMs);

  return {
    completed: true,
    completionLatencyMs,
    createResponse,
    submissionDurationMs,
    visible: true,
    visibilityLatencyMs,
  };
}

function encodeCreateSessionParams(params: SkahaCreateSessionParams): string {
  const form: Array<[string, string]> = [
    ["name", params.name],
    ["image", params.image],
    ["type", "headless"],
    ["cores", String(Math.max(1, params.cores ?? 1))],
    ["ram", String(Math.max(1, params.ram ?? 1))],
    ["cmd", params.cmd],
    ["args", params.args.join(" ")],
  ];
  for (const [key, value] of Object.entries(params.env ?? {})) {
    form.push(["env", `${key}=${value}`]);
  }
  return encodeFormEntries(form);
}

function encodeFormEntries(entries: Array<readonly [string, string]>): string {
  return entries
    .map(([key, value]) => `${encodeFormComponent(key)}=${encodeFormComponent(value)}`)
    .join("&");
}

function encodeFormComponent(value: string): string {
  return encodeURIComponent(value).replace(/%20/gu, "+");
}

function parseSessionBody(body: unknown): SkahaSessionLike | undefined {
  const parsed = typeof body === "string" ? JSON.parse(body) : body;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  return parsed as SkahaSessionLike;
}

function parseSkahaStatus(value: string | undefined): SkahaSessionStatus | undefined {
  switch (value) {
    case "Pending":
    case "Running":
    case "Terminating":
    case "Succeeded":
    case "Completed":
    case "Error":
    case "Failed":
      return value;
    default:
      return undefined;
  }
}

function isTerminalFailureStatus(status: SkahaSessionStatus | undefined): boolean {
  return status === "Error" || status === "Failed";
}

function isSuccessfulCompletionStatus(status: SkahaSessionStatus | undefined): boolean {
  return status === "Completed" || status === "Succeeded";
}
