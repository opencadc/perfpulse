export const SCENARIOS = ["single-bulk-user", "many-small-users"] as const;
export const SURFACES = ["k8s-direct", "k8s-kueue", "skaha"] as const;

export type Scenario = (typeof SCENARIOS)[number];
export type Surface = (typeof SURFACES)[number];

export function isScenario(value: string): value is Scenario {
  return (SCENARIOS as readonly string[]).includes(value);
}

export function isSurface(value: string): value is Surface {
  return (SURFACES as readonly string[]).includes(value);
}
