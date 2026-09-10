import { NextResponse } from 'next/server';

const HCP_API_KEY = process.env.HCP_API_KEY;
const BASE = 'https://api.housecallpro.com';
const headers = { Authorization: `Token ${HCP_API_KEY}`, 'Content-Type': 'application/json' };

async function fetchAllPages(endpoint) {
  const PAGE_SIZE = 100;
  const BATCH_SIZE = 5; // fetch 5 pages concurrently instead of one at a time —
                        // long date ranges (many pages) were hitting Netlify's
                        // function execution time limit when fetched serially.
  let results = [];
  let page = 1;
  let done = false;

  while (!done) {
    const pagesToFetch = Array.from({ length: BATCH_SIZE }, (_, i) => page + i);
    const batch = await Promise.all(pagesToFetch.map(async (p) => {
      const res = await fetch(`${BASE}${endpoint}&page=${p}&page_size=${PAGE_SIZE}`, { headers });
      if (!res.ok) throw new Error(`HCP error: ${res.status} ${endpoint} (page ${p})`);
      const data = await res.json();
      return data.jobs || data.employees || [];
    }));

    for (const items of batch) {
      results = results.concat(items);
      if (items.length < PAGE_SIZE) done = true;
    }
    page += BATCH_SIZE;
  }
  return results;
}

// Fetch invoices for a batch of job IDs concurrently (bounded), rather than one request per job
// sequentially — same reasoning as fetchAllPages: keep this under Netlify's execution time limit.
async function fetchInvoicesForJobs(jobIds) {
  const BATCH_SIZE = 8;
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

// YYYY-MM-DD in UTC. Good enough for "same calendar day" comparisons here — timestamps from
// Housecall Pro are UTC, and a job/invoice near midnight ET could in principle land on the
// "wrong" side of this, but that's a rare edge case and matches how the rest of this API already
// treats dates.
function dateStr(iso) {
  return iso ? new Date(iso).toISOString().slice(0, 10) : null;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate   = searchParams.get('endDate');
    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'Missing startDate or endDate' }, { status: 400 });
    }

    const startISO = new Date(startDate).toISOString();
    const endISO   = new Date(endDate + 'T23:59:59').toISOString();

    // Fetch field techs
    const empRes = await fetch(`${BASE}/employees?page=1&page_size=100`, { headers });
    if (!empRes.ok) throw new Error(`HCP error: ${empRes.status} /employees`);
    const employees = (await empRes.json()).employees || [];
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
    const jobs = await fetchAllPages(
      `/jobs?scheduled_start_min=${startISO}&scheduled_start_max=${endISO}`
    );

    // Build per-tech stats
    const stats = {};
    for (const tech of techs) {
      const name = `${tech.first_name} ${tech.last_name}`.trim();
      stats[name] = {
        tech:            name,
        jobsCompleted:   0,
        revenue:         0,
        tips:            0,
        hoursWorked:     0,
        chargeRate:      0,
        sameDayInvoices: 0, // completed jobs where an invoice was sent same-day (bonus eligibility)
      };
    }

    let companyJobsCompleted = 0;   // distinct completed jobs — a 2-tech job still counts as 1
    let companySameDayInvoices = 0; // distinct completed jobs with a same-day-sent invoice

    // Only bother pulling invoices for jobs that actually finished — that's the whole point of
    // this check (an unfinished job was never going to have a same-day invoice anyway).
    const completedJobIds = jobs
      .filter(j => j.work_status === 'complete rated' || j.work_status === 'complete unrated')
      .map(j => j.id);
    const invoicesByJob = await fetchInvoicesForJobs(completedJobIds);

    for (const job of jobs) {
      const assigned = job.assigned_employees || [];
      if (!assigned.length) continue;

      const n = assigned.length;
      const isCompleted = job.work_status === 'complete rated' || job.work_status === 'complete unrated';
      if (isCompleted) companyJobsCompleted++;

      // Same-day invoice: at least one invoice tied to this job was actually sent (sent_at set,
      // not just created) on the same calendar day the job was scheduled for.
      let sameDayInvoice = false;
      if (isCompleted) {
        const jobDate = dateStr(job.schedule?.scheduled_start);
        const jobInvoices = invoicesByJob[job.id] || [];
        sameDayInvoice = jobDate != null && jobInvoices.some(inv => inv.sent_at && dateStr(inv.sent_at) === jobDate);
        if (sameDayInvoice) companySameDayInvoices++;
      }

      for (const emp of assigned) {
        const name = `${emp.first_name} ${emp.last_name}`.trim();
        if (!stats[name]) continue;

        if (isCompleted) {
          stats[name].jobsCompleted += 1;
          stats[name].revenue       += (job.total_amount || 0) / n;
          stats[name].tips          += (job.tip_amount || 0) / n;
          if (sameDayInvoice) stats[name].sameDayInvoices += 1;
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
      s.chargeRate = s.hoursWorked > 0 ? Math.round(s.revenue / s.hoursWorked) : 0;
    }

    return NextResponse.json({
      success: true,
      data: Object.values(stats),
      companyJobsCompleted,
      companySameDayInvoices,
    });
  } catch (err) {
    console.error('HCP API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
