import { Counter } from "k6/metrics";
import {
  formatSkahaHttpErrorSummary,
  SKAHA_HTTP_ERROR_METRIC,
  type SkahaHttpErrorOperation,
  type SkahaHttpErrorSummaryMetric,
  skahaHttpErrorTags,
} from "./skaha-http-error-report";

export {
  formatSkahaHttpErrorSummary,
  normalizeSkahaHttpErrorBody,
  SKAHA_HTTP_ERROR_METRIC,
  type SkahaHttpErrorOperation,
  type SkahaHttpErrorSummaryMetric,
  truncateSkahaHttpErrorBody,
} from "./skaha-http-error-report";

const skahaHttpErrors = new Counter(SKAHA_HTTP_ERROR_METRIC);

export function recordSkahaHttpError(
  operation: SkahaHttpErrorOperation,
  statusCode: number,
  body: unknown,
): void {
  skahaHttpErrors.add(1, skahaHttpErrorTags(operation, statusCode, body));
}

export function handleSummary(data: { metrics: Record<string, SkahaHttpErrorSummaryMetric> }): {
  stdout?: string;
} {
  const summary = formatSkahaHttpErrorSummary(data.metrics);
  if (summary.length === 0) {
    return {};
  }
  return { stdout: summary };
}
