import bcrypt from 'bcryptjs';
import { PrismaClient, type Role, type Language, type ProviderType } from '@prisma/client';
import { getEnv } from './config/env';
import { DatabaseClock } from './core/clock';

const prisma = new PrismaClient();

interface ProviderSeed {
  name: string;
  type: ProviderType;
}

interface UserSeed {
  email: string;
  name: string;
  role: Role;
  providerIndex?: number;
  language: Language;
  patientProfile?: {
    syntheticMrn: string;
    dateOfBirth: Date;
    preferredLanguage: Language;
    preferredChannel: 'PORTAL';
  };
}

export async function runSeed(): Promise<void> {
  const env = getEnv();
  const clock = new DatabaseClock(prisma.systemSetting);
  await clock.initialize();

  console.log(`CareLoop Seeder: Started at ${clock.now().toISOString()}`);
  console.log(`Using DEMO_PASSWORD configured in environment.`);

  // Hash demo password
  const passwordHash = await bcrypt.hash(env.DEMO_PASSWORD, 10);

  // 1. Seed three providers: screening centre, hospital, clinic
  const providerDefs: ProviderSeed[] = [
    {
      name: 'Abu Dhabi Prevention Screening Centre',
      type: 'SCREENING_CENTRE',
    },
    {
      name: 'Sheikh Khalifa Hospital',
      type: 'HOSPITAL',
    },
    {
      name: 'Al Bateen Community Health Clinic',
      type: 'CLINIC',
    },
  ];

  const providers = [];
  for (const def of providerDefs) {
    const now = clock.now();
    const provider = await prisma.provider.upsert({
      where: { name: def.name },
      update: { type: def.type, updatedAt: now },
      create: { name: def.name, type: def.type, createdAt: now, updatedAt: now },
    });
    providers.push(provider);
    console.log(`Provider upserted: ${provider.name} (${provider.type}) [${provider.id}]`);
  }

  // 2. Define users: 2 doctors at different providers, 1 coordinator at each provider (3 total),
  // 1 admin, 2 synthetic patients (1 EN, 1 AR)
  const userDefs: UserSeed[] = [
    // Two doctors at different providers
    {
      email: 'doctor.screening@careloop.local',
      name: 'Dr. Fatima Al-Hashimi',
      role: 'DOCTOR',
      providerIndex: 0, // screeningCentre
      language: 'EN',
    },
    {
      email: 'doctor.hospital@careloop.local',
      name: 'Dr. Tariq Mansoor',
      role: 'DOCTOR',
      providerIndex: 1, // hospital
      language: 'EN',
    },
    // One coordinator at each provider
    {
      email: 'coordinator.screening@careloop.local',
      name: 'Sara Al-Zaabi',
      role: 'COORDINATOR',
      providerIndex: 0, // screeningCentre
      language: 'EN',
    },
    {
      email: 'coordinator.hospital@careloop.local',
      name: 'Zaid Al-Husseini',
      role: 'COORDINATOR',
      providerIndex: 1, // hospital
      language: 'EN',
    },
    {
      email: 'coordinator.clinic@careloop.local',
      name: 'Mariam Al-Qasimi',
      role: 'COORDINATOR',
      providerIndex: 2, // clinic
      language: 'AR',
    },
    // One system administrator
    {
      email: 'admin@careloop.local',
      name: 'CareLoop System Administrator',
      role: 'ADMIN',
      language: 'EN',
    },
    // Synthetic patient 1: English preferred
    {
      email: 'patient.en@careloop.local',
      name: 'John Miller',
      role: 'PATIENT',
      language: 'EN',
      patientProfile: {
        syntheticMrn: 'MRN-SYN-0001',
        dateOfBirth: new Date('1985-04-12'),
        preferredLanguage: 'EN',
        preferredChannel: 'PORTAL',
      },
    },
    // Synthetic patient 2: Arabic preferred
    {
      email: 'patient.ar@careloop.local',
      name: 'Noura Al-Nuaimi',
      role: 'PATIENT',
      language: 'AR',
      patientProfile: {
        syntheticMrn: 'MRN-SYN-0002',
        dateOfBirth: new Date('1990-09-23'),
        preferredLanguage: 'AR',
        preferredChannel: 'PORTAL',
      },
    },
  ];

  for (const def of userDefs) {
    const now = clock.now();
    const providerId =
      def.providerIndex !== undefined ? providers[def.providerIndex].id : null;

    const user = await prisma.user.upsert({
      where: { email: def.email },
      update: {
        name: def.name,
        role: def.role,
        providerId,
        language: def.language,
        passwordHash,
        updatedAt: now,
      },
      create: {
        email: def.email,
        name: def.name,
        role: def.role,
        providerId,
        language: def.language,
        passwordHash,
        createdAt: now,
        updatedAt: now,
      },
    });

    console.log(`User upserted: ${user.email} (${user.role}) [${user.id}]`);

    if (def.patientProfile) {
      const profileNow = clock.now();
      const patient = await prisma.patient.upsert({
        where: { userId: user.id },
        update: {
          syntheticMrn: def.patientProfile.syntheticMrn,
          dateOfBirth: def.patientProfile.dateOfBirth,
          preferredLanguage: def.patientProfile.preferredLanguage,
          preferredChannel: def.patientProfile.preferredChannel,
          updatedAt: profileNow,
        },
        create: {
          userId: user.id,
          syntheticMrn: def.patientProfile.syntheticMrn,
          dateOfBirth: def.patientProfile.dateOfBirth,
          preferredLanguage: def.patientProfile.preferredLanguage,
          preferredChannel: def.patientProfile.preferredChannel,
          createdAt: profileNow,
          updatedAt: profileNow,
        },
      });
      console.log(
        `  -> Patient profile upserted: MRN=${patient.syntheticMrn}, lang=${patient.preferredLanguage}`,
      );
    }
  }

  console.log(`CareLoop Seeder: Completed successfully.`);
}

/** Add deterministic synthetic patient accounts for the repeatable demo dataset. */
export async function upsertDemoPatients(): Promise<void> {
  const passwordHash = await bcrypt.hash(getEnv().DEMO_PASSWORD, 10);
  const clock = new DatabaseClock(prisma.systemSetting);
  await clock.initialize();
  const patients = [
    { email: 'patient.demo03@careloop.local', name: 'Synthetic Patient Three', mrn: 'MRN-SYN-0003', language: 'EN' as const },
    { email: 'patient.demo04@careloop.local', name: 'Synthetic Patient Four', mrn: 'MRN-SYN-0004', language: 'AR' as const },
    { email: 'patient.demo05@careloop.local', name: 'Synthetic Patient Five', mrn: 'MRN-SYN-0005', language: 'EN' as const },
    { email: 'patient.demo06@careloop.local', name: 'Synthetic Patient Six', mrn: 'MRN-SYN-0006', language: 'AR' as const },
    { email: 'patient.demo07@careloop.local', name: 'Synthetic Patient Seven', mrn: 'MRN-SYN-0007', language: 'EN' as const },
    { email: 'patient.demo08@careloop.local', name: 'Synthetic Patient Eight', mrn: 'MRN-SYN-0008', language: 'EN' as const },
    { email: 'patient.demo09@careloop.local', name: 'Synthetic Patient Nine', mrn: 'MRN-SYN-0009', language: 'AR' as const },
    { email: 'patient.demo10@careloop.local', name: 'Synthetic Patient Ten', mrn: 'MRN-SYN-0010', language: 'EN' as const },
    { email: 'patient.demo11@careloop.local', name: 'Synthetic Patient Eleven', mrn: 'MRN-SYN-0011', language: 'EN' as const },
    { email: 'patient.demo12@careloop.local', name: 'Synthetic Patient Twelve', mrn: 'MRN-SYN-0012', language: 'AR' as const },
    { email: 'patient.demo13@careloop.local', name: 'Synthetic Patient Thirteen', mrn: 'MRN-SYN-0013', language: 'EN' as const },
    { email: 'patient.demo14@careloop.local', name: 'Synthetic Patient Fourteen', mrn: 'MRN-SYN-0014', language: 'EN' as const },
  ];
  const hash = passwordHash;
  for (const entry of patients) {
    const now = clock.now();
    const user = await prisma.user.upsert({ where: { email: entry.email }, update: { name: entry.name, role: 'PATIENT', providerId: null, language: entry.language, passwordHash: hash, updatedAt: now }, create: { email: entry.email, name: entry.name, role: 'PATIENT', language: entry.language, passwordHash: hash, createdAt: now, updatedAt: now } });
    await prisma.patient.upsert({ where: { userId: user.id }, update: { syntheticMrn: entry.mrn, dateOfBirth: new Date('1990-01-01'), preferredLanguage: entry.language, preferredChannel: 'PORTAL', updatedAt: now }, create: { userId: user.id, syntheticMrn: entry.mrn, dateOfBirth: new Date('1990-01-01'), preferredLanguage: entry.language, preferredChannel: 'PORTAL', createdAt: now, updatedAt: now } });
  }
}

if (process.argv[1]?.endsWith('seed.ts')) {
  runSeed()
    .catch((err) => {
      console.error('Seed execution failed:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
