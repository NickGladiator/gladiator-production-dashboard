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

    // A few recently-completed jobs — real job_id, work_status, and schedule field names
    const jobsRes = await fetch(
      `${BASE}/jobs?page=1&page_size=5&work_status%5B%5D=complete+rated&work_status%5B%5D=complete+unrated`,
      { headers }
    );
    const jobsBody = await jobsRes.text();
    let jobsData;
    try { jobsData = JSON.parse(jobsBody); } catch { jobsData = { raw: jobsBody }; }
    if (!jobsRes.ok) jobsData = { error: `jobs request failed (${jobsRes.status})`, body: jobsBody };

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
      note: 'Temporary diagnostic output — compare a job\'s "id" field below to an invoice\'s "job_id" field to match them up.',
      sampleJobs: jobsData.jobs ?? jobsData,
      sampleInvoices: invoicesData.invoices ?? invoicesData,
    }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
