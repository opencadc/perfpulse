export const SKAHA_HTTP_ERROR_METRIC = "perfpulse_skaha_http_errors";

export type SkahaHttpErrorOperation = "create_session" | "delete_session" | "get_session";

const MAX_RESPONSE_BODY_TAG_LENGTH = 512;

export interface SkahaHttpErrorSummaryMetric {
  submetrics?: Array<{
    tags?: Record<string, string>;
    values?: { count?: number };
  }>;
}

export function normalizeSkahaHttpErrorBody(body: unknown): string {
  if (body === undefined || body === null) {
    return "";
  }
  const text = typeof body === "string" ? body : String(body);
  return text.replace(/\s+/gu, " ").trim();
}

export function truncateSkahaHttpErrorBody(body: string): string {
  if (body.length <= MAX_RESPONSE_BODY_TAG_LENGTH) {
    return body;
  }
  return `${body.slice(0, MAX_RESPONSE_BODY_TAG_LENGTH - 3)}...`;
}

export function skahaHttpErrorTags(
  operation: SkahaHttpErrorOperation,
  statusCode: number,
  body: unknown,
): Record<string, string> {
  return {
    http_status: String(statusCode),
    operation,
    response_body: truncateSkahaHttpErrorBody(normalizeSkahaHttpErrorBody(body)),
  };
}

export function formatSkahaHttpErrorSummary(
  metrics: Record<string, SkahaHttpErrorSummaryMetric>,
): string {
  const submetrics = metrics[SKAHA_HTTP_ERROR_METRIC]?.submetrics ?? [];
  if (submetrics.length === 0) {
    return "";
  }

  const entries = submetrics
    .map((submetric) => {
      const tags = submetric.tags ?? {};
      const operation = tags.operation ?? "unknown";
      const status = tags.http_status ?? "unknown";
      const responseBody = tags.response_body ?? "";
      const count = submetric.values?.count ?? 0;
      return { count, operation, responseBody, status };
    })
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      if (left.status !== right.status) {
        return left.status.localeCompare(right.status);
      }
      return left.responseBody.localeCompare(right.responseBody);
    });

  const lines = [
    "=== Skaha HTTP error responses (unique) ===",
    ...entries.map(
      (entry) =>
        `[${entry.operation}] HTTP ${entry.status} (${entry.count}x): ${entry.responseBody || "<empty body>"}`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}
