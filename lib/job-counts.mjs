// Count original work orders, not visits, invoice segments, or employee assignments.
export function originalJobKey(job) {
  const number = String(job.invoice_number ?? '').trim();
  // HCP gives linked segments numbers such as 8358-1 and 8358-2.
  return /^\d+(?:-\d+)?$/.test(number) ? number.split('-')[0] : String(job.id);
}

export function jobLocalDate(job) {
  const schedule = job.schedule || {};
  if (schedule.scheduled_start_local) return schedule.scheduled_start_local.slice(0, 10);
  if (!schedule.scheduled_start) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: schedule.time_zone || 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(schedule.scheduled_start));
}

export function isCompleted(job) {
  return ['complete rated', 'complete unrated', 'completed'].includes(job.work_status);
}

const REPAIR = /\bcall[\s-]*backs?\b|\bre[\s-]*visits?\b|\btouch[\s-]*ups?\b|\b(?:repair|repairs|repairing|redo|redone|fix|fixed|fixes|fixing)\b|\bstreaky\b|\blights? (?:are |have )?(?:falling|fallen|not working)\b|\b(?:issues? with|having issues|power issues|faulty sand|still milky)\b/i;
const PRODUCTION = /\b(?:wash(?:ing)?|clean(?:ing)?|sand(?:ing)?|seal(?:ing)?|install(?:ation)?|takedown|take down|removal|finishing|completion)\b/i;

export function classifyVisit(job, overrides = {}) {
  const month = jobLocalDate(job)?.slice(0, 7);
  const override = overrides[job.id] || overrides[`${month}:${job.invoice_number}`] || overrides[`${month}:${originalJobKey(job)}`];
  if (override === 'p') return 'production';
  if (override === 'r') return 'repair';
  if (override === 'n') return 'nonproduction';
  if (override === 'production' || override === 'repair' || override === 'nonproduction') return override;
  const title = [job.segment_name, job.name, job.description].filter(Boolean).join(' ');
  // Explicit callback visits are corrective even when charged. A paid repair
  // can itself be a new service order; reviewed exceptions override it above.
  if (/\bcall[\s-]*backs?\b|\bre[\s-]*visits?\b/i.test(title)) return 'repair';
  if (Number(job.total_amount) > 0) return 'production';
  if (REPAIR.test(title)) return 'repair';
  // A paid production stage can have notes about later callbacks. Those notes must not
  // retrospectively turn the original installation into a callback.
  if (PRODUCTION.test(title)) return 'production';
  const notes = (job.notes || []).map(n => typeof n === 'string' ? n : n.content || '').join('\n');
  if (REPAIR.test(notes)) return 'repair';
  if (PRODUCTION.test(notes)) return 'production';
  // Price alone cannot identify callbacks. Keep unlabelled work, but expose it for review.
  return 'unclassified';
}

export function countOriginalJobs(jobs, overrides = {}) {
  const groups = new Map();
  const seen = new Set();
  let completedVisits = 0;
  for (const job of jobs) {
    if (!isCompleted(job) || seen.has(job.id)) continue;
    seen.add(job.id);
    completedVisits++;
    const key = originalJobKey(job);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ job, classification: classifyVisit(job, overrides) });
  }
  const perTech = new Map();
  let jobsCompleted = 0, correctiveOnlyJobs = 0, unclassifiedJobs = 0;
  for (const [key, visits] of groups) {
    const production = visits.filter(v => ['production', 'unclassified'].includes(v.classification));
    if (!production.length) { correctiveOnlyJobs++; continue; }
    jobsCompleted++;
    if (production.every(v => v.classification === 'unclassified')) unclassifiedJobs++;
    for (const { job } of production) {
      for (const employee of job.assigned_employees || []) {
        const name = `${employee.first_name || ''} ${employee.last_name || ''}`.trim();
        if (!perTech.has(name)) perTech.set(name, new Set());
        perTech.get(name).add(key);
      }
    }
  }
  return { jobsCompleted, completedVisits, distinctOriginalJobs: groups.size,
    correctiveOnlyJobs, unclassifiedJobs,
    perTech: Object.fromEntries([...perTech].map(([name, keys]) => [name, keys.size])) };
}
