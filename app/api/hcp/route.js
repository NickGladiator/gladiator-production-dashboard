import { NextResponse } from 'next/server';

const HCP_API_KEY = process.env.HCP_API_KEY;
const BASE = 'https://api.housecallpro.com';
const headers = { Authorization: `Token ${HCP_API_KEY}`, 'Content-Type': 'application/json' };

async function fetchAllPages(endpoint) {
  let results = [], page = 1;
  while (true) {
    const res = await fetch(`${BASE}${endpoint}&page=${page}&page_size=100`, { headers });
    if (!res.ok) throw new Error(`HCP error: ${res.status} ${endpoint}`);
    const data = await res.json();
    const items = data.jobs || data.employees || [];
    results = results.concat(items);
    if (items.length < 100) break;
    page++;
  }
  return results;
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
    const techs     = employees.filter(e =>
      e.role === 'field tech' &&
      !exclude.includes(`${e.first_name} ${e.last_name}`.trim())
    );

    // Fetch all jobs in date range
    const jobs = await fetchAllPages(
      `/jobs?scheduled_start_min=${startISO}&scheduled_start_max=${endISO}`
    );

    // Build per-tech stats
    const stats = {};
    for (const tech of techs) {
      const name = `${tech.first_name} ${tech.last_name}`.trim();
      stats[name] = {
        tech:          name,
        jobsCompleted: 0,
        revenue:       0,
        tips:          0,
        reviews:       0,
        hoursWorked:   0,
        chargeRate:    0,
      };
    }

    for (const job of jobs) {
      const assigned = job.assigned_employees || [];
      if (!assigned.length) continue;

      const n        = assigned.length;
      const isPaid   = (job.total_amount || 0) > 0;
      const hasReview = (job.tags || []).some(
        t => typeof t === 'string' && t.toLowerCase() === '5 star google review'
      );

      for (const emp of assigned) {
        const name = `${emp.first_name} ${emp.last_name}`.trim();
        if (!stats[name]) continue;

        // Only count paid jobs toward completed jobs and revenue
        if (isPaid) {
          stats[name].jobsCompleted += 1;
          stats[name].revenue       += job.total_amount / n;
          stats[name].tips          += (job.tip_amount || 0) / n;
        }

        // Hours from scheduled times
        const sched = job.schedule || {};
        if (sched.scheduled_start && sched.scheduled_end) {
          const hrs = (new Date(sched.scheduled_end) - new Date(sched.scheduled_start)) / 3600000;
          stats[name].hoursWorked += hrs / n;
        }

        if (hasReview) stats[name].reviews += 1;
      }
    }

    // chargeRate from HCP scheduled hours (P4P hours preferred in frontend)
    for (const name of Object.keys(stats)) {
      const s = stats[name];
      s.chargeRate = s.hoursWorked > 0 ? Math.round(s.revenue / s.hoursWorked) : 0;
    }

    return NextResponse.json({ success: true, data: Object.values(stats) });
  } catch (err) {
    console.error('HCP API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
