import { NextResponse } from 'next/server';

const HCP_API_KEY = process.env.HCP_API_KEY;
const BASE = 'https://api.housecallpro.com';
const headers = { Authorization: `Token ${HCP_API_KEY}`, 'Content-Type': 'application/json' };

// TEMPORARY DEBUG ROUTE — returns raw job objects so we can see actual field names.
// Delete this file once the real fields are confirmed.
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

    const res = await fetch(
      `${BASE}/jobs?scheduled_start_min=${startISO}&scheduled_start_max=${endISO}&page=1&page_size=3`,
      { headers }
    );
    if (!res.ok) throw new Error(`HCP error: ${res.status}`);
    const data = await res.json();
    const jobs = data.jobs || [];

    // Only return jobs that have an assigned employee, so we see a realistic example
    const sample = jobs.filter(j => (j.assigned_employees || []).length > 0).slice(0, 2);

    return NextResponse.json({ success: true, sampleCount: sample.length, totalJobsInPage: jobs.length, sample });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
