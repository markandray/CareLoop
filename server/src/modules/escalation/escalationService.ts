import { ActorType, Prisma, type EscalationLevel, type PrismaClient } from '@prisma/client';
import type { Clock } from '../../core/clock';
import { record } from '../../core/audit';
import { withTransaction } from '../../core/withTransaction';
import { workflowConfig } from '../../config/workflowConfig';
import { loadAttentionSnapshots } from '../attention/attentionService';
import { overdueInfo, type AttentionSnapshot } from '../attention/attentionEngine';
import { raiseEscalation } from './raiseEscalation';

const order: Record<EscalationLevel, number> = { LEVEL_0: 0, LEVEL_1: 1, LEVEL_2: 2, LEVEL_3: 3 };
const SWEEP_LOCK_KEY = 205_205_01n;

export function requiredEscalationLevel(snapshot: AttentionSnapshot, now: Date, config = workflowConfig): EscalationLevel {
  if (snapshot.state === 'CLOSED') return 'LEVEL_0';
  const { overdueBy, slaPeriods } = overdueInfo(snapshot, now, config);
  if (slaPeriods >= config.thresholds.level3OverduePeriods) return 'LEVEL_3';
  if (slaPeriods >= config.thresholds.level2OverduePeriods) return 'LEVEL_2';
  if (snapshot.escalationLevel === 'LEVEL_2' && snapshot.escalatedAt && now.getTime() - snapshot.escalatedAt.getTime() >= config.thresholds.level2UnclearedMs) return 'LEVEL_3';
  const policyLevel: EscalationLevel = overdueBy > config.thresholds.level1OverdueMs ? 'LEVEL_1' : 'LEVEL_0';
  return order[snapshot.escalationLevel] > order[policyLevel] ? snapshot.escalationLevel : policyLevel;
}

export interface EscalationSweepDependencies { prisma: PrismaClient; clock: Clock }

/** One bounded query set for all open cases. Returns null when another sweep holds the lock. */
export async function runEscalationSweep(deps: EscalationSweepDependencies): Promise<number | null> {
  return withTransaction(deps.prisma, async (tx) => {
    const lock = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(${SWEEP_LOCK_KEY}) AS locked`;
    if (!lock[0]?.locked) return null;
    const now = deps.clock.now();
    const rows = await tx.screeningCase.findMany({ where: { state: { not: 'CLOSED' } }, include: { ownerUser: true } });
    const snapshots = await loadAttentionSnapshots(tx, rows, now);
    let raised = 0;
    for (const row of rows) {
      const snapshot = snapshots.get(row.id)!;
      snapshot.escalationLevel = row.escalationLevel;
      snapshot.escalatedAt = row.escalatedAt;
      const required = requiredEscalationLevel(snapshot, now);
      if (order[required] <= order[row.escalationLevel]) continue;
      const reason = required === 'LEVEL_3' && row.escalationLevel === 'LEVEL_2' && overdueInfo(snapshot, now).slaPeriods < workflowConfig.thresholds.level3OverduePeriods
        ? 'LEVEL_2_UNCLEARED_48_HOURS'
        : `OVERDUE_SLA_PERIODS_${required.slice(-1)}`;
      if (await raiseEscalation(tx, { caseId: row.id, level: required, reason, now }, deps.clock)) {
        await record(tx, { actorType: ActorType.SYSTEM, action: 'ESCALATION_RAISED', entityType: 'ScreeningCase', entityId: row.id }, deps.clock);
        raised += 1;
      }
    }
    return raised;
  });
}
