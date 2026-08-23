/**
 * Legacy Python `video_generation_records` never had a `job_id` field. This
 * is the synthetic jobId those records are "adopted" under everywhere in
 * this codebase, so a pre-migration project's video review stays reachable
 * through the job-scoped API without a one-time data migration pass.
 */
export const LEGACY_VIDEO_JOB_ID = "legacy";
