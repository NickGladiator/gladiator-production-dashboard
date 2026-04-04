export const CATEGORIES = [
  { key: "sickDays",      label: "Sick Days",          icon: "🤒", higherIsBetter: false, source: "sheets" },
  { key: "yardSigns",     label: "Yard Signs Put Out",  icon: "🪧", higherIsBetter: true,  source: "slack"  },
  { key: "reviews",       label: "Customer Reviews",    icon: "⭐", higherIsBetter: true,  source: "hcp"    },
  { key: "tips",          label: "Customer Tips ($)",   icon: "💰", higherIsBetter: true,  source: "hcp"    },
  { key: "callbackRate",  label: "Callback Rate (%)",   icon: "📞", higherIsBetter: false, source: "sheets" },
  { key: "upsellDollars", label: "Upsells ($)",         icon: "📈", higherIsBetter: true,  source: "sheets" },
  { key: "chargeRate",    label: "Pay Per Hour (P4P)",  icon: "⚡", higherIsBetter: true,  source: "sheets" },
];

export function mergeData(hcpTechs, sheetsData, slackData) {
  // Build sheets map with fuzzy name matching
  const sheetsMap = {};
  if (Array.isArray(sheetsData)) {
    sheetsData.forEach(row => {
      if (row.tech) sheetsMap[row.tech.toLowerCase().trim()] = row;
    });
  }

  function findSheets(name) {
    const key = name.toLowerCase().trim();
    if (sheetsMap[key]) return sheetsMap[key];
    // fuzzy: match on first+last with any middle variation
    for (const [k, v] of Object.entries(sheetsMap)) {
      const kParts = k.split(' '), nParts = key.split(' ');
      if (kParts[0] === nParts[0] && kParts[kParts.length-1] === nParts[nParts.length-1]) return v;
    }
    return {};
  }

  return hcpTechs.map(tech => {
    const name = tech.tech;
    const sheets = findSheets(name);
    const callbacks = sheets.callbacks ?? 0;
    const jobsCompleted = tech.jobsCompleted ?? 0;
    const callbackRate = jobsCompleted > 0 ? Math.round((callbacks / jobsCompleted) * 100) : null;

    // Yard signs: prefer slack, fall back to sheets
    const slackSigns = slackData?.[name] ?? slackData?.[name.toLowerCase()] ?? null;
    const sheetSigns = sheets.yardSigns ?? 0;
    const yardSigns = slackSigns !== null ? slackSigns : sheetSigns;

    // Tips: HCP returns dollars already (not cents)
    const tips = tech.tips ?? 0;

    return {
      name,
      totalBilled: tech.revenue ?? 0,
      sickDays: sheets.sickDays ?? 0,
      yardSigns,
      reviews: tech.reviews ?? 0,
      tips,
      callbackRate,
      jobsCompleted,
      callbacks,
      upsellDollars: sheets.upsellDollars ?? 0,
      chargeRate: sheets.chargeRate > 0 ? sheets.chargeRate : (tech.chargeRate ?? 0),
      p4pBonus: sheets.bonus ?? 0,
      hoursWorked: sheets.hoursWorked > 0 ? sheets.hoursWorked : (tech.hoursWorked ?? 0),
    };
  });
}

export function hasData(techs, key) {
  return techs.some(t => t[key] !== null && t[key] !== 0 && t[key] !== undefined);
}

export function getRankings(techs, key, higherIsBetter) {
  // For callback rate: null means no jobs — exclude from ranking
  const eligible = key === 'callbackRate'
    ? techs.filter(t => t.jobsCompleted > 0)
    : techs;
  const ineligible = key === 'callbackRate'
    ? techs.filter(t => t.jobsCompleted === 0)
    : [];

  const sorted = [...eligible].sort((a, b) =>
    higherIsBetter ? b[key] - a[key] : a[key] - b[key]
  );

  let rank = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0 || sorted[i][key] !== sorted[i-1][key]) rank = i;
    sorted[i]._rank = rank;
  }

  // Append ineligible techs at the bottom with no rank
  ineligible.forEach(t => { t._rank = sorted.length; });

  return [...sorted, ...ineligible];
}

export function isActive(tech) {
  return tech.jobsCompleted > 0 || tech.hoursWorked > 0;
}

export function computeOverall(techs) {
  const active = techs.filter(isActive);
  const inactive = techs.filter(t => !isActive(t));
  const scores = Object.fromEntries(active.map(t => [t.name, 0]));

  CATEGORIES.forEach(cat => {
    const ranked = getRankings(active, cat.key, cat.higherIsBetter);
    const eligible = ranked.filter(t => t[cat.key] !== null && t[cat.key] !== undefined);
    eligible.forEach((t, i) => { scores[t.name] += active.length - i; });
  });

  return [
    ...Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .map(([name, pts]) => ({ name, pts, active: true })),
    ...inactive.map(t => ({ name: t.name, pts: null, active: false })),
  ];
}

export function computeBonus(techs) {
  return [...techs]
    .map(t => ({ name: t.name, totalBilled: t.totalBilled ?? 0, payout: t.p4pBonus ?? 0, pct: 0 }))
    .sort((a, b) => b.payout - a.payout);
}
