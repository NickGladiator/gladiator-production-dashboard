import { NextResponse } from 'next/server';

const HCP_API_KEY = process.env.HCP_API_KEY;
const BASE = 'https://api.housecallpro.com';
const headers = { Authorization: `Token ${HCP_API_KEY}`, 'Content-Type': 'application/json' };

// TEMPORARY diagnostic route — not linked from the leaderboard UI, hit it directly in a browser.
// Purpose: see the real shape of Housecall Pro's job + invoice data (exact field names, what a
// "sent" invoice actually looks like, timestamps available) so the same-day-invoice bonus check
// can be built against confirmed fields instead of guesses. Safe to delete once that's done —
// it doesn't touch the leaderboard's own data or logic.
//
// Usage:
//   /api/hcp-debug                → a handful of recently-completed jobs + a handful of recent invoices
//   /api/hcp-debug?jobId=<job_id> → invoices for one specific job (copy a job_id from the first call)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    // A bigger, unfiltered page so we can find real completed jobs client-side (the work_status
    // array-filter syntax kept rejecting requests, not worth more guessing) — specifically to
    // check whether work_timestamps.completed_at actually gets populated in this account.
    const jobsRes = await fetch(`${BASE}/jobs?page=1&page_size=100`, { headers });
    const jobsBody = await jobsRes.text();
    let jobsData;
    try { jobsData = JSON.parse(jobsBody); } catch { jobsData = { raw: jobsBody }; }
    if (!jobsRes.ok) jobsData = { error: `jobs request failed (${jobsRes.status})`, body: jobsBody };
    const allJobs = jobsData.jobs ?? (Array.isArray(jobsData) ? jobsData : []);
    const completedJobs = allJobs.filter(j => j.work_status === 'complete rated' || j.work_status === 'complete unrated').slice(0, 5);

    // Recent estimates — for the sales-shoutout project: need to see if there's a clear
    // "created by" / "sold by" rep field, and how line items break out by service.
    const estimatesRes = await fetch(`${BASE}/estimates?page=1&page_size=5`, { headers });
    const estimatesBody = await estimatesRes.text();
    let estimatesData;
    try { estimatesData = JSON.parse(estimatesBody); } catch { estimatesData = { raw: estimatesBody }; }
    if (!estimatesRes.ok) estimatesData = { error: `estimates request failed (${estimatesRes.status})`, body: estimatesBody };

    // Invoices — filtered to one job if a jobId is given, otherwise just the most recent few
    const invoiceEndpoint = jobId
      ? `${BASE}/invoices?job_id=${jobId}&page=1&page_size=10`
      : `${BASE}/invoices?page=1&page_size=5`;
    const invoicesRes = await fetch(invoiceEndpoint, { headers });
    const invoicesBody = await invoicesRes.text();
    let invoicesData;
    try { invoicesData = JSON.parse(invoicesBody); } catch { invoicesData = { raw: invoicesBody }; }
    if (!invoicesRes.ok) invoicesData = { error: `invoices request failed (${invoicesRes.status})`, body: invoicesBody, endpointTried: invoiceEndpoint };

    return NextResponse.json({
      note: 'sampleCompletedJobs is what actually matters right now — check whether work_timestamps.completed_at is populated on real completed jobs.',
      sampleCompletedJobs: completedJobs,
      totalJobsFetched: allJobs.length,
      sampleInvoices: invoicesData.invoices ?? invoicesData,
      sampleEstimates: estimatesData.estimates ?? estimatesData,
    }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
