// Optional integration with Wrangler²'s own board attention rule. Keep this
// fixed URL relative to the host; no graph value can choose executable code.
export const loadJobsAttention = () => import('/ext/jobs/public/job-state.js');

export function createJobAttention({ load = loadJobsAttention, changed }) {
  let active = true, enabled = false, generation = 0, rule = null, loading = false, failed = false;
  function stop() { enabled = false; generation++; loading = false; failed = false; }
  return {
    update(sessions, snapshot, allowed) {
      if (!active) return { sessions, jobCount: 0, diagnostic: '' };
      if (!allowed) {
        if (enabled) stop();
        return { sessions, jobCount: 0, diagnostic: '' };
      }
      enabled = true;
      if (!rule && !loading && !failed) {
        loading = true;
        const started = generation;
        let request;
        try { request = load(); } catch { request = Promise.reject(new Error('Unavailable')); }
        Promise.resolve(request).then((module) => {
          if (!active || !enabled || generation !== started) return;
          if (typeof module?.jobNeedsYou !== 'function') throw new Error('Missing attention rule');
          rule = module.jobNeedsYou;
        }).catch(() => {
          if (active && enabled && generation === started) failed = true;
        }).finally(() => {
          if (!active || !enabled || generation !== started) return;
          loading = false; changed();
        });
      }
      const jobs = Array.isArray(snapshot?.jobs) ? snapshot.jobs : [];
      const counted = new Set(), linked = new Set();
      let partial = failed;
      if (rule) for (const job of jobs) {
        // Finished history is sent as opaque plate stubs. This integration
        // deliberately covers active jobs; it does not request history plates.
        if (job?.plate || job?.stage === 'done') continue;
        if (!job || !Array.isArray(job.runs) || !Array.isArray(job.subJobs)) { partial = true; continue; }
        try {
          if (!rule(job)) continue;
          const key = job.id ?? job;
          if (counted.has(key)) continue;
          counted.add(key);
          for (const run of job.runs) if (run?.sessionId) linked.add(run.sessionId);
          for (const sub of job.subJobs) for (const sid of sub?.sessions || []) linked.add(sid);
        } catch { partial = true; }
      }
      return {
        sessions: sessions.filter((session) => !linked.has(session.sessionId)),
        jobCount: counted.size,
        diagnostic: partial ? 'Wrangler² attention is unavailable or incomplete; session attention remains available.'
          : loading ? 'Loading Wrangler² attention; showing session attention meanwhile.' : '',
      };
    },
    reset() { stop(); },
    dispose() { active = false; stop(); },
  };
}
