import type { PrismaClient } from '@prisma/client';

export type ClockUnit =
  'milliseconds' | 'seconds' | 'minutes' | 'hours' | 'days';

export interface Clock {
  now(): Date;
  advance(amount: number, unit: ClockUnit): Promise<Date>;
  reset(): Promise<Date>;
}

export const CLOCK_OFFSET_SETTING_KEY = 'demoClockOffsetMs';

type SettingDelegate = Pick<
  PrismaClient['systemSetting'],
  'findUnique' | 'upsert'
>;

/** A persisted offset over an injectable wall clock; call initialize before use. */
export class DatabaseClock implements Clock {
  private offsetMs = 0;
  private initialized = false;

  constructor(
    private readonly settings: SettingDelegate,
    private readonly wallNow: () => Date = () => new Date(),
  ) {}

  async initialize(): Promise<void> {
    const setting = await this.settings.findUnique({
      where: { key: CLOCK_OFFSET_SETTING_KEY },
      select: { value: true },
    });
    this.offsetMs = setting ? readOffset(setting.value) : 0;
    this.initialized = true;
  }

  now(): Date {
    this.assertInitialized();
    return new Date(this.wallNow().getTime() + this.offsetMs);
  }

  async advance(amount: number, unit: ClockUnit): Promise<Date> {
    this.assertInitialized();
    if (!Number.isFinite(amount) || amount < 0) {
      throw new RangeError(
        'Clock advance amount must be a finite non-negative number.',
      );
    }
    const multipliers: Record<ClockUnit, number> = {
      milliseconds: 1,
      seconds: 1_000,
      minutes: 60_000,
      hours: 3_600_000,
      days: 86_400_000,
    };
    const nextOffset = this.offsetMs + amount * multipliers[unit];
    if (!Number.isSafeInteger(nextOffset)) {
      throw new RangeError(
        'Clock offset must be a safe integer number of milliseconds.',
      );
    }
    await this.save(nextOffset);
    this.offsetMs = nextOffset;
    return this.now();
  }

  async reset(): Promise<Date> {
    this.assertInitialized();
    await this.save(0);
    this.offsetMs = 0;
    return this.now();
  }

  private async save(offsetMs: number): Promise<void> {
    const updatedAt = new Date(this.wallNow().getTime() + offsetMs);
    await this.settings.upsert({
      where: { key: CLOCK_OFFSET_SETTING_KEY },
      create: { key: CLOCK_OFFSET_SETTING_KEY, value: offsetMs, updatedAt },
      update: { value: offsetMs, updatedAt, updatedById: null },
    });
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'DatabaseClock.initialize() must complete before using the clock.',
      );
    }
  }
}

function readOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(
      `System setting ${CLOCK_OFFSET_SETTING_KEY} must be an integer millisecond offset.`,
    );
  }
  return value;
}
