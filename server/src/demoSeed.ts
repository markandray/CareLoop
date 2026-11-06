import { PrismaClient } from '@prisma/client';
import { upsertDemoPatients } from './seed';

const prisma = new PrismaClient();
const base = process.env.API_BASE_URL ?? 'http://server:4000';
const password = process.env.DEMO_PASSWORD ?? 'CareLoopDemo2026!';
type Json = Record<string, unknown>;
const sessions = new Map<string, string>();

async function call(role: string, method: string, path: string, body?: Json): Promise<Json> {
  const headers: Record<string, string> = { Origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:3000' };
  const cookie = sessions.get(role);
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}/api/v1${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${await response.text()}`);
  return response.status === 204 ? {} : await response.json() as Json;
}

async function login(role: string, email: string): Promise<void> {
  const response = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { Origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:3000', 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!response.ok) throw new Error(`Login failed for ${email}: ${response.status}`);
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error(`Login for ${email} did not return a session cookie.`);
  sessions.set(role, setCookie.split(';')[0]!);
}

async function main(): Promise<void> {
  if (await prisma.systemSetting.findUnique({ where: { key: 'demoSeed' } })) throw new Error('Demo data already exists. Run `npm run demo:reset` to recreate it.');
  await upsertDemoPatients();
  const accounts = [
    ['admin', 'admin@careloop.local'], ['doctorA', 'doctor.screening@careloop.local'], ['doctorB', 'doctor.hospital@careloop.local'],
    ['coordA', 'coordinator.screening@careloop.local'], ['coordB', 'coordinator.hospital@careloop.local'],
    ['patient0', 'patient.en@careloop.local'], ['patient1', 'patient.ar@careloop.local'],
    ...Array.from({ length: 12 }, (_, i) => [`patient${i + 2}`, `patient.demo${String(i + 3).padStart(2, '0')}@careloop.local`]),
  ];
  for (const [role, email] of accounts) await login(role!, email!);
  const providers = await call('admin', 'GET', '/providers?limit=100');
  const providerRows = providers.items as Json[];
  const orderedProviders = [
    providerRows.find((item) => item.name === 'Abu Dhabi Prevention Screening Centre'),
    providerRows.find((item) => item.name === 'Sheikh Khalifa Hospital'),
    providerRows.find((item) => item.name === 'Al Bateen Community Health Clinic'),
  ];
  if (orderedProviders.some((item) => !item)) throw new Error('The base seed providers are incomplete. Run `npm run seed` first.');
  const providerIds = orderedProviders.map((item) => (item as Json).id as string);
  const providerNames = new Map(providerRows.map((item) => [item.id as string, item.name as string]));
  const patients = await prisma.patient.findMany({ where: { syntheticMrn: { startsWith: 'MRN-SYN-' } }, include: { user: true }, orderBy: { syntheticMrn: 'asc' } });
  const byMrn = new Map(patients.map((p) => [p.syntheticMrn, p.id]));
  const doctorRows = await prisma.user.findMany({ where: { email: { in: ['doctor.screening@careloop.local', 'doctor.hospital@careloop.local'] } } });
  const doctorA = doctorRows.find((u) => u.email.startsWith('doctor.screening'))!.id;
  const doctorB = doctorRows.find((u) => u.email.startsWith('doctor.hospital'))!.id;
  const cases: Array<{ id: string; state: string; urgency: string; provider: string; account: string }> = [];
  const create = async (i: number, opts: { provider?: number; urgent?: boolean; assigned?: boolean } = {}) => {
    const p = providerIds[opts.provider ?? (i % 2)]!;
    const mrn = i < 2 ? `MRN-SYN-000${i + 1}` : `MRN-SYN-${String(i + 1).padStart(4, '0')}`;
    const created = await call('admin', 'POST', '/cases', { transitionKey: 'CREATE_CASE', evidence: { patientId: byMrn.get(mrn), originProviderId: p, ...(opts.assigned === false ? {} : { assignedDoctorId: p === providerIds[0] ? doctorA : doctorB }), pathway: 'Synthetic screening pathway', screeningType: 'Synthetic screening', resultCategory: 'Synthetic actionable finding', preliminarySummary: 'Synthetic intake awaiting clinician review.', recommendedAction: 'Clinician review required.', intakeUrgency: opts.urgent ? 'URGENT' : 'ROUTINE' } });
    const id = (created.case as Json).id as string;
    cases[i] = { id, state: 'NEW', urgency: opts.urgent ? 'URGENT' : 'ROUTINE', provider: p, account: p === providerIds[0] ? 'coordinator.screening@careloop.local' : 'coordinator.hospital@careloop.local' };
    return { id, p, patientRole: `patient${i}` };
  };
  const prepare = async (i: number, opts: { provider?: number; route?: 'REFERRAL' | 'CONFIRMATION'; urgent?: boolean } = {}) => {
    const c = await create(i, opts);
    const doctorRole = c.p === providerIds[0] ? 'doctorA' : 'doctorB';
    await call(doctorRole, 'PUT', `/cases/${c.id}/review-draft`, { resultCategoryCode: 'FOLLOW_UP_NEEDED', nextStepCode: 'SPECIALIST_REFERRAL', urgencyLabel: opts.urgent ? 'URGENT' : 'ROUTINE', route: opts.route ?? 'REFERRAL' });
    const generated = await call(doctorRole, 'POST', `/cases/${c.id}/explanations/generate`, {});
    const explanations = generated.explanations as Json[];
    for (const e of explanations) await call(doctorRole, 'POST', `/cases/${c.id}/explanations/${e.id}/approve`, {});
    return { ...c, doctorRole, explanations };
  };
  const review = async (c: Awaited<ReturnType<typeof prepare>>) => {
    await call(c.doctorRole, 'POST', `/cases/${c.id}/transitions`, { transitionKey: 'REVIEW_CASE', expectedState: 'NEW', evidence: { approvedExplanationIds: c.explanations.map((x) => x.id) } });
    cases.find((x) => x.id === c.id)!.state = 'CLINICIAN_REVIEWED';
    return c;
  };
  const dispatch = async (c: Awaited<ReturnType<typeof prepare>>) => {
    const notices = await call(c.p === providerIds[0] ? 'coordA' : 'coordB', 'GET', '/notifications?limit=100');
    const n = (notices.items as Json[]).find((x) => x.caseId === c.id && x.templateKey === 'result_reviewed');
    if (n) await call(c.p === providerIds[0] ? 'coordA' : 'coordB', 'POST', `/notifications/${n.id as string}/dispatch`, {});
    const patientRole = c.patientRole;
    const patientNotices = await call(patientRole, 'GET', '/notifications?limit=100');
    const patientNotice = (patientNotices.items as Json[]).find((x) => x.caseId === c.id && x.templateKey === 'result_reviewed');
    if (patientNotice) await call(patientRole, 'POST', `/notifications/${patientNotice.id as string}/acknowledge`, {});
    if (patientNotice) await call(patientRole, 'POST', `/cases/${c.id}/understanding`, { explanationId: c.explanations.find((x) => x.language === (patientRole === 'patient1' ? 'AR' : 'EN'))!.id });
  };
  // 01 urgent, deliberately unassigned; 02 saves a draft and remains NEW.
  const unassigned = await create(0, { urgent: true, assigned: false });
  const draftOnly = await prepare(1, { provider: 0 }); // draft is intentionally left unreviewed
  // 03 reviewed, approved, but the queued result notification is not dispatched.
  const undispatched = await review(await prepare(2, { provider: 0 }));
  // 04 reviewed and dispatched, waiting for the coordinator route action.
  const dispatched = await review(await prepare(3, { provider: 1 })); await dispatch(dispatched);
  // 05 confirmation path.
  const confirmation = await review(await prepare(4, { provider: 0, route: 'CONFIRMATION' })); await dispatch(confirmation);
  await call('coordA', 'POST', `/cases/${confirmation.id}/transitions`, { transitionKey: 'REQUEST_CONFIRMATION', expectedState: 'CLINICIAN_REVIEWED', evidence: {} }); cases[4]!.state = 'CONFIRMATION_PENDING';
  // 06 is the untouched cross-provider pending referral used in the staged overdue demo.
  const stuck = await review(await prepare(5, { provider: 0, urgent: true })); await dispatch(stuck);
  const patientConsents = await call(stuck.patientRole, 'POST', '/patients/me/consents', { providerId: providerIds[1], scope: 'CROSS_PROVIDER_REFERRAL' });
  void patientConsents;
  const coordinator = stuck.p === providerIds[0] ? 'coordA' : 'coordB';
  await call(coordinator, 'POST', `/cases/${stuck.id}/transitions`, { transitionKey: 'CREATE_REFERRAL_FROM_REVIEW', expectedState: 'CLINICIAN_REVIEWED', evidence: { toProviderId: providerIds[1], referralReason: 'Synthetic referral for demonstration.' } }); cases[5]!.state = 'REFERRAL_PENDING';
  const referral = await prisma.referral.findFirstOrThrow({ where: { caseId: stuck.id, status: 'PENDING' } });
  // 07 rejected; 08 accepted; 09 scheduled; 10 missed; 11 care; 12 and 13 closed examples.
  const rejected = await review(await prepare(6, { provider: 0 })); await dispatch(rejected);
  const referrer = rejected.p === providerIds[0] ? 'coordA' : 'coordB';
  const receiving = rejected.p === providerIds[0] ? 'coordB' : 'coordA';
  await call(rejected.patientRole, 'POST', '/patients/me/consents', { providerId: providerIds[1], scope: 'CROSS_PROVIDER_REFERRAL' });
  await call(referrer, 'POST', `/cases/${rejected.id}/transitions`, { transitionKey: 'CREATE_REFERRAL_FROM_REVIEW', expectedState: 'CLINICIAN_REVIEWED', evidence: { toProviderId: providerIds[rejected.p === providerIds[0] ? 1 : 0], referralReason: 'Synthetic referral.' } });
  const rejectedReferral = await prisma.referral.findFirstOrThrow({ where: { caseId: rejected.id, status: 'PENDING' } });
  await call(receiving, 'POST', `/referrals/${rejectedReferral.id}/reject`, { rejectionReason: 'Synthetic capacity example.' });
  cases[6]!.state = 'REFERRAL_PENDING';
  const accepted = await review(await prepare(7, { provider: 0 })); await dispatch(accepted);
  await call('coordA', 'POST', `/cases/${accepted.id}/transitions`, { transitionKey: 'CREATE_REFERRAL_FROM_REVIEW', expectedState: 'CLINICIAN_REVIEWED', evidence: { toProviderId: providerIds[0], referralReason: 'Synthetic referral.' } });
  const acceptedRef = await prisma.referral.findFirstOrThrow({ where: { caseId: accepted.id, status: 'PENDING' } });
  await call('coordA', 'POST', `/cases/${accepted.id}/transitions`, { transitionKey: 'ACCEPT_REFERRAL', expectedState: 'REFERRAL_PENDING', evidence: { referralId: acceptedRef.id } }); cases[7]!.state = 'REFERRAL_ACCEPTED';
  const scheduled = await review(await prepare(8, { provider: 0 })); await dispatch(scheduled);
  await call('coordA', 'POST', `/cases/${scheduled.id}/transitions`, { transitionKey: 'CREATE_REFERRAL_FROM_REVIEW', expectedState: 'CLINICIAN_REVIEWED', evidence: { toProviderId: providerIds[0], referralReason: 'Synthetic referral.' } });
  const scheduledRef = await prisma.referral.findFirstOrThrow({ where: { caseId: scheduled.id, status: 'PENDING' } });
  await call('coordA', 'POST', `/cases/${scheduled.id}/transitions`, { transitionKey: 'ACCEPT_REFERRAL', expectedState: 'REFERRAL_PENDING', evidence: { referralId: scheduledRef.id } });
  const clockStatus = await call('admin', 'GET', '/demo/clock');
  const at = new Date(new Date(clockStatus.now as string).getTime() + 86400000).toISOString();
  await call('coordA', 'POST', `/cases/${scheduled.id}/transitions`, { transitionKey: 'SCHEDULE_APPOINTMENT', expectedState: 'REFERRAL_ACCEPTED', evidence: { scheduledAt: at, location: 'Synthetic clinic room' } }); cases[8]!.state = 'APPOINTMENT_SCHEDULED';
  const missed = await review(await prepare(9, { provider: 0 })); await dispatch(missed);
  await call('coordA', 'POST', `/cases/${missed.id}/transitions`, { transitionKey: 'CREATE_REFERRAL_FROM_REVIEW', expectedState: 'CLINICIAN_REVIEWED', evidence: { toProviderId: providerIds[0], referralReason: 'Synthetic referral.' } });
  const missedRef = await prisma.referral.findFirstOrThrow({ where: { caseId: missed.id, status: 'PENDING' } });
  await call('coordA', 'POST', `/cases/${missed.id}/transitions`, { transitionKey: 'ACCEPT_REFERRAL', expectedState: 'REFERRAL_PENDING', evidence: { referralId: missedRef.id } });
  await call('coordA', 'POST', `/cases/${missed.id}/transitions`, { transitionKey: 'SCHEDULE_APPOINTMENT', expectedState: 'REFERRAL_ACCEPTED', evidence: { scheduledAt: at, location: 'Synthetic clinic room' } });
  const appt = await prisma.appointment.findFirstOrThrow({ where: { referralId: missedRef.id, status: 'SCHEDULED' } });
  await call('coordA', 'POST', `/appointments/${appt.id}/attendance`, { status: 'MISSED', delayReason: 'PATIENT_UNREACHABLE' }); cases[9]!.state = 'APPOINTMENT_SCHEDULED';
  const care = await review(await prepare(10, { provider: 0 })); await dispatch(care);
  await call('coordA', 'POST', `/cases/${care.id}/transitions`, { transitionKey: 'CREATE_REFERRAL_FROM_REVIEW', expectedState: 'CLINICIAN_REVIEWED', evidence: { toProviderId: providerIds[0], referralReason: 'Synthetic referral.' } });
  const careRef = await prisma.referral.findFirstOrThrow({ where: { caseId: care.id, status: 'PENDING' } });
  await call('coordA', 'POST', `/cases/${care.id}/transitions`, { transitionKey: 'ACCEPT_REFERRAL', expectedState: 'REFERRAL_PENDING', evidence: { referralId: careRef.id } });
  await call('coordA', 'POST', `/cases/${care.id}/transitions`, { transitionKey: 'SCHEDULE_APPOINTMENT', expectedState: 'REFERRAL_ACCEPTED', evidence: { scheduledAt: at, location: 'Synthetic clinic room' } });
  const careAppt = await prisma.appointment.findFirstOrThrow({ where: { referralId: careRef.id, status: 'SCHEDULED' } });
  await call('coordA', 'POST', `/appointments/${careAppt.id}/attendance`, { status: 'ATTENDED' });
  await call('doctorA', 'POST', `/cases/${care.id}/transitions`, { transitionKey: 'START_CARE', expectedState: 'APPOINTMENT_SCHEDULED', evidence: { carePlan: 'Synthetic care plan recorded.' } }); cases[10]!.state = 'CARE_STARTED';
  const closed = await review(await prepare(11, { provider: 0 })); await dispatch(closed);
  await call('coordA', 'POST', `/cases/${closed.id}/transitions`, { transitionKey: 'CREATE_REFERRAL_FROM_REVIEW', expectedState: 'CLINICIAN_REVIEWED', evidence: { toProviderId: providerIds[0], referralReason: 'Synthetic referral.' } });
  const closeRef = await prisma.referral.findFirstOrThrow({ where: { caseId: closed.id, status: 'PENDING' } });
  await call('coordA', 'POST', `/cases/${closed.id}/transitions`, { transitionKey: 'ACCEPT_REFERRAL', expectedState: 'REFERRAL_PENDING', evidence: { referralId: closeRef.id } });
  await call('coordA', 'POST', `/cases/${closed.id}/transitions`, { transitionKey: 'SCHEDULE_APPOINTMENT', expectedState: 'REFERRAL_ACCEPTED', evidence: { scheduledAt: at, location: 'Synthetic clinic room' } });
  const closeAppt = await prisma.appointment.findFirstOrThrow({ where: { referralId: closeRef.id, status: 'SCHEDULED' } });
  await call('coordA', 'POST', `/appointments/${closeAppt.id}/attendance`, { status: 'ATTENDED' });
  await call('doctorA', 'POST', `/cases/${closed.id}/transitions`, { transitionKey: 'START_CARE', expectedState: 'APPOINTMENT_SCHEDULED', evidence: { carePlan: 'Synthetic care plan recorded.' } });
  await call('doctorA', 'POST', `/cases/${closed.id}/transitions`, { transitionKey: 'CLOSE_COMPLETED_CARE', expectedState: 'CARE_STARTED', evidence: { closureReason: 'COMPLETED_CARE', documentedReason: 'Synthetic care was completed.', careCompletionSummary: 'Synthetic care completion recorded.' } }); cases[11]!.state = 'CLOSED';
  const declined = await review(await prepare(12, { provider: 0 })); await dispatch(declined);
  const pat = await call('patient12', 'POST', `/cases/${declined.id}/decline-care`, { reason: 'Synthetic patient preference.' }); void pat;
  await call('doctorA', 'POST', `/cases/${declined.id}/transitions`, { transitionKey: 'CLOSE_AFTER_REVIEW_PATIENT_DECLINED', expectedState: 'CLINICIAN_REVIEWED', evidence: { closureReason: 'PATIENT_DECLINED', documentedReason: 'Synthetic patient declined further care.' } }); cases[12]!.state = 'CLOSED';
  const contacts = await review(await prepare(13, { provider: 0 })); await dispatch(contacts);
  await call('coordA', 'POST', `/cases/${contacts.id}/contact-attempts`, { channel: 'PHONE', outcome: 'FAILED', delayReason: 'PATIENT_UNREACHABLE' });
  await call('coordA', 'POST', `/cases/${contacts.id}/contact-attempts`, { channel: 'PHONE', outcome: 'FAILED', delayReason: 'PATIENT_UNREACHABLE' });
  cases[13]!.state = 'CLINICIAN_REVIEWED';
  const seededAt = new Date(clockStatus.now as string);
  await prisma.systemSetting.create({ data: { key: 'demoSeed', value: { date: seededAt.toISOString(), caseIds: cases.map((item) => item!.id), stuckCaseId: stuck.id }, updatedAt: seededAt } });
  console.log('Demo data created. The stuck demo case is ' + stuck.id + '.');
  console.table(cases.map((c, i) => ({ caseId: c!.id, state: c!.state, urgency: c!.urgency, provider: providerNames.get(c!.provider), login: i === 5 ? 'coordinator.hospital@careloop.local' : c!.account })));
  console.log('STUCK_DEMO_CASE_ID=' + stuck.id);
  void unassigned; void draftOnly; void undispatched; void dispatched; void referral;
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
