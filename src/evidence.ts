export type RunClass = "cron" | "campaign";
export type CampaignType = "benchmark" | "stress";
export type WorkloadModel = "closed" | "open";
export type CleanupResult = "succeeded" | "failed" | "skipped" | "unknown";

export interface EvidenceLink {
  label: string;
  url: string;
}

export interface RunEvidenceInput {
  acceptedWorkCount: number;
  activeHypothesis?: string;
  admittedKueueWorkloadCount?: number;
  artifactLinks?: EvidenceLink[];
  campaignType?: CampaignType;
  cleanupResult: CleanupResult;
  completedWorkCount: number;
  dashboardLinks?: EvidenceLink[];
  executor: string;
  expectedWorkCount: number;
  gitSha?: string;
  imageTag?: string;
  profile: string;
  prometheusLinks?: EvidenceLink[];
  runClass: RunClass;
  runnerImage: string;
  scenario: string;
  surface: string;
  targetNamespaces: string[];
  testid: string;
  thresholdsUsed: string[];
  visibleWorkCount: number;
  workloadModel: WorkloadModel;
}

export function createRunEvidenceReport(input: RunEvidenceInput): string {
  validateRunEvidenceInput(input);

  const rows = [
    ["testid", input.testid],
    ["git SHA", input.gitSha ?? "not provided"],
    ["image tag", input.imageTag ?? "not provided"],
    ["profile", input.profile],
    ["surface", input.surface],
    ["scenario", input.scenario],
    ["executor", input.executor],
    ["workload model", input.workloadModel],
    ["run class", input.runClass],
    ["runner image", input.runnerImage],
    ["target namespaces", input.targetNamespaces.join(", ")],
    ["expected work count", `${input.expectedWorkCount}`],
    ["accepted work count", `${input.acceptedWorkCount}`],
    ["visible work count", `${input.visibleWorkCount}`],
    ["completed work count", `${input.completedWorkCount}`],
    ["cleanup result", input.cleanupResult],
  ];

  if (input.admittedKueueWorkloadCount !== undefined) {
    rows.push(["admitted Kueue Workload count", `${input.admittedKueueWorkloadCount}`]);
  }
  if (input.campaignType !== undefined) {
    rows.push(["campaign type", input.campaignType]);
  }
  if (input.activeHypothesis !== undefined) {
    rows.push(["active hypothesis", input.activeHypothesis]);
  }

  const sections = [
    `# PerfPulse Run Evidence: ${input.testid}`,
    "",
    "## Summary",
    "",
    "| Field | Value |",
    "| --- | --- |",
    ...rows.map(([field, value]) => `| ${field} | ${value} |`),
    "",
    "## Thresholds Used",
    "",
    ...input.thresholdsUsed.map((threshold) => `- \`${threshold}\``),
    ...linkSection("Dashboard Links", input.dashboardLinks),
    ...linkSection("Prometheus Query Links", input.prometheusLinks),
    ...linkSection("Artifacts", input.artifactLinks),
    "",
  ];

  return sections.join("\n");
}

function validateRunEvidenceInput(input: RunEvidenceInput): void {
  rejectSensitiveValues(input);

  if (isBlank(input.gitSha) && isBlank(input.imageTag)) {
    throw new Error("run evidence requires gitSha or imageTag");
  }

  if (input.runClass === "campaign" && input.campaignType === undefined) {
    throw new Error("campaign run evidence requires campaignType");
  }

  if (input.runClass === "cron" && input.campaignType !== undefined) {
    throw new Error("cron run evidence must not include campaignType");
  }

  if (input.runClass === "campaign" && isBlank(input.activeHypothesis)) {
    throw new Error("campaign run evidence requires activeHypothesis");
  }
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

function rejectSensitiveValues(value: unknown): void {
  if (containsSensitiveValue(value)) {
    throw new Error("run evidence contains a sensitive value");
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

function linkSection(title: string, links: EvidenceLink[] | undefined): string[] {
  if (links === undefined || links.length === 0) {
    return [];
  }

  return ["", `## ${title}`, "", ...links.map((link) => `- [${link.label}](${link.url})`)];
}
