import type { JobProfile, MetricProfile, Scenario, Surface, TestRunGrouping } from "../profiles";

export type { JobProfile, Scenario, Surface } from "../profiles";

export const RUN_CLASSES = ["cron", "campaign"] as const;
export const CAMPAIGN_TYPES = ["benchmark", "stress"] as const;
export const PROFILES = ["cron", "campaign"] as const;

export type RunClass = (typeof RUN_CLASSES)[number];
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];
export type Profile = (typeof PROFILES)[number];

export const DEFAULT_PROFILE = "cron" as const;
export const DEFAULT_RUN_CLASS = "cron" as const;
export const DEFAULT_SCENARIO = "single-bulk-user" as const;
export const DEFAULT_SURFACE = "k8s-direct" as const;
export const DEFAULT_JOB_PROFILE = "tiny" as const;
export const DEFAULT_WORKLOAD_NAMESPACE = "canfar-workloads" as const;
export const DEFAULT_WORKLOAD_IMAGE = "images.canfar.net/skaha/stress-ng:latest" as const;
export const DEFAULT_SKAHA_WORKLOAD_IMAGE = DEFAULT_WORKLOAD_IMAGE;
export const DEFAULT_SKAHA_API_URL =
  "http://canfar-skaha-staging-skaha-tomcat-svc.canfar-system-staging.svc.keel-prod.local:8080/skaha/v1" as const;
export const DEFAULT_SKAHA_LOGIN_URL = "https://ws-cadc.canfar.net/ac/login" as const;

export type ClientMode = "noop" | "kubernetes";

export interface EnvSource {
  [key: string]: string | undefined;
}

export interface WorkloadConfig {
  activeDeadlineSeconds: number;
  args: string[];
  command?: string[];
  durationSeconds: number;
  image: string;
  imagePullPolicy: "Always" | "IfNotPresent" | "Never";
  ttlSecondsAfterFinished: number;
}

export interface KubernetesConfig {
  apiServer: string;
  insecureSkipTLSVerify: boolean;
  namespace: string;
  pollIntervalSeconds: number;
  tokenPath: string;
}

export interface KueueConfig {
  admissionGateSeconds: number;
  priorityClass: string;
  queueName: string;
}

export interface SkahaConfig {
  apiUrl: string;
  loginUrl: string;
  passwordPath: string;
  requestTimeoutSeconds: number;
  usernamePath: string;
}

export type ExpectedJobsEmission = "per-iteration" | "setup-once";

export interface RunConfig {
  campaignType?: CampaignType;
  cleanup: boolean;
  clientMode: ClientMode;
  cohort: "baseline";
  completionTimeoutSeconds: number;
  expectedJobsEmission: ExpectedJobsEmission;
  jobIndex: number;
  jobName: string;
  jobProfile: JobProfile;
  jobsPerLogicalUser: number;
  jobsPerSurface: number;
  kueue: KueueConfig;
  kubernetes: KubernetesConfig;
  logicalUsers: number;
  metricProfile: MetricProfile;
  noopSleepSeconds: number;
  pollJitterMaxMs: number;
  preserveOnFailure: boolean;
  profile: Profile;
  runClass: RunClass;
  scenario: Scenario;
  surface: Surface;
  surfaces: Surface[];
  skaha: SkahaConfig;
  testid: string;
  testRunGrouping: TestRunGrouping;
  totalJobs: number;
  userBucket: string;
  userBucketIndex: number;
  userShape: string;
  submissionJitterMaxMs: number;
  visibilityGateSeconds: number;
  workload: WorkloadConfig;
}

export const SERVICE_ACCOUNT_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token";
export const DEFAULT_SKAHA_PASSWORD_PATH = "/var/run/secrets/perfpulse/skaha-auth/password";
export const DEFAULT_SKAHA_USERNAME_PATH = "/var/run/secrets/perfpulse/skaha-auth/username";
export const DEFAULT_CAMPAIGN_COMPLETION_TIMEOUT_SECONDS = 259_200;
export const DEFAULT_CRON_COMPLETION_TIMEOUT_SECONDS = 86_400;
export const DEFAULT_JITTER_MAX_MS = 1_000;
