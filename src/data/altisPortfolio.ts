export interface SubsidiaryCompany {
  id: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  color: string;
  dataQuality: "complete" | "revenue-only" | "partial";
  dataNote: string;
  revenue: Record<string, number>; // "jan-23" -> euros
  costs: Record<string, number>;
  annualEstimates: Record<string, number>; // "2025" -> annual total
}

export function getAnnualRevenue(company: SubsidiaryCompany, year: string): number {
  if (company.annualEstimates[year]) return company.annualEstimates[year];
  const yy = year.slice(-2);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  return months.reduce((sum, m) => sum + (company.revenue[`${m}-${yy}`] ?? 0), 0);
}

export function getMonthlyRevenue(
  company: SubsidiaryCompany,
  year: string
): Array<{ key: string; label: string; revenueK: number }> {
  const yy = year.slice(-2);
  const months = [
    { m: "jan", l: "Jan" }, { m: "feb", l: "Feb" }, { m: "mar", l: "Mar" },
    { m: "apr", l: "Apr" }, { m: "may", l: "May" }, { m: "jun", l: "Jun" },
    { m: "jul", l: "Jul" }, { m: "aug", l: "Aug" }, { m: "sep", l: "Sep" },
    { m: "oct", l: "Oct" }, { m: "nov", l: "Nov" }, { m: "dec", l: "Dec" },
  ];
  return months.map(({ m, l }) => ({
    key: `${m}-${yy}`,
    label: l,
    revenueK: Math.round((company.revenue[`${m}-${yy}`] ?? 0) / 1000),
  }));
}

export const ALTIS_COMPANIES: SubsidiaryCompany[] = [
  {
    id: "winschoten",
    name: "Daken van Winschoten",
    city: "Winschoten",
    lat: 53.1427,
    lng: 7.041,
    color: "#2563eb",
    dataQuality: "complete",
    dataNote: "Full P&L available — ERP export Jan 2023–May 2025",
    revenue: {
      "jan-23": 892000,  "feb-23": 743000,  "mar-23": 1210000, "apr-23": 1380000,
      "may-23": 1520000, "jun-23": 1670000, "jul-23": 1590000, "aug-23": 1450000,
      "sep-23": 1320000, "oct-23": 1180000, "nov-23": 980000,  "dec-23": 820000,
      "jan-24": 940000,  "feb-24": 810000,  "mar-24": 1260000, "apr-24": 1420000,
      "may-24": 1580000, "jun-24": 1730000, "jul-24": 1650000, "aug-24": 1510000,
      "sep-24": 1390000, "oct-24": 1240000, "nov-24": 1020000, "dec-24": 870000,
      "jan-25": 980000,  "feb-25": 850000,  "mar-25": 1310000, "apr-25": 1490000,
      "may-25": 1640000,
    },
    costs: {
      "jan-23": 720000,  "feb-23": 598000,  "mar-23": 970000,  "apr-23": 1100000,
      "may-23": 1215000, "jun-23": 1335000, "jul-23": 1270000, "aug-23": 1160000,
      "sep-23": 1055000, "oct-23": 944000,  "nov-23": 784000,  "dec-23": 655000,
      "jan-24": 752000,  "feb-24": 648000,  "mar-24": 1008000, "apr-24": 1136000,
      "may-24": 1264000, "jun-24": 1384000, "jul-24": 1320000, "aug-24": 1208000,
      "sep-24": 1112000, "oct-24": 992000,  "nov-24": 816000,  "dec-24": 696000,
      "jan-25": 784000,  "feb-25": 680000,  "mar-25": 1048000, "apr-25": 1192000,
      "may-25": 1312000,
    },
    annualEstimates: { "2023": 14755000, "2024": 15420000, "2025": 16200000 },
  },
  {
    id: "andijk",
    name: "Dakbedekking Andijk",
    city: "Andijk",
    lat: 52.7464,
    lng: 5.235,
    color: "#16a34a",
    dataQuality: "revenue-only",
    dataNote: "Revenue data only — costs pending controller sign-off",
    revenue: {
      "jan-23": 542000,  "feb-23": 481000,  "mar-23": 743000,  "apr-23": 820000,
      "may-23": 910000,  "jun-23": 980000,  "jul-23": 945000,  "aug-23": 870000,
      "sep-23": 795000,  "oct-23": 720000,  "nov-23": 610000,  "dec-23": 490000,
      "jan-24": 570000,  "feb-24": 505000,  "mar-24": 779000,  "apr-24": 861000,
      "may-24": 954000,  "jun-24": 1028000, "jul-24": 991000,  "aug-24": 913000,
      "sep-24": 834000,  "oct-24": 755000,  "nov-24": 640000,  "dec-24": 514000,
      "jan-25": 598000,  "feb-25": 530000,  "mar-25": 818000,  "apr-25": 903000,
      "may-25": 999000,
    },
    costs: {},
    annualEstimates: { "2023": 8906000, "2024": 9344000, "2025": 9800000 },
  },
  {
    id: "brunssum",
    name: "Peter Ummels Dakbedekkingen",
    city: "Brunssum",
    lat: 50.9461,
    lng: 5.9726,
    color: "#d97706",
    dataQuality: "revenue-only",
    dataNote: "Annual estimate only — monthly split not yet available",
    revenue: {},
    costs: {},
    annualEstimates: { "2025": 13142297 },
  },
  {
    id: "heeze",
    name: "Roofing Heeze",
    city: "Heeze",
    lat: 51.3809,
    lng: 5.5762,
    color: "#9333ea",
    dataQuality: "partial",
    dataNote: "GL account 8001 only — full chart of accounts pending",
    revenue: {
      "jan-23": 318000,  "feb-23": 275000,  "mar-23": 445000,  "apr-23": 498000,
      "may-23": 552000,  "jun-23": 601000,  "jul-23": 578000,  "aug-23": 530000,
      "sep-23": 483000,  "oct-23": 430000,  "nov-23": 362000,  "dec-23": 290000,
      "jan-24": 334000,  "feb-24": 289000,  "mar-24": 467000,  "apr-24": 523000,
      "may-24": 579000,  "jun-24": 631000,  "jul-24": 607000,  "aug-24": 557000,
      "sep-24": 507000,  "oct-24": 451000,  "nov-24": 380000,  "dec-24": 305000,
      "jan-25": 350000,  "feb-25": 303000,  "mar-25": 490000,  "apr-25": 549000,
      "may-25": 608000,
    },
    costs: {},
    annualEstimates: { "2023": 5362000, "2024": 5630000, "2025": 5900000 },
  },
];
