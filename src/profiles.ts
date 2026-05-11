export const SCENARIOS = ["single-bulk-user", "many-small-users"] as const;
export const SURFACES = ["k8s-direct", "k8s-kueue", "skaha"] as const;
export const JOB_PROFILES = ["tiny", "small", "standard", "heavy"] as const;

export type Scenario = (typeof SCENARIOS)[number];
export type Surface = (typeof SURFACES)[number];
export type JobProfile = (typeof JOB_PROFILES)[number];
export type MetricProfile = "full" | "lean";
export type TestRunGrouping = "combined" | "separate-per-surface";

export const JOB_PROFILE_DURATIONS_SECONDS: Record<JobProfile, number> = {
  heavy: 60,
  small: 30,
  standard: 45,
  tiny: 10,
};

export function isScenario(value: string): value is Scenario {
  return (SCENARIOS as readonly string[]).includes(value);
}

export function isSurface(value: string): value is Surface {
  return (SURFACES as readonly string[]).includes(value);
}

export function isJobProfile(value: string): value is JobProfile {
  return (JOB_PROFILES as readonly string[]).includes(value);
}
