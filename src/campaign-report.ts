export type CampaignRunClass = "campaign";
export type CampaignType = "benchmark" | "stress";
export type CampaignSurface = "k8s-direct" | "k8s-kueue" | "skaha";
export type CleanupStatus = "succeeded" | "failed" | "skipped" | "unknown";

export interface CampaignReport {
  blockers: string[];
  markdown: string;
  runnable: boolean;
}

export type MixedPressureCohortLabel = "background" | "foreground";

export interface MixedPressureCohort {
  cohort: MixedPressureCohortLabel;
  workloadShape: string;
}

export interface MixedPressureProfileInput {
  activeHypothesis: string;
  cohorts: MixedPressureCohort[];
  profile: "mixed-background-foreground";
}

export interface MixedPressureProfile {
  activeHypothesis: string;
  cohorts: MixedPressureCohort[];
  profile: "mixed-background-foreground";
  status: "later";
}

export interface ClusterMetricEvidence {
  name: string;
  value: string;
}

export interface LatencyEvidence {
  p50: string;
  p95: string;
  p99: string;
}

export interface SurfaceComparisonEvidence {
  acceptedWork: number;
  cleanupStatus: CleanupStatus;
  clusterMetrics: ClusterMetricEvidence[];
  droppedIterations: number;
  expectedWork: number;
  latency: LatencyEvidence;
  surface: CampaignSurface;
  visibleWork: number;
}

export interface BaselineEvidence {
  exists: boolean;
  note: string;
}

export interface PreserveOnFailureEvidence {
  enabled: boolean;
  labels?: Partial<Record<CampaignResourceLabel, string>>;
}

export type CampaignResourceLabel = "profile" | "surface" | "testid";

export interface StressCompletionEvidence {
  completedWork: number;
  note: string;
}

export interface StressCampaignEvidence {
  acceptedWork: number;
  apiServerPressure: string;
  cleanupStatus: CleanupStatus;
  completion: StressCompletionEvidence;
  droppedIterations: number;
  expectedWork: number;
  grafanaVisibility: string;
  kueueControllerHealth: string;
  rejectionCategories: Record<string, number>;
  visibleWork: number;
  workloadExecution: string;
}

export interface BenchmarkCampaignInput {
  activeHypothesis: string;
  baselines: BaselineEvidence;
  campaignType: "benchmark";
  preserveOnFailure: PreserveOnFailureEvidence;
  profile: "campaign";
  runClass: "campaign";
  surfaces: SurfaceComparisonEvidence[];
  testid: string;
}

export interface StressCampaignInput {
  activeHypothesis: string;
  campaignType: "stress";
  confirmStress: boolean;
  explicitProfileSelection: boolean;
  preserveOnFailure: PreserveOnFailureEvidence;
  profile: "campaign";
  runClass: "campaign";
  stress: StressCampaignEvidence;
  testid: string;
}

export type CampaignReportInput = BenchmarkCampaignInput | StressCampaignInput;

export function createCampaignReport(input: CampaignReportInput): CampaignReport {
  rejectSensitiveValues(input);

  if (input.campaignType === "stress") {
    return createStressCampaignReport(input);
  }

  return createBenchmarkCampaignReport(input);
}

export function createMixedPressureProfile(input: MixedPressureProfileInput): MixedPressureProfile {
  rejectSensitiveValues(input);
  if (isBlank(input.activeHypothesis)) {
    throw new Error("mixed pressure profile requires activeHypothesis");
  }
  const cohortLabels = input.cohorts.map((cohort) => cohort.cohort);
  if (!cohortLabels.includes("background") || !cohortLabels.includes("foreground")) {
    throw new Error("mixed pressure profile requires background and foreground cohorts");
  }
  return {
    activeHypothesis: input.activeHypothesis,
    cohorts: input.cohorts,
    profile: input.profile,
    status: "later",
  };
}

function createBenchmarkCampaignReport(input: BenchmarkCampaignInput): CampaignReport {
  const markdown = [
    `# PerfPulse ${titleCase(input.campaignType)} Campaign: ${input.testid}`,
    "",
    "## Safety",
    "",
    `- Preserve on failure: ${input.preserveOnFailure.enabled ? "enabled" : "disabled"}`,
    "",
    "## Baselines",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Baselines exist | ${input.baselines.exists ? "yes" : "no"} |`,
    `| Baseline note | ${input.baselines.note} |`,
    "",
    "Benchmark thresholds are evidence only until baselines exist.",
    "",
    "## Active Hypothesis",
    "",
    input.activeHypothesis,
    "",
    "## Surface Comparison",
    "",
    "| Surface | Expected work | Accepted work | Visible work | Visible % | p50 latency | p95 latency | p99 latency | Dropped iterations | Cleanup |",
    "| --- | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- |",
    ...input.surfaces.map(
      (surface) =>
        `| ${surface.surface} | ${surface.expectedWork} | ${surface.acceptedWork} | ${surface.visibleWork} | ${formatPercent(surface.visibleWork, surface.expectedWork)} | ${surface.latency.p50} | ${surface.latency.p95} | ${surface.latency.p99} | ${surface.droppedIterations} | ${surface.cleanupStatus} |`,
    ),
    "",
    "## Cluster Metrics",
    "",
    ...input.surfaces.flatMap((surface) =>
      surface.clusterMetrics.map(
        (metric) => `- ${surface.surface}: ${metric.name}=${metric.value}`,
      ),
    ),
    "",
  ].join("\n");

  return {
    blockers: [],
    markdown,
    runnable: true,
  };
}

function createStressCampaignReport(input: StressCampaignInput): CampaignReport {
  const blockers = stressCampaignBlockers(input);
  const markdown = [
    `# PerfPulse Stress Campaign: ${input.testid}`,
    "",
    "## Safety",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Runnable | ${blockers.length === 0 ? "yes" : "no"} |`,
    `| Explicit profile selection | ${input.explicitProfileSelection ? "yes" : "no"} |`,
    `| CONFIRM_STRESS | ${input.confirmStress ? "true" : "false"} |`,
    `| Preserve on failure | ${input.preserveOnFailure.enabled ? "enabled" : "disabled"} |`,
    "",
    "## Blockers",
    "",
    ...listOrNone(blockers),
    "",
    "## Active Hypothesis",
    "",
    input.activeHypothesis,
    "",
    "## Primary Success Evidence",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Expected work | ${input.stress.expectedWork} |`,
    `| Accepted work | ${input.stress.acceptedWork} |`,
    `| Visible work | ${input.stress.visibleWork} |`,
    `| Visible % | ${formatPercent(input.stress.visibleWork, input.stress.expectedWork)} |`,
    `| Dropped iterations | ${input.stress.droppedIterations} |`,
    `| API-server pressure | ${input.stress.apiServerPressure} |`,
    `| Kueue controller health | ${input.stress.kueueControllerHealth} |`,
    `| Workload execution | ${input.stress.workloadExecution} |`,
    `| Grafana visibility | ${input.stress.grafanaVisibility} |`,
    `| Cleanup status | ${input.stress.cleanupStatus} |`,
    "",
    "## Rejection Categories",
    "",
    ...Object.entries(input.stress.rejectionCategories).map(
      ([category, count]) => `- ${category}: ${count}`,
    ),
    "",
    "## Completion (Secondary)",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Completed work | ${input.stress.completion.completedWork} |`,
    `| Completion note | ${input.stress.completion.note} |`,
    "",
  ].join("\n");

  return {
    blockers,
    markdown,
    runnable: blockers.length === 0,
  };
}

function stressCampaignBlockers(input: StressCampaignInput): string[] {
  const blockers: string[] = [];
  if (!input.explicitProfileSelection) {
    blockers.push("stress campaigns require explicit profile selection");
  }
  if (!input.confirmStress) {
    blockers.push("stress campaigns require CONFIRM_STRESS=true");
  }
  blockers.push(...preserveOnFailureBlockers(input.preserveOnFailure));
  return blockers;
}

function preserveOnFailureBlockers(preserveOnFailure: PreserveOnFailureEvidence): string[] {
  if (!preserveOnFailure.enabled) {
    return [];
  }
  const labels = preserveOnFailure.labels ?? {};
  if (isBlank(labels.testid) || isBlank(labels.profile) || isBlank(labels.surface)) {
    return ["preserve-on-failure requires testid, profile, and surface labels"];
  }
  return [];
}

function listOrNone(values: string[]): string[] {
  if (values.length === 0) {
    return ["- none"];
  }
  return values.map((value) => `- ${value}`);
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) {
    return "n/a";
  }
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function rejectSensitiveValues(value: unknown): void {
  if (containsSensitiveValue(value)) {
    throw new Error("campaign report input contains a sensitive value");
  }
}

function containsSensitiveValue(value: unknown): boolean {
  if (typeof value === "string") {
    return SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsSensitiveValue(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).some((item) => containsSensitiveValue(item));
  }
  return false;
}

const SENSITIVE_VALUE_PATTERNS = [
  /\bbearer\s+[a-z0-9._~+/=-]+/iu,
  /\bskaha[-_\s]?token\b/iu,
  /\bremote[-_\s]?write[-_\s]?password\b/iu,
  /\b(password|token|secret)=([^&\s]+)/iu,
  /:\/\/[^/\s:@]+:[^/\s:@]+@/u,
] as const;
