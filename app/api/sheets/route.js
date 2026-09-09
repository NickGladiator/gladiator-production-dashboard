import { NextResponse } from 'next/server';

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;

async function getSheetData(tabName) {
  try {
    const encodedTab = encodeURIComponent(tabName);
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodedTab}`;
    const res = await fetch(url);
    const text = await res.text();
    const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);/);
    if (!match) {
      // Sheet tab not found, renamed, or Google returned an error page instead of data.
      console.error(`Sheets API: tab "${tabName}" did not return valid gviz JSON. Response started with: ${text.slice(0, 200)}`);
      return [];
    }
    const json = JSON.parse(match[1]);
    return json.table?.rows || [];
  } catch (err) {
    // Don't let one broken tab take down the whole leaderboard.
    console.error(`Sheets API: failed to read tab "${tabName}":`, err.message);
    return [];
  }
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

// Upsells tab uses MM/DD/YYYY text dates (other tabs use DD/MM/YYYY), so it needs its own parser
function parseUpsellDate(dateVal) {
  if (!dateVal) return null;
  if (typeof dateVal === 'string' && dateVal.includes('/')) {
    const parts = dateVal.split('/');
    return new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
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

const SKIP_NAMES = ['tech name', 'technician name', 'technician', 'name', 'lead tech on job', 'technician(s) on job', 'technician on job', 'date of service', 'no one'];

// Management/office staff who show up in tracking sheets but shouldn't be scored
const EXCLUDE_TECHS = ['Kirin Cremasco'];

// Read hourly pay rates from All techs sheet (col A=name, B=slack, C=status, D=pay)
async function getHourlyRates() {
  const rows = await getSheetData('All techs');
  const rates = {};
  for (const row of rows) {
    const name = row.c?.[0]?.v?.trim();
    const pay = parseMoney(row.c?.[3]?.v);
    if (name && pay > 0) rates[name] = pay;
  }
  return rates;
}

// Read the full active tech roster from All techs sheet (col A=name, C=status)
async function getActiveTechRoster() {
  const rows = await getSheetData('All techs');
  const names = [];
  for (const row of rows) {
    const name = row.c?.[0]?.v?.trim();
    const status = row.c?.[2]?.v?.trim();
    if (name && status === 'Active') names.push(name);
  }
  return names;
}

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
    const date = parseUpsellDate(row.c[0].v);
    if (!date || date < startDate || date > endDate) continue;
    const subtotal = parseMoney(row.c[3]?.v);
    counts[tech]  = (counts[tech]  || 0) + 1;
    dollars[tech] = (dollars[tech] || 0) + subtotal;
  }
  return { counts, dollars };
}

const UNTRACKED_SERVICE = 'Untracked service';

// Columns (as of the "Service (what the service was)" addition):
// A=0 Date of Job, B=1 Lead Tech, C=2 Other techs, D=3 Customer, E=4 Date of Callback,
// F=5 Reason For Callback, G=6 Service, H=7 Valid Callback, I=8 Revisit Booked, J=9 Customer Happy
function parseCallbacks(rows, startDate, endDate) {
  const counts = {};
  const byService = {}; // { techName: { serviceName: count } }

  const addService = (tech, service) => {
    if (!byService[tech]) byService[tech] = {};
    byService[tech][service] = (byService[tech][service] || 0) + 1;
  };

  for (const row of rows) {
    if (!row.c || !row.c[0] || !row.c[1]) continue;
    const date = parseSheetDate(row.c[0].v);
    if (!date || date < startDate || date > endDate) continue;
    const valid = row.c[7]?.v?.toString().trim().toLowerCase();
    if (valid !== 'yes') continue;

    const rawService = row.c[6]?.v?.toString().trim();
    const service = rawService ? rawService : UNTRACKED_SERVICE;

    const leadTech = row.c[1].v?.trim();
    if (leadTech && !SKIP_NAMES.includes(leadTech.toLowerCase())) {
      counts[leadTech] = (counts[leadTech] || 0) + 1;
      addService(leadTech, service);
    }
    const otherTechs = row.c[2]?.v?.toString().trim();
    if (otherTechs) {
      otherTechs.split(',').forEach(t => {
        const name = t.trim();
        if (name && !SKIP_NAMES.includes(name.toLowerCase())) {
          counts[name] = (counts[name] || 0) + 1;
          addService(name, service);
        }
      });
    }
  }
  return { counts, byService };
}

function parseTips(rows, startDate, endDate) {
  const totals = {};
  for (const row of rows) {
    if (!row.c || !row.c[0] || !row.c[1]) continue;
    const tech = row.c[1].v?.trim();
    if (!tech || SKIP_NAMES.includes(tech.toLowerCase())) continue;
    const date = parseSheetDate(row.c[0].v);
    if (!date || date < startDate || date > endDate) continue;
    const amount = parseMoney(row.c[4]?.v);
    totals[tech] = (totals[tech] || 0) + amount;
  }
  return totals;
}

function parseReviews(rows, startDate, endDate) {
  const counts = {};
  for (const row of rows) {
    if (!row.c || !row.c[0]) continue;
    const date = parseSheetDate(row.c[0].v);
    if (!date || isNaN(date) || date < startDate || date > endDate) continue;
    [row.c[1]?.v, row.c[2]?.v].forEach(val => {
      const name = val?.toString().trim();
      if (name && !SKIP_NAMES.includes(name.toLowerCase())) {
        counts[name] = (counts[name] || 0) + 1;
      }
    });
  }
  return counts;
}

function parseP4P(rows, startDate, endDate, hourlyRates) {
  // Group hours by tech AND week period to calculate overtime per week
  const stats = {};
  const weeklyHours = {}; // { "Name||weekPeriod": hours }

  for (const row of rows) {
    if (!row.c || !row.c[0]) continue;
    const firstName = row.c[0]?.v?.trim();
    const lastName  = row.c[1]?.v?.trim();
    if (!firstName || !lastName || firstName === 'First Name') continue;
    const dateStr = row.c[2]?.f || row.c[2]?.v;
    const date = dateStr ? new Date(dateStr) : null;
    if (!date || isNaN(date) || date < startDate || date > endDate) continue;

    const name = `${firstName} ${lastName}`;
    const weekPeriod = row.c[3]?.v?.trim() || 'unknown';
    const weekKey = `${name}||${weekPeriod}`;

    if (!stats[name]) stats[name] = { totalHours: 0, totalPay: 0, bonus: 0 };
    if (!weeklyHours[weekKey]) weeklyHours[weekKey] = 0;

    const shiftHours  = parseShiftLength(String(row.c[9]?.v || ''));
    const breakHours  = parseShiftLength(String(row.c[10]?.v || ''));
    const netHours    = shiftHours - breakHours;
    const basePay     = parseMoney(row.c[6]?.v);
    const crewP4P     = parseMoney(row.c[7]?.v);
    const perfDollars = parseMoney(row.c[8]?.v);

    stats[name].totalHours += netHours;
    stats[name].totalPay   += Math.max(basePay, crewP4P);
    stats[name].bonus      += perfDollars;
    weeklyHours[weekKey]   += netHours;
  }

  // Calculate overtime deduction per tech
  const overtimeDeductions = {};
  for (const [weekKey, hours] of Object.entries(weeklyHours)) {
    const name = weekKey.split('||')[0];
    const overtimeHours = Math.max(0, hours - 44);
    if (overtimeHours > 0) {
      const hourlyRate = hourlyRates[name] ?? 0;
      const overtimePremium = overtimeHours * (hourlyRate * 0.5);
      overtimeDeductions[name] = (overtimeDeductions[name] || 0) + overtimePremium;
    }
  }

  const result = {};
  for (const [name, s] of Object.entries(stats)) {
    const deduction = overtimeDeductions[name] || 0;
    const adjustedBonus = Math.max(0, s.bonus - deduction);
    result[name] = {
      hoursWorked:       s.totalHours,
      chargeRate:        s.totalHours > 0 ? Math.round(s.totalPay / s.totalHours) : 0,
      bonus:             adjustedBonus,
      overtimeDeduction: deduction,
    };
  }
  return result;
}

function buildRosterLookup(roster) {
  const map = new Map();
  roster.forEach(name => map.set(name.toLowerCase().trim(), name));
  return map;
}

// Canonicalizes a {name: value} map's keys against the roster (case/whitespace-insensitive only —
// this does not fix misspellings or nicknames, just casing/trim differences). Values are merged:
// numbers are summed, nested objects (e.g. per-service callback counts) are summed leaf-by-leaf.
function canonicalizeMap(map, rosterLookup) {
  const result = {};
  for (const [key, value] of Object.entries(map)) {
    const canon = rosterLookup.get(key.toLowerCase().trim()) ?? key;
    if (typeof value === 'object' && value !== null) {
      result[canon] = result[canon] || {};
      for (const [k2, v2] of Object.entries(value)) {
        result[canon][k2] = (result[canon][k2] || 0) + v2;
      }
    } else {
      result[canon] = (result[canon] || 0) + (value || 0);
    }
  }
  return result;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = new Date(searchParams.get('startDate'));
    const endDate   = new Date(searchParams.get('endDate'));
    endDate.setHours(23, 59, 59, 999);

    const [sickRows, yardRows, upsellRows, callbackRows, p4pRows, tipRows, reviewRows, hourlyRates, activeRoster] = await Promise.all([
      getSheetData('Sick Days'),
      getSheetData('Yard Signs'),
      getSheetData('Upsells'),
      getSheetData('Callbacks'),
      getSheetData('P4P'),
      getSheetData('Customer Tips'),
      getSheetData('Customer Reviews'),
      getHourlyRates(),
      getActiveTechRoster(),
    ]);

    const sickDaysRaw  = countByTech(sickRows,  startDate, endDate);
    const yardSignsRaw = countByTech(yardRows,  startDate, endDate);
    const upsellsRaw   = parseUpsells(upsellRows, startDate, endDate);
    const callbacksParsedRaw = parseCallbacks(callbackRows, startDate, endDate);
    const p4pRaw       = parseP4P(p4pRows, startDate, endDate, hourlyRates);
    const tipsRaw      = parseTips(tipRows, startDate, endDate);
    const reviewsRaw   = parseReviews(reviewRows, startDate, endDate);

    // Fold any casing/whitespace variants of a roster name (e.g. "cameron hof" vs "Cameron Hof")
    // into the roster's canonical spelling. This does NOT fix real misspellings or nicknames
    // (e.g. "Matt Nova" vs roster's "Matthew Nova", or "Dylan Whijte") — those need a sheet fix,
    // and until then that row's data won't count toward anyone.
    const rosterLookup = buildRosterLookup(activeRoster);
    const sickDays  = canonicalizeMap(sickDaysRaw,  rosterLookup);
    const yardSigns = canonicalizeMap(yardSignsRaw, rosterLookup);
    const upsellCounts  = canonicalizeMap(upsellsRaw.counts,  rosterLookup);
    const upsellDollars = canonicalizeMap(upsellsRaw.dollars, rosterLookup);
    const upsells = { counts: upsellCounts, dollars: upsellDollars };
    const callbacks = canonicalizeMap(callbacksParsedRaw.counts, rosterLookup);
    const callbacksByService = canonicalizeMap(callbacksParsedRaw.byService, rosterLookup);
    const p4p  = canonicalizeMap(p4pRaw, rosterLookup);
    const tips = canonicalizeMap(tipsRaw, rosterLookup);
    const reviews = canonicalizeMap(reviewsRaw, rosterLookup);

    // Only ever show techs from the "All techs" roster (status = Active). Any name that shows up
    // in a metric tab but isn't an exact (or casing-only) match to the roster — a typo, or a
    // customer's name typed into the wrong column — is dropped here rather than shown as a
    // phantom "tech". Make sure every currently active tech is actually listed in "All techs"
    // before relying on this, or they'll disappear from the whole leaderboard.
    const allTechs = activeRoster;

    const hcpTechs = searchParams.get('techs') ? JSON.parse(searchParams.get('techs')) : null;
    const result = allTechs
      .filter(tech => !hcpTechs || hcpTechs.includes(tech))
      .filter(tech => !EXCLUDE_TECHS.includes(tech))
      .map(tech => ({
        tech,
        sickDays:          sickDays[tech]              || 0,
        yardSigns:         yardSigns[tech]             || 0,
        upsellCount:       upsells.counts[tech]        || 0,
        upsellDollars:     upsells.dollars[tech]       || 0,
        callbacks:         callbacks[tech]             || 0,
        callbacksByService: callbacksByService[tech]   || {},
        hoursWorked:       p4p[tech]?.hoursWorked      ?? 0,
        chargeRate:        p4p[tech]?.chargeRate       ?? 0,
        bonus:             p4p[tech]?.bonus            ?? 0,
        overtimeDeduction: p4p[tech]?.overtimeDeduction ?? 0,
        tips:              tips[tech]                  || 0,
        reviews:           reviews[tech]               || 0,
      }));

    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('Sheets API error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
