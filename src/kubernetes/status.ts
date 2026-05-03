interface JobCondition {
  status?: string;
  type?: string;
}

export interface JobLike {
  metadata?: {
    name?: string;
  };
  status?: {
    conditions?: JobCondition[];
  };
}

export interface JobListLike {
  items?: JobLike[];
}

export function findJobByName(list: JobListLike, name: string): JobLike | undefined {
  return list.items?.find((job) => job.metadata?.name === name);
}

export function isJobComplete(job: JobLike): boolean {
  return hasCondition(job, "Complete");
}

export function isJobFailed(job: JobLike): boolean {
  return hasCondition(job, "Failed");
}

function hasCondition(job: JobLike, type: string): boolean {
  return (
    job.status?.conditions?.some(
      (condition) => condition.type === type && condition.status === "True",
    ) ?? false
  );
}
