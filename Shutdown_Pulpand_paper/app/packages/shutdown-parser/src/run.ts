import { parseShutdownForm } from './index.js';

const r = await parseShutdownForm(process.argv[2]);
console.log(r.sheet, 'header', r.headerRow, 'groups', r.groups.length, 'jobs', r.jobs.length, 'deps', r.dependencies.length);
console.log('window', r.window, 'extent', r.extent);
const by: Record<string, number> = {};
for (const j of r.jobs) by[j.phase + '/' + j.type] = (by[j.phase + '/' + j.type] ?? 0) + 1;
console.log(by);
console.log('issues', r.issues.length);
for (const i of r.issues) console.log(i.row, i.code, i.severity, i.message.slice(0, 90));
const probe = (process.argv[3] ?? '14,15,23,24,31,164,165,169,170,242').split(',').map(Number);
for (const j of r.jobs.filter((j) => probe.includes(j.sourceRow)))
  console.log(j.sourceRow, j.phase, j.type, 'p', j.parentRow, 'd', j.depth, j.plannedStart, j.plannedFinish, j.durationHrs, j.teams, j.priority, j.description.slice(0, 30));
console.log(r.jobs.filter((j) => j.note).map((j) => [j.sourceRow, j.note]));
