import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transitionTable } from '../server/src/core/stateMachine/transitionTable';

const docPath = resolve('docs/03-System-Architecture.md');
const startMarker = '<!-- BEGIN GENERATED STATE MACHINE -->';
const endMarker = '<!-- END GENERATED STATE MACHINE -->';

const generated = renderStateMachine();
const current = readFileSync(docPath, 'utf8');
const start = current.indexOf(startMarker);
const end = current.indexOf(endMarker);
if (start < 0 || end < start) {
  throw new Error(`Missing generated-section markers in ${docPath}`);
}

const updated = `${current.slice(0, start + startMarker.length)}\n\n${generated}\n\n${current.slice(end)}`;
writeFileSync(docPath, updated);
console.log(`Generated ${Object.keys(transitionTable).length} transition rows in ${docPath}`);

function renderStateMachine(): string {
  const definitions = Object.values(transitionTable);
  const diagram = [
    '## Lifecycle state diagram',
    '',
    '```mermaid',
    'stateDiagram-v2',
    ...definitions.map((entry) => {
      const from = entry.from === 'none' ? '[*]' : entry.from;
      return `${from} --> ${entry.to} : ${entry.key}`;
    }),
    '```',
  ].join('\n');

  const tableHeader = [
    '## Transition policy table',
    '',
    '| Key | From → to | Roles and provider scope | Required facts | Evidence fields | Closure | Owner after | Due-at rule | Notification | Event |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ].join('\n');
  const rows = definitions.map((entry) => {
    const providerRules = entry.allowedRoles
      .map((role) => `${role}: ${entry.providerRules[role] ?? 'UNSPECIFIED'}`)
      .join('<br>');
    const owner = entry.ownerAfter.kind === 'NONE'
      ? 'None'
      : entry.ownerAfter.kind === 'USER_FROM_EVIDENCE'
        ? `User from evidence.${entry.ownerAfter.evidenceField} (otherwise unassigned)`
        : `${entry.ownerAfter.role} queue at ${entry.ownerAfter.provider.toLowerCase()} provider`;
    const due = entry.dueAtRule
      ? `${entry.dueAtRule.slaKey} from ${entry.dueAtRule.base.toLowerCase()}`
      : 'None';
    return `| ${entry.key} | ${entry.from} → ${entry.to} | ${providerRules} | ${entry.requiredFacts.join(', ') || 'None'} | ${entry.evidenceFields.join(', ') || 'None'} | ${entry.closureReason ?? '—'} | ${owner} | ${due} | ${entry.notificationTemplate ?? 'None'} | ${entry.eventType} |`;
  });

  return [diagram, tableHeader, ...rows].join('\n');
}
