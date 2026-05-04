export const RUN_CLASSES = ["spot", "benchmark", "stress"] as const;
export const SCENARIOS = ["single-bulk-user", "many-small-users", "throughput-stress"] as const;
export const SURFACES = ["k8s-direct", "k8s-kueue", "skaha"] as const;
export const PROFILES = [
  "spot-direct-tiny",
  "spot-tiny",
  "benchmark-small",
  "benchmark-medium",
  "stress-medium",
  "stress-high",
] as const;
export const JOB_PROFILES = ["tiny", "small", "standard", "heavy"] as const;

export type RunClass = (typeof RUN_CLASSES)[number];
export type Scenario = (typeof SCENARIOS)[number];
export type Surface = (typeof SURFACES)[number];
export type Profile = (typeof PROFILES)[number];
export type JobProfile = (typeof JOB_PROFILES)[number];
export type MetricProfile = "full" | "lean";
export type TestRunGrouping = "combined" | "separate-per-surface";

export interface ProfileDefinition {
  cleanup: boolean;
  completionGateSeconds?: number;
  jobProfile: JobProfile;
  jobsPerSurface: number;
  logicalUsers: number;
  metricProfile: MetricProfile;
  preserveOnFailure: boolean;
  profile: Profile;
  runClass: RunClass;
  scenario: Scenario;
  surfaces: Surface[];
  testRunGrouping: TestRunGrouping;
  visibilityGateSeconds?: number;
}

export const JOB_PROFILE_DURATIONS_SECONDS: Record<JobProfile, number> = {
  heavy: 60,
  small: 30,
  standard: 45,
  tiny: 10,
};

export const PROFILE_DEFINITIONS: Record<Profile, ProfileDefinition> = {
  "benchmark-medium": {
    cleanup: true,
    jobProfile: "standard",
    jobsPerSurface: 1000,
    logicalUsers: 100,
    metricProfile: "full",
    preserveOnFailure: false,
    profile: "benchmark-medium",
    runClass: "benchmark",
    scenario: "many-small-users",
    surfaces: ["k8s-kueue", "k8s-direct", "skaha"],
    testRunGrouping: "separate-per-surface",
  },
  "benchmark-small": {
    cleanup: true,
    jobProfile: "small",
    jobsPerSurface: 100,
    logicalUsers: 1,
    metricProfile: "full",
    preserveOnFailure: false,
    profile: "benchmark-small",
    runClass: "benchmark",
    scenario: "single-bulk-user",
    surfaces: ["k8s-kueue", "k8s-direct", "skaha"],
    testRunGrouping: "separate-per-surface",
  },
  "spot-direct-tiny": {
    cleanup: true,
    completionGateSeconds: 120,
    jobProfile: "tiny",
    jobsPerSurface: 1,
    logicalUsers: 1,
    metricProfile: "full",
    preserveOnFailure: false,
    profile: "spot-direct-tiny",
    runClass: "spot",
    scenario: "single-bulk-user",
    surfaces: ["k8s-direct"],
    testRunGrouping: "combined",
    visibilityGateSeconds: 60,
  },
  "spot-tiny": {
    cleanup: true,
    completionGateSeconds: 120,
    jobProfile: "tiny",
    jobsPerSurface: 1,
    logicalUsers: 1,
    metricProfile: "full",
    preserveOnFailure: false,
    profile: "spot-tiny",
    runClass: "spot",
    scenario: "single-bulk-user",
    surfaces: ["k8s-direct", "k8s-kueue", "skaha"],
    testRunGrouping: "combined",
    visibilityGateSeconds: 60,
  },
  "stress-high": {
    cleanup: true,
    jobProfile: "small",
    jobsPerSurface: 100000,
    logicalUsers: 100,
    metricProfile: "lean",
    preserveOnFailure: false,
    profile: "stress-high",
    runClass: "stress",
    scenario: "throughput-stress",
    surfaces: ["k8s-kueue"],
    testRunGrouping: "separate-per-surface",
  },
  "stress-medium": {
    cleanup: true,
    jobProfile: "small",
    jobsPerSurface: 10000,
    logicalUsers: 100,
    metricProfile: "lean",
    preserveOnFailure: false,
    profile: "stress-medium",
    runClass: "stress",
    scenario: "throughput-stress",
    surfaces: ["k8s-kueue", "k8s-direct", "skaha"],
    testRunGrouping: "separate-per-surface",
  },
};

export function isProfile(value: string): value is Profile {
  return (PROFILES as readonly string[]).includes(value);
}

export function isRunClass(value: string): value is RunClass {
  return (RUN_CLASSES as readonly string[]).includes(value);
}

export function isScenario(value: string): value is Scenario {
  return (SCENARIOS as readonly string[]).includes(value);
}

export function isSurface(value: string): value is Surface {
  return (SURFACES as readonly string[]).includes(value);
}

export function isJobProfile(value: string): value is JobProfile {
  return (JOB_PROFILES as readonly string[]).includes(value);
}
