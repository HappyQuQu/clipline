import { SETTINGS_FIELDS } from '../domain.js';
export const initialSettings = { interval: '5', skipRecent: '30', autoNext: true, skipGaps: true, defaultMode: 'fast', maxDuration: '10080', concurrency: '2', timezone: 'Asia/Shanghai' };
const stringFields = new Set(['interval', 'skipRecent', 'maxDuration', 'concurrency']);
export function groupValues(group, values) {
  return Object.fromEntries(SETTINGS_FIELDS[group].map(field => [field, field === 'interval' && values[field] === 'manual' ? null : stringFields.has(field) ? Number(values[field]) : values[field]]));
}
export function flatGroup(values) {
  return Object.fromEntries(Object.entries(values).map(([field, value]) => [field, field === 'interval' && value === null ? 'manual' : stringFields.has(field) ? String(value) : value]));
}
export function dirtyGroup(draft, saved, group) { return SETTINGS_FIELDS[group].some(field => draft[field] !== saved[field]); }
export function reconcileSettings(current, response) {
  const saved = { ...current.saved, timezone: response.deployment.timezone }, draft = { ...current.draft, timezone: response.deployment.timezone };
  const revisions = { ...current.revisions }, draftRevisions = { ...current.draftRevisions };
  for (const [group, row] of Object.entries(response.groups)) {
    if (!SETTINGS_FIELDS[group] || (revisions[group] || 0) > row.revision) continue;
    const clean = !dirtyGroup(current.draft, current.saved, group);
    Object.assign(saved, flatGroup(row.values)); revisions[group] = row.revision;
    if (clean) { Object.assign(draft, flatGroup(row.values)); draftRevisions[group] = row.revision; }
  }
  return { ...current, saved, draft, revisions, draftRevisions, deployment: response.deployment, defaults: Object.assign({}, initialSettings, ...Object.values(response.defaults || {}).map(flatGroup)), loaded: true };
}
export function acceptSettings(current, group, row) {
  if ((current.revisions[group] || 0) > row.revision) return { ...current, draftRevisions: { ...current.draftRevisions, [group]: row.revision } };
  const values = flatGroup(row.values);
  return { ...current, saved: { ...current.saved, ...values }, draft: { ...current.draft, ...values }, revisions: { ...current.revisions, [group]: row.revision }, draftRevisions: { ...current.draftRevisions, [group]: row.revision } };
}
