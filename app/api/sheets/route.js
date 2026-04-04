import { NextResponse } from 'next/server';

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;

async function getSheetData(tabName) {
  const encodedTab = encodeURIComponent(tabName);
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodedTab}`;
  const res = await fetch(url);
  const text = await res.text();
  const json = JSON.parse(text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);/)[1]);
  return json.table.rows;
}

function parseSheetDate(dateVal) {
  if (!dateVal) return null;
  if (typeof dateVal === 'string' && dateVal.includes('/')) {
    const parts = dateVal.split('/');
    return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
  }
  if (typeof dateVal === 'string' && dateVal.startsWith('Date(')) {
    const parts = dateVal.replace('Date(', '').replace(')', '').split(',');
    return new Date(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]));
  }
  return new Date(dateVal);
}

function parseShiftLength(shiftStr) {
  if (!shiftStr) return 0;
  const hourMatch = shiftStr.match(/(\d+)\s*hour/);
  const minMatch  = shiftStr.match(/(\d+)\s*min/);
  return (hourMatch ? parseInt(hourMatch[1]) : 0) + (minMatch ? parseInt(minMatch[1]) : 0) / 60;
}

function parseMoney(val) {
  if (!val) return 0;
  return parseFloat(String(val).replace(/[$,]/g, '')) || 0;
}

const SKIP_NAMES = ['tech name', 'technician name', 'technician', 'name', 'lead tech on job', 'technician(s) on job', 'date of service'];

function countByTech(rows, startDate, endDate) {
  const counts = {};
  for (const row of rows) {
    if (!row.c || !row.c[0] || !row.c[1]) continue;
    const tech = row.c[1].v?.trim();
    if (!tech || SKIP_NAMES.includes(tech.toLowerCase())) continue;
    const date = parseSheetDate(row.c[0].v);
    if (!date || date < startDate || date > endDate) continue;
    counts[tech] = (counts[tech] || 0) + 1;
  }
  return counts;
}

function parseUpsells(rows, startDate, endDate) {
  const counts = {}, dollars = {};
  for (const row of rows) {
    if (!row.c || !row.c[0] || !row.c[1]) continue;
    const tech = row.c[1].v?.trim();
    if (!tech || SKIP_NAMES.includes(tech.toLowerCase())) continue;
    const date = parseSheetDate(row.c[0].v);
    if (!date || date < startDate || date > endDate) continue;
    const subtotal = parseMoney(row.c[3]?.v);
    counts[tech]  = (counts[tech]  || 0) + 1;
    dollars[tech] = (dollars[tech] || 0) + subtotal;
  }
  return { counts, dollars };
}

function parseCallbacks(rows, startDate, endDate) {
  const counts = {};
  for (const row of rows) {
    if (!row.c || !row.c[0] || !row.c[1]) continue;
    const date = parseSheetDate(row.c[0].v);
    if (!date || date < startDate || date > endDate) continue;
    const valid = row.c[6]?.v?.toString().trim().toLowerCase();
    if (valid !== 'yes') continue;
    const leadTech = row.c[1].v?.trim();
    if (leadTech && !SKIP_NAMES.includes(leadTech.toLowerCase())) {
      counts[leadTech] = (counts[leadTech] || 0) + 1;
    }
    const otherTechs = row.c[2]?.v?.toString().trim();
    if (otherTechs) {
      otherTechs.split(',').forEach(t => {
        const name = t.trim();
        if (name && !SKIP_NAMES.includes(name.toLowerCase())) {
          counts[name] = (counts[name] || 0) + 1;
        }
      });
    }
  }
  return counts;
}

function parseTips(rows, startDate, endDate) {
  // A=Date, B=Tech Name, C=Customer, D=Total Tip, E=Amount to Technician
  const totals = {};
  for (const row of rows) {
    if (!row.c || !row.c[0] || !row.c[1]) continue;
    const tech = row.c[1].v?.trim();
    if (!tech || SKIP_NAMES.includes(tech.toLowerCase())) continue;
    const date = parseSheetDate(row.c[0].v);
    if (!date || date < startDate || date > endDate) continue;
    const amount = parseMoney(row.c[4]?.v ?? row.c[3]?.v);
    totals[tech] = (totals[tech] || 0) + amount;
  }
  return totals;
}

function parseP4P(rows, startDate, endDate) {
  const stats = {};
  for (const row of rows) {
    if (!row.c || !row.c[0]) continue;
    const firstName = row.c[0]?.v?.trim();
    const lastName  = row.c[1]?.v?.trim();
    if (!firstName || !lastName || firstName === 'First Name') continue;
    const dateStr = row.c[2]?.f || row.c[2]?.v;
    const date = dateStr ? new Date(dateStr) : null;
    if (!date || isNaN(date) || date < startDate || date > endDate) continue;
    const name = `${firstName} ${lastName}`;
    if (!stats[name]) stats[name] = { totalHours: 0, totalPay: 0, bonus: 0 };
    const shiftHours  = parseShiftLength(String(row.c[9]?.v || ''));
    const basePay     = parseMoney(row.c[6]?.v);
    const crewP4P     = parseMoney(row.c[7]?.v);
    const perfDollars = parseMoney(row.c[8]?.v);
    stats[name].totalHours += shiftHours;
    stats[name].totalPay   += Math.max(basePay, crewP4P);
    stats[name].bonus      += perfDollars;
  }
  const result = {};
  for (const [name, s] of Object.entries(stats)) {
    result[name] = {
      hoursWorked: s.totalHours,
      chargeRate:  s.totalHours > 0 ? Math.round(s.totalPay / s.totalHours) : 0,
      bonus:       s.bonus,
    };
  }
  return result;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = new Date(searchParams.get('startDate'));
    const endDate   = new Date(searchParams.get('endDate'));
    endDate.setHours(23, 59, 59, 999);

    const [sickRows, yardRows, upsellRows, callbackRows, p4pRows, tipRows] = await Promise.all([
      getSheetData('Sick Days'),
      getSheetData('Yard Signs'),
      getSheetData('Upsells'),
      getSheetData('Callbacks'),
      getSheetData('P4P'),
      getSheetData('Customer Tips'),
    ]);

    const sickDays  = countByTech(sickRows,  startDate, endDate);
    const yardSigns = countByTech(yardRows,  startDate, endDate);
    const upsells   = parseUpsells(upsellRows, startDate, endDate);
    const callbacks = parseCallbacks(callbackRows, startDate, endDate);
    const p4p       = parseP4P(p4pRows, startDate, endDate);
    const tips      = parseTips(tipRows, startDate, endDate);

    const allTechs = [...new Set([
      ...Object.keys(sickDays),
      ...Object.keys(yardSigns),
      ...Object.keys(upsells.counts),
      ...Object.keys(callbacks),
      ...Object.keys(p4p),
      ...Object.keys(tips),
    ])];

    const hcpTechs = searchParams.get('techs') ? JSON.parse(searchParams.get('techs')) : null;
    const result = allTechs
      .filter(tech => !hcpTechs || hcpTechs.includes(tech))
      .map(tech => ({
        tech,
        sickDays:      sickDays[tech]         || 0,
        yardSigns:     yardSigns[tech]        || 0,
        upsellCount:   upsells.counts[tech]   || 0,
        upsellDollars: upsells.dollars[tech]  || 0,
        callbacks:     callbacks[tech]        || 0,
        hoursWorked:   p4p[tech]?.hoursWorked ?? 0,
        chargeRate:    p4p[tech]?.chargeRate  ?? 0,
        bonus:         p4p[tech]?.bonus       ?? 0,
        tips:          tips[tech]             || 0,
      }));

    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('Sheets API error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
