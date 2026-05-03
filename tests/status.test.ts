import { describe, expect, test } from "bun:test";
import { findJobByName, isJobComplete, isJobFailed } from "../src/kubernetes/status";

describe("Kubernetes Job status contract", () => {
  test("finds the labeled workload Job by name in a Job list", () => {
    const job = { metadata: { name: "perfpulse-kind-smoke-0" } };

    expect(
      findJobByName(
        {
          items: [{ metadata: { name: "other-job" } }, job],
        },
        "perfpulse-kind-smoke-0",
      ),
    ).toBe(job);
  });

  test("recognizes completion and failure terminal conditions", () => {
    expect(
      isJobComplete({
        status: { conditions: [{ status: "True", type: "Complete" }] },
      }),
    ).toBe(true);
    expect(
      isJobFailed({
        status: { conditions: [{ status: "True", type: "Failed" }] },
      }),
    ).toBe(true);
    expect(
      isJobComplete({
        status: { conditions: [{ status: "False", type: "Complete" }] },
      }),
    ).toBe(false);
  });
});
