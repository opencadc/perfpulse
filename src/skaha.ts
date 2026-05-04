export interface SkahaHttpResponseLike {
  body?: unknown;
  status: number;
}

export interface SkahaHttpRequestOptions {
  headers: Record<string, string>;
  tags: { name: string };
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
) => T | undefined;

export type SkahaFailureStage = "submission" | "visibility" | "completion";

export interface SkahaSurfaceFailure {
  message: string;
  stage: SkahaFailureStage;
}

export interface SkahaSurfaceConfig {
  completionGateSeconds: number;
  pollIntervalSeconds: number;
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

export function createSkahaClient(config: SkahaClientConfig): SkahaClient {
  const sessionUrl = `${config.apiUrl.replace(/\/+$/u, "")}/session`;
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${config.token}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "X-Skaha-Authentication-Type": "RUNTIME-TOKEN",
  };

  return {
    createSession(params) {
      const response = config.http.post(sessionUrl, encodeCreateSessionForm(params), {
        headers,
        tags: { name: "skaha_create_session" },
        timeout: "30s",
      });
      const sessionId = String(response.body ?? "").trim();
      return {
        accepted: response.status >= 200 && response.status < 300 && sessionId.length > 0,
        sessionId,
        statusCode: response.status,
      };
    },
    deleteSession(sessionId) {
      const response = config.http.del(`${sessionUrl}/${encodeURIComponent(sessionId)}`, null, {
        headers,
        tags: { name: "skaha_delete_session" },
        timeout: "30s",
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
        tags: { name: "skaha_get_session" },
        timeout: "30s",
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

export function runSkahaSurface(
  config: SkahaSurfaceConfig,
  client: SkahaSurfaceClient,
  pollUntil: SkahaPollUntil,
  now: () => number = Date.now,
): SkahaSurfaceResult {
  const submittedAt = now();
  const createResponse = client.createSession(config.session);
  const submissionDurationMs = now() - submittedAt;

  if (!createResponse.accepted || createResponse.sessionId === undefined) {
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

  const visibleSession = pollUntil(
    config.visibilityGateSeconds,
    config.pollIntervalSeconds,
    () => client.getSession(createResponse.sessionId as string),
    (result) => result.found && result.status !== undefined,
  );
  if (visibleSession === undefined || !visibleSession.found) {
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
  const completedSession = pollUntil(
    config.completionGateSeconds,
    config.pollIntervalSeconds,
    () => client.getSession(createResponse.sessionId as string),
    (result) => result.status === "Completed" || isTerminalFailureStatus(result.status),
  );

  if (completedSession?.status !== "Completed") {
    return {
      completed: false,
      createResponse,
      failure: {
        message: `Skaha session did not reach Completed within ${config.completionGateSeconds}s`,
        stage: "completion",
      },
      submissionDurationMs,
      visible: true,
      visibilityLatencyMs,
    };
  }

  return {
    completed: true,
    completionLatencyMs: now() - submittedAt,
    createResponse,
    submissionDurationMs,
    visible: true,
    visibilityLatencyMs,
  };
}

function encodeCreateSessionForm(params: SkahaCreateSessionParams): string {
  const form = new URLSearchParams();
  form.append("name", params.name);
  form.append("image", params.image);
  form.append("type", "headless");
  form.append("cores", String(Math.max(1, params.cores ?? 1)));
  form.append("ram", String(Math.max(1, params.ram ?? 1)));
  form.append("cmd", params.cmd);
  form.append("args", params.args.join(" "));
  for (const [key, value] of Object.entries(params.env ?? {})) {
    form.append("env", `${key}=${value}`);
  }
  return form.toString();
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
