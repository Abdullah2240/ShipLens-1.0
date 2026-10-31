// Deterministic, clearly fictional demo dataset for the seed and the reconciliation test.
// Usage: node scripts/demo-data/generate.mjs [--check] [--out-dir <dir>]
// Writes db/seed/data/*.json (2-space JSON, trailing newline). --check regenerates in memory
// and exits 1 when any committed file differs. Money is BigInt minor units throughout;
// dates are YYYY-MM-DD strings and instants ISO UTC strings, built with UTC arithmetic only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng } from './prng.mjs';

export const DEMO_SEED = 20261031;
export const DATA_AS_OF = '2026-10-31';

const DAY_MS = 86400000;
const MINUTE_MS = 60000;
// PKT is UTC+5 all year.
const PKT_OFFSET_MS = 5 * 60 * MINUTE_MS;

function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS,
  );
}

// An instant at a given UTC minute-of-day on a date.
function at(date, utcMinuteOfDay) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + utcMinuteOfDay * MINUTE_MS).toISOString();
}

function plusMinutes(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * MINUTE_MS).toISOString();
}

function utcDate(iso) {
  return iso.slice(0, 10);
}

export const DEMO_WEEKS = Object.freeze(
  Array.from({ length: 12 }, (_, i) => addDays('2026-08-10', i * 7)),
);

// First instant after DATA_AS_OF in PKT: nothing in the dataset happens at or after it.
const AS_OF_END = new Date(
  Date.parse(`${addDays(DATA_AS_OF, 1)}T00:00:00.000Z`) - PKT_OFFSET_MS,
).toISOString();

export const DATA_FILES = Object.freeze([
  'branches.json',
  'users.json',
  'teams.json',
  'members.json',
  'applications.json',
  'reports.json',
  'collections.json',
]);

const BRANCHES = [
  {
    key: 'sample',
    name: 'Sample Branch (Demo)',
    city: 'Karachi',
    summary: 'Demo branch used for the sample logins. Weekly ration and school-fee drives.',
    status: 'active',
    adopt: true,
  },
  {
    key: 'lahore',
    name: 'Lahore Central (Demo)',
    city: 'Lahore',
    summary: 'Demo branch running medical camps and a winter clothing drive.',
    status: 'active',
  },
  {
    key: 'islamabad',
    name: 'Islamabad North (Demo)',
    city: 'Islamabad',
    summary: 'Demo branch supporting school fees and flood relief collections.',
    status: 'active',
  },
  {
    key: 'peshawar',
    name: 'Peshawar (Demo)',
    city: 'Peshawar',
    summary: 'Demo branch paused in October while volunteers regroup.',
    status: 'paused',
  },
  {
    key: 'multan',
    name: 'Multan (Demo)',
    city: 'Multan',
    summary: 'Demo branch still forming; recruiting its first volunteers.',
    status: 'forming',
  },
  {
    key: 'quetta',
    name: 'Quetta (Demo)',
    city: 'Quetta',
    summary: 'Demo branch closed in September after its relief project ended.',
    status: 'closed',
  },
];

// The five demo users are created by seed step 01 and only referenced here.
const EXISTING_USERS = [
  {
    key: 'admin',
    email: 'admin@shiplens.test',
    name: 'Amina Khan',
    role: 'super_admin',
    branchKey: null,
  },
  {
    key: 'finance',
    email: 'finance@shiplens.test',
    name: 'Bilal Ahmed',
    role: 'finance_reviewer',
    branchKey: null,
  },
  {
    key: 'editor',
    email: 'editor@shiplens.test',
    name: 'Sana Malik',
    role: 'content_editor',
    branchKey: null,
  },
  {
    key: 'lead',
    email: 'lead@shiplens.test',
    name: 'Omar Siddiqui',
    role: 'branch_lead',
    branchKey: 'sample',
  },
  { key: 'hr', email: 'hr@shiplens.test', name: 'Hira Raza', role: 'hr_lead', branchKey: 'sample' },
];

const BRANCH_STAFF = {
  lahore: ['Faisal Qureshi', 'Mehwish Baig'],
  islamabad: ['Tahir Mirza', 'Nida Hashmi'],
  peshawar: ['Zubair Durrani', 'Asma Bukhari'],
  multan: ['Kamran Lodhi', 'Rubina Naqvi'],
  quetta: ['Waqas Jafri', 'Shazia Rizvi'],
};

const PURPOSES = [
  'Ration packs',
  'School fees fund',
  'Medical camp',
  'Flood relief',
  'General donations',
  'Winter clothing',
];

const NOTES = [
  'Cash box opened with two volunteers present.',
  'Receipt book pages 14 to 18.',
  'Collected at the Friday stall.',
  'Bank deposit slip filed.',
];

const VOID_REASONS = [
  'Entered twice by mistake.',
  'Wrong amount typed; re-entered.',
  'Donor cancelled the pledge.',
  'Belongs to another week; re-entered there.',
];

const RETURN_REASONS = [
  'Receipt numbers missing for two entries.',
  'Total does not match the deposit slip.',
  'Purpose missing on one entry; please check.',
  'Please split the medical camp amount by day.',
];

const TEAM_NAMES = [
  'Community Kitchen',
  'Education Support',
  'Logistics',
  'Medical Outreach',
  'Food Drive',
];

const FIRST_NAMES = [
  'Ayesha',
  'Danish',
  'Faiza',
  'Hamid',
  'Iqra',
  'Junaid',
  'Kiran',
  'Laiba',
  'Mahnoor',
  'Nabeel',
  'Rabia',
  'Saad',
  'Tooba',
  'Usman',
  'Zara',
  'Adeel',
  'Bushra',
  'Daniyal',
  'Erum',
  'Ghazal',
  'Haris',
  'Jaweria',
  'Moiz',
  'Noor',
  'Qasim',
  'Sidra',
  'Talha',
  'Uzma',
  'Yasir',
  'Zainab',
];

const LAST_NAMES = [
  'Qureshi',
  'Baig',
  'Mirza',
  'Hashmi',
  'Farooqi',
  'Rana',
  'Bukhari',
  'Durrani',
  'Jafri',
  'Lodhi',
  'Naqvi',
  'Rizvi',
  'Sheikh',
  'Butt',
  'Gilani',
  'Kazmi',
  'Memon',
  'Paracha',
  'Soomro',
  'Warsi',
];

const APPLICATION_MESSAGES = [
  'I can help on weekends with ration packing.',
  'Teacher by profession; happy to support the school fees drive.',
  'I have a car and can help with deliveries.',
  'Final year medical student, keen to help at camps.',
  null,
];

const DECLINE_NOTES = [
  'Not available on collection days.',
  'Applied to the wrong city; redirected.',
];

const MEMBER_ROLES = ['volunteer', 'team_lead', 'coordinator', 'mentor'];

// Report schedule per branch, indexed by DEMO_WEEKS position.
// returnedBefore: history has returned then resubmitted before the final approval.
// forceVoid: at least one collection is voided ('pre' before first submission, 'post' after a return).
function reportSchedule(branchKey) {
  const approvedUpTo = (last) => Array.from({ length: last + 1 }, () => ({ status: 'approved' }));
  switch (branchKey) {
    case 'sample': {
      const s = approvedUpTo(8);
      s[5] = { status: 'approved', returnedBefore: true };
      s[8] = { status: 'approved', forceVoid: 'pre' };
      s.push({ status: 'returned', forceVoid: 'post' });
      s.push({ status: 'submitted', forceVoid: 'pre' });
      s.push({ status: 'draft', forceVoid: 'pre' });
      return s;
    }
    case 'lahore': {
      const s = approvedUpTo(9);
      s[2] = { status: 'approved', returnedBefore: true, forceVoid: 'post' };
      s[3] = { status: 'approved', nil: true };
      s.push({ status: 'submitted' });
      s.push({ status: 'draft' });
      return s;
    }
    case 'islamabad': {
      const s = approvedUpTo(8);
      s[6] = { status: 'approved', returnedBefore: true };
      s.push({ status: 'submitted' });
      s.push({ status: 'returned' });
      s.push({ status: 'draft' });
      return s;
    }
    case 'peshawar': {
      // Paused after the week of 2026-10-12: its last report waits for review.
      const s = approvedUpTo(8);
      s.push({ status: 'submitted' });
      return s;
    }
    case 'quetta':
      // Closed after the week of 2026-09-14: every report approved.
      return approvedUpTo(5);
    default:
      return [];
  }
}

function formatMinor(minor) {
  if (typeof minor !== 'bigint' || minor <= 0n)
    throw new RangeError('amount must be a positive BigInt');
  return `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`;
}

function drawAmount(rng) {
  // About one in eight has odd paisa; the rest are round multiples of Rs 500.
  if (rng.chance(1, 8)) return BigInt(rng.int(50000, 4999999));
  return BigInt(rng.int(1, 100)) * 50000n;
}

function leadKey(branchKey) {
  return branchKey === 'sample' ? 'lead' : `lead.${branchKey}`;
}

function hrKey(branchKey) {
  return branchKey === 'sample' ? 'hr' : `hr.${branchKey}`;
}

function assertBefore(iso, limit, what) {
  if (!(iso < limit))
    throw new Error(`generator schedule error: ${what} ${iso} not before ${limit}`);
}

function byKeys(...keys) {
  return (a, b) => {
    for (const key of keys) {
      const x = a[key] ?? '';
      const y = b[key] ?? '';
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  };
}

function buildUsers() {
  const users = EXISTING_USERS.map((u) => ({ ...u, existing: true }));
  for (const [branchKey, [leadName, hrName]] of Object.entries(BRANCH_STAFF)) {
    users.push({
      key: `lead.${branchKey}`,
      email: `lead.${branchKey}@shiplens.test`,
      name: leadName,
      role: 'branch_lead',
      branchKey,
      existing: false,
    });
    users.push({
      key: `hr.${branchKey}`,
      email: `hr.${branchKey}@shiplens.test`,
      name: hrName,
      role: 'hr_lead',
      branchKey,
      existing: false,
    });
  }
  return users.sort(byKeys('key'));
}

// Builds the history for one report and returns it with the open windows
// (intervals in which collections may be voided).
function buildHistory(rng, branchKey, weekStart, spec) {
  if (spec.status === 'draft') return { history: [], returns: [], approvedAt: null };
  const lead = leadKey(branchKey);
  const history = [];
  const returns = [];
  const firstSubmit = at(addDays(weekStart, 7), 300 + rng.int(0, 90));
  history.push({ event: 'submitted', at: firstSubmit, actorKey: lead });
  let lastSubmit = firstSubmit;

  const review = (fromIso) => at(addDays(utcDate(fromIso), rng.int(1, 3)), 360 + rng.int(0, 360));

  if (spec.returnedBefore || spec.status === 'returned') {
    const returnedAt = review(lastSubmit);
    history.push({
      event: 'returned',
      at: returnedAt,
      actorKey: 'finance',
      reason: rng.pick(RETURN_REASONS),
    });
    returns.push(returnedAt);
    if (spec.status !== 'returned') {
      lastSubmit = at(addDays(utcDate(returnedAt), 1), 300 + rng.int(0, 90));
      history.push({ event: 'resubmitted', at: lastSubmit, actorKey: lead });
    }
  }

  let approvedAt = null;
  if (spec.status === 'approved') {
    approvedAt = review(lastSubmit);
    history.push({ event: 'approved', at: approvedAt, actorKey: 'finance' });
  }
  for (const event of history)
    assertBefore(event.at, AS_OF_END, `${branchKey} ${weekStart} ${event.event}`);
  return { history, returns, approvedAt };
}

function buildCollections(rng, branchKey, weekStart, spec, report, timeline) {
  if (spec.nil) return [];
  const lead = leadKey(branchKey);
  const lastDay = Math.min(6, daysBetween(weekStart, DATA_AS_OF));
  const count = rng.int(2, 7);
  const collections = [];
  for (let i = 0; i < count; i += 1) {
    const collectedOn = addDays(weekStart, rng.int(0, lastDay));
    // 09:00-19:00 PKT on the collection day.
    const createdAt = at(collectedOn, 240 + rng.int(0, 600));
    const amount = drawAmount(rng);
    collections.push({
      id: rng.uuid(),
      reportId: report.id,
      branchKey,
      amount: formatMinor(amount),
      collectedOn,
      purpose: rng.pick(PURPOSES),
      note: rng.chance(1, 5) ? rng.pick(NOTES) : null,
      status: 'active',
      voidReason: null,
      voidedAt: null,
      createdByKey: lead,
      createdAt,
      routedAt: null,
      routedByKey: null,
    });
  }

  // Voids: about one in ten, plus the forced one; at least one collection always stays active.
  const voidIndexes = new Set();
  for (let i = 0; i < collections.length; i += 1) if (rng.chance(1, 10)) voidIndexes.add(i);
  if (spec.forceVoid) voidIndexes.add(0);
  if (voidIndexes.size >= collections.length) voidIndexes.delete(collections.length - 1);
  for (const i of [...voidIndexes].sort((a, b) => a - b)) {
    const c = collections[i];
    const afterReturn =
      timeline.returns.length > 0 &&
      (spec.forceVoid === 'post' ? i === 0 : spec.forceVoid !== 'pre' && rng.chance(1, 2));
    const voidedAt = afterReturn
      ? plusMinutes(timeline.returns[0], 30 + rng.int(0, 150))
      : plusMinutes(c.createdAt, 30 + rng.int(0, 150));
    assertBefore(voidedAt, AS_OF_END, 'void');
    c.status = 'voided';
    c.voidReason = rng.pick(VOID_REASONS);
    c.voidedAt = voidedAt;
  }

  // Routing: roughly 60% of approved active collections, 2-6 days after approval, never after as-of.
  if (timeline.approvedAt) {
    for (const c of collections) {
      if (c.status !== 'active' || !rng.chance(3, 5)) continue;
      const routedAt = at(
        addDays(utcDate(timeline.approvedAt), rng.int(2, 6)),
        420 + rng.int(0, 300),
      );
      if (routedAt >= AS_OF_END) continue;
      c.routedAt = routedAt;
      c.routedByKey = 'finance';
    }
  }
  return collections;
}

function nameFactory(rng) {
  const used = new Set();
  return function nextName() {
    for (;;) {
      const name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
      if (!used.has(name)) {
        used.add(name);
        return name;
      }
    }
  };
}

function contactFactory() {
  let seq = 0;
  return function nextContact(fullName) {
    seq += 1;
    const slug = fullName.toLowerCase().replace(/[^a-z]+/g, '.');
    return {
      email: `${slug}.${String(seq).padStart(3, '0')}@shiplens.test`,
      phone: `0300000${String(1000 + seq * 7).padStart(4, '0')}`,
    };
  };
}

// Applications per branch: [accepted, pending, declined].
const APPLICATION_MIX = {
  sample: [2, 1, 1],
  lahore: [2, 1, 1],
  islamabad: [2, 1, 0],
  multan: [1, 2, 0],
  peshawar: [1, 0, 1],
};

// Members added directly (not from an application) per branch.
const DIRECT_MEMBERS = { sample: 8, lahore: 8, islamabad: 7, peshawar: 5, quetta: 4 };

function buildPeople(rng, branches) {
  const nextName = nameFactory(rng);
  const nextContact = contactFactory();
  const teams = [];
  for (const b of branches) {
    let count = 0;
    if (b.status === 'active') count = rng.int(2, 3);
    else if (b.status === 'paused') count = 1;
    for (const name of rng.shuffle(TEAM_NAMES).slice(0, count)) {
      teams.push({ id: rng.uuid(), branchKey: b.key, name });
    }
  }
  const teamsOf = (branchKey) => teams.filter((t) => t.branchKey === branchKey);

  const applications = [];
  const members = [];
  for (const b of branches) {
    const mix = APPLICATION_MIX[b.key];
    if (!mix) continue;
    const statuses = [
      ...Array(mix[0]).fill('accepted'),
      ...Array(mix[1]).fill('pending'),
      ...Array(mix[2]).fill('declined'),
    ];
    // Peshawar decided everything before it paused.
    const latestDay = b.key === 'peshawar' ? 50 : 60;
    for (const status of statuses) {
      const fullName = nextName();
      const contact = nextContact(fullName);
      const createdOn = addDays(
        '2026-08-15',
        status === 'pending' ? rng.int(30, 74) : rng.int(0, latestDay),
      );
      const createdAt = at(createdOn, 180 + rng.int(0, 720));
      const decided = status !== 'pending';
      const decidedAt = decided
        ? at(addDays(createdOn, rng.int(1, 6)), 300 + rng.int(0, 600))
        : null;
      if (decidedAt) assertBefore(decidedAt, AS_OF_END, 'application decision');
      assertBefore(createdAt, AS_OF_END, 'application');
      const app = {
        id: rng.uuid(),
        branchKey: b.key,
        fullName,
        email: contact.email,
        phone: contact.phone,
        message: rng.pick(APPLICATION_MESSAGES),
        status,
        decidedByKey: decided ? hrKey(b.key) : null,
        decidedAt,
        decisionNote:
          status === 'declined'
            ? rng.pick(DECLINE_NOTES)
            : status === 'accepted'
              ? 'Welcome aboard; orientation booked.'
              : null,
        createdAt,
      };
      applications.push(app);
      if (status === 'accepted') {
        const branchTeams = teamsOf(b.key);
        members.push({
          id: rng.uuid(),
          branchKey: b.key,
          applicationId: app.id,
          fullName,
          email: contact.email,
          phone: contact.phone,
          teamId: branchTeams.length > 0 ? rng.pick(branchTeams).id : null,
          memberRole: 'volunteer',
          status: 'active',
          // Decisions happen 10:00-20:00 PKT, so the UTC date is the PKT date.
          joinedOn: utcDate(decidedAt),
        });
      }
    }
  }

  for (const b of branches) {
    const count = DIRECT_MEMBERS[b.key] ?? 0;
    const branchTeams = teamsOf(b.key);
    for (let i = 0; i < count; i += 1) {
      const fullName = nextName();
      const contact = nextContact(fullName);
      let status;
      if (b.status === 'closed') status = rng.chance(1, 2) ? 'left' : 'inactive';
      else if (b.status === 'paused') status = rng.chance(1, 2) ? 'active' : 'inactive';
      else status = rng.chance(8, 10) ? 'active' : rng.pick(['inactive', 'left']);
      members.push({
        id: rng.uuid(),
        branchKey: b.key,
        applicationId: null,
        fullName,
        email: rng.chance(9, 10) ? contact.email : null,
        phone: rng.chance(5, 6) ? contact.phone : null,
        teamId: branchTeams.length > 0 && rng.chance(4, 5) ? rng.pick(branchTeams).id : null,
        memberRole: rng.chance(6, 10) ? 'volunteer' : rng.pick(MEMBER_ROLES.slice(1)),
        status,
        joinedOn: addDays('2025-01-06', rng.int(0, 570)),
      });
    }
  }

  return {
    teams: teams.sort(byKeys('branchKey', 'name')),
    applications: applications.sort(byKeys('branchKey', 'createdAt', 'id')),
    members: members.sort(byKeys('branchKey', 'fullName', 'id')),
  };
}

export function generateDemoData(seed = DEMO_SEED) {
  const rng = createRng(seed);
  const branches = BRANCHES.map((b) => ({ ...b, adopt: b.adopt === true }));
  const users = buildUsers();

  const reports = [];
  const collections = [];
  for (const branch of branches) {
    reportSchedule(branch.key).forEach((spec, index) => {
      const weekStart = DEMO_WEEKS[index];
      const report = { id: rng.uuid(), branchKey: branch.key, weekStart, status: spec.status };
      const timeline = buildHistory(rng, branch.key, weekStart, spec);
      report.history = timeline.history;
      report.confirmNil = spec.nil === true;
      reports.push(report);
      collections.push(...buildCollections(rng, branch.key, weekStart, spec, report, timeline));
    });
  }

  const people = buildPeople(rng, branches);

  return {
    manifest: {
      version: 1,
      seed,
      asOf: DATA_AS_OF,
      weeks: [...DEMO_WEEKS],
      files: [...DATA_FILES],
    },
    branches: branches.sort(byKeys('key')),
    users,
    teams: people.teams,
    members: people.members,
    applications: people.applications,
    reports: reports.sort(byKeys('branchKey', 'weekStart')),
    collections: collections.sort(byKeys('branchKey', 'collectedOn', 'createdAt', 'id')),
  };
}

export function serialise(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function renderFiles(data) {
  const files = { 'manifest.json': serialise(data.manifest) };
  for (const file of DATA_FILES) files[file] = serialise(data[file.replace(/\.json$/, '')]);
  return files;
}

async function main(argv) {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const check = argv.includes('--check');
  const outIndex = argv.indexOf('--out-dir');
  const outDir =
    outIndex >= 0 && argv[outIndex + 1]
      ? path.resolve(argv[outIndex + 1])
      : path.join(root, 'db', 'seed', 'data');

  const data = generateDemoData();
  const { validateDemoData } = await import('./validate.mjs');
  const problems = validateDemoData(data);
  if (problems.length > 0) {
    console.error(`Generated data breaks ${problems.length} rule(s):\n${problems.join('\n')}`);
    return 1;
  }

  const files = renderFiles(data);
  if (check) {
    const differing = Object.entries(files)
      .filter(([name, content]) => {
        const file = path.join(outDir, name);
        return !existsSync(file) || readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== content;
      })
      .map(([name]) => name);
    if (differing.length > 0) {
      console.error(`Demo data files differ from the generator output: ${differing.join(', ')}`);
      console.error('Run: node scripts/demo-data/generate.mjs');
      return 1;
    }
    console.log('Demo data files are up to date.');
    return 0;
  }

  mkdirSync(outDir, { recursive: true });
  for (const [name, content] of Object.entries(files))
    writeFileSync(path.join(outDir, name), content);
  console.log(`Wrote ${Object.keys(files).length} files to ${outDir}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // No top-level await: validate.mjs imports this module, which must finish evaluating first.
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
