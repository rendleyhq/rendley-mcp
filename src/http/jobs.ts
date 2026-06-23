import { getJob, jobToResponse } from "@/jobs/index";

const JOB_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOT_FOUND_MESSAGE =
  "job not found — jobs are kept in memory only and do not survive a server " +
  "restart; terminal jobs are also evicted after about 60 minutes";

function jsonError(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({ error: { code, message } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

export async function handleGetJob(jobId: string, apiKeyId: string): Promise<Response> {
  if (!JOB_ID_RE.test(jobId)) {
    return jsonError(400, "BAD_REQUEST", "invalid job id format");
  }

  const job = await getJob(jobId);
  // Wrong-owner returns 404 (not 403) so probes can't enumerate job existence.
  if (!job || job.owner_key_id !== apiKeyId) {
    return jsonError(404, "JOB_NOT_FOUND", NOT_FOUND_MESSAGE);
  }
  return new Response(JSON.stringify(jobToResponse(job)), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
