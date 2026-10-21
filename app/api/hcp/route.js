import { NextResponse } from 'next/server';
import { inflateSync } from 'node:zlib';
import { countOriginalJobs, jobLocalDate } from '../../../lib/job-counts.mjs';

const HCP_API_KEY = process.env.HCP_API_KEY;
const BASE = 'https://api.housecallpro.com';
const headers = { Authorization: `Token ${HCP_API_KEY}`, 'Content-Type': 'application/json' };

async function fetchHcp(path) {
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(`${BASE}${path}`, { headers });
    if (res.status !== 429 && res.status < 500) break;
    if (attempt < 2) {
      const retry = Number(res.headers.get('retry-after'));
      await new Promise(resolve => setTimeout(resolve, Math.min(5000, retry > 0 ? retry * 1000 : 1000 * (attempt + 1))));
    }
  }
  if (!res.ok) throw new Error(`Housecall request failed (${res.status}). Please try again shortly.`);
  return res.json();
}

async function fetchAllPages(endpoint) {
  const PAGE_SIZE = 100;
  const first = await fetchHcp(`${endpoint}&page=1&page_size=${PAGE_SIZE}`);
  let results = first.jobs || [];
  // Read the reported page count instead of requesting ten pages for every month.
  if (Number.isInteger(first.total_pages)) {
    for (let page = 2; page <= first.total_pages; page++) {
      const data = await fetchHcp(`${endpoint}&page=${page}&page_size=${PAGE_SIZE}`);
      results.push(...(data.jobs || []));
    }
  } else {
    for (let page = 2; results.length === (page - 1) * PAGE_SIZE; page++) {
      const data = await fetchHcp(`${endpoint}&page=${page}&page_size=${PAGE_SIZE}`);
      results.push(...(data.jobs || []));
      if (!(data.jobs || []).length) break;
    }
  }
  return results;
}

// Fetch invoices for a batch of job IDs concurrently (bounded), rather than one request per job
// sequentially. This is the main cost for wide date ranges — one extra HTTP round trip per
// completed job — so the batch size here matters more than the one above for avoiding timeouts.
async function fetchInvoicesForJobs(jobIds) {
  const BATCH_SIZE = 5;
  const invoicesByJob = {};
  for (let i = 0; i < jobIds.length; i += BATCH_SIZE) {
    const batch = jobIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async (jobId) => {
      const res = await fetch(`${BASE}/invoices?job_id=${jobId}&page=1&page_size=10`, { headers });
      if (!res.ok) return [];
      const data = await res.json();
      return data.invoices || (Array.isArray(data) ? data : []);
    }));
    batch.forEach((jobId, idx) => { invoicesByJob[jobId] = results[idx]; });
  }
  return invoicesByJob;
}

// YYYY-MM-DD in a given IANA timezone (e.g. "America/Toronto") — using the job's own timezone
// avoids the UTC-midnight edge case from before.
function localDateStr(iso, tz) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, 10);
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate   = searchParams.get('endDate');
    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'Missing startDate or endDate' }, { status: 400 });
    }

    // Fetch a broad UTC window, then apply the exact local calendar dates below.
    const startISO = new Date(Date.parse(startDate + 'T00:00:00Z') - 86400000).toISOString();
    const endISO = new Date(Date.parse(endDate + 'T00:00:00Z') + 2 * 86400000).toISOString();

    // Fetch field techs
    const employees = (await fetchHcp('/employees?page=1&page_size=100')).employees || [];
    const exclude   = ['Nick Preisenhammer'];
    // These techs are misclassified as "office staff" (or some other non-"field tech" role) in
    // Housecall Pro but are actually field techs. Dylan White and Logan Brodrecht were showing
    // 0 jobs/hours despite clearly working (real callbacks/yard signs/reviews on record), which
    // is the same symptom Keith Mayne had — add anyone else who shows 0 jobsCompleted here too.
    const includeOverride = ['Keith Mayne', 'Dylan White', 'Logan Brodrecht'];
    const techs = employees.filter(e => {
      const name = `${e.first_name} ${e.last_name}`.trim();
      if (exclude.includes(name)) return false;
      return e.role === 'field tech' || includeOverride.includes(name);
    });

    // Fetch all jobs in date range
    const fetchedJobs = await fetchAllPages(
      `/jobs?scheduled_start_min=${startISO}&scheduled_start_max=${endISO}`
    );
    const jobs = [...new Map(fetchedJobs.map(job => [job.id, job])).values()].filter(job => {
      const date = jobLocalDate(job);
      return date && date >= startDate && date <= endDate;
    });
    const reviewedRules = process.env.JOB_COUNT_OVERRIDES_Z
      ? inflateSync(Buffer.from(process.env.JOB_COUNT_OVERRIDES_Z, 'base64')).toString('utf8')
      : process.env.JOB_COUNT_OVERRIDES || '{}';
    const overrides = JSON.parse(reviewedRules);
    const jobCounts = countOriginalJobs(jobs, overrides);

    // Build per-tech stats
    const stats = {};
    for (const tech of techs) {
      const name = `${tech.first_name} ${tech.last_name}`.trim();
      stats[name] = {
        tech:            name,
        jobsCompleted:   0,
        visitsCompleted: 0,
        revenue:         0,
        tips:            0,
        hoursWorked:     0,
        chargeRate:      0,
        missedSameDay:   0, // completed jobs that DIDN'T finish + get invoiced same-day as scheduled
      };
    }

    const companyJobsCompleted = jobCounts.jobsCompleted;
    let companyMissedSameDay = 0; // distinct completed jobs that missed the same-day rule

    // Only bother pulling invoices for jobs that actually finished — an unfinished job is tracked
    // separately (per Nick: "if they're unable to complete a job... we can just track it as
    // unfinished") and never counts as a miss here.
    const completedJobIds = jobs
      .filter(j => j.work_status === 'complete rated' || j.work_status === 'complete unrated')
      .map(j => j.id);
    const invoicesByJob = await fetchInvoicesForJobs(completedJobIds);

    for (const job of jobs) {
      const assigned = job.assigned_employees || [];
      if (!assigned.length) continue;

      const n = assigned.length;
      const isCompleted = job.work_status === 'complete rated' || job.work_status === 'complete unrated';

      // Bonus-eligible ("not missed") requires BOTH:
      //   1. the job was actually marked finished on the same calendar day it was scheduled for
      //      (not just eventually finished later)
      //   2. an invoice for the job was created that same day
      // Housecall Pro doesn't track a real "sent" action for this account (confirmed — every
      // invoice's sent_at is null, even paid ones), so invoice creation date is the closest
      // available signal for "the invoice went out."
      let missedSameDay = false;
      if (isCompleted) {
        const tz = job.schedule?.time_zone;
        const scheduledDate = localDateStr(job.schedule?.scheduled_start, tz);
        const completedDate = localDateStr(job.work_timestamps?.completed_at, tz);
        const jobInvoices   = invoicesByJob[job.id] || [];
        const invoicedSameDay = jobInvoices.some(inv => localDateStr(inv.invoice_date, tz) === scheduledDate);
        const completedSameDay = scheduledDate != null && completedDate === scheduledDate;
        missedSameDay = !(completedSameDay && invoicedSameDay);
        if (missedSameDay) companyMissedSameDay++;
      }

      for (const emp of assigned) {
        const name = `${emp.first_name} ${emp.last_name}`.trim();
        if (!stats[name]) continue;

        if (isCompleted) {
          stats[name].visitsCompleted += 1;
          stats[name].revenue       += (job.total_amount || 0) / n;
          stats[name].tips          += (job.tip_amount || 0) / n;
          if (missedSameDay) stats[name].missedSameDay += 1;
        }

        const sched = job.schedule || {};
        if (sched.scheduled_start && sched.scheduled_end) {
          const hrs = (new Date(sched.scheduled_end) - new Date(sched.scheduled_start)) / 3600000;
          stats[name].hoursWorked += hrs / n;
        }
      }
    }

    for (const name of Object.keys(stats)) {
      const s = stats[name];
      s.jobsCompleted = jobCounts.perTech[name] || 0;
      s.chargeRate = s.hoursWorked > 0 ? Math.round(s.revenue / s.hoursWorked) : 0;
    }

    return NextResponse.json({
      success: true,
      data: Object.values(stats),
      companyJobsCompleted,
      companyCompletedVisits: jobCounts.completedVisits,
      companyDistinctOriginalJobs: jobCounts.distinctOriginalJobs,
      companyCorrectiveOnlyJobs: jobCounts.correctiveOnlyJobs,
      companyUnclassifiedJobs: jobCounts.unclassifiedJobs,
      companyMissedSameDay,
    });
  } catch (err) {
    console.error('HCP API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
