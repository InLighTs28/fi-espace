// Génère private/import-fi.sql à partir de private/donnees-fi.js : les membres réels, le planning,
// les suivis et le plan d'action, à importer UNE fois dans Supabase après bootstrap_first_admin.
// Le fichier produit reste dans private/ (exclu de Git) : il ne doit jamais être publié.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { window: {} };
vm.runInNewContext(readFileSync(join(root, 'private', 'donnees-fi.js'), 'utf8'), sandbox);
const data = sandbox.window.FI_LOCAL_DATA;
const orgName = process.argv[2] || data.orgName || 'FI';
const q = v => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const ts = (d, t) => `'${d} ${t || '19:00'}:00 Europe/Paris'::timestamptz`;

const lines = [
  '-- FI espace — import des données réelles (généré par scripts/seed-from-private.mjs). NE PAS PUBLIER.',
  `-- À exécuter UNE fois dans Supabase → SQL Editor, après : select public.bootstrap_first_admin('…', ${q(orgName)}, '…');`,
  'do $import$',
  'declare org uuid;',
  'begin',
  `  select id into org from public.organizations where name = ${q(orgName)} order by created_at limit 1;`,
  `  if org is null then raise exception 'Organisation % introuvable : lancez d''abord bootstrap_first_admin', ${q(orgName)}; end if;`,
  "  if exists (select 1 from public.fi_members where organization_id = org) then raise exception 'Des membres existent déjà : import déjà fait ?'; end if;",
  '',
  '  insert into public.fi_members (organization_id, display_name, status, availability) values',
  data.members.map(m => `    (org, ${q(m.name)}, ${q(m.status || 'active')}, ${q(m.availability)})`).join(',\n') + ';',
  '',
  '  insert into public.fi_events (organization_id, title, starts_at, location, notes, audience) values',
  data.events.map(e => `    (org, ${q(e.title)}, ${ts(e.date, e.time)}, ${q(e.location)}, ${q(e.notes)}, ${q(e.audience || 'all')})`).join(',\n') + ';',
  '',
  '  insert into public.follow_ups (organization_id, contact_label, next_action, due_at, status) values',
  data.followups.map(f => `    (org, ${q(f.contact)}, ${q(f.action)}, ${f.due ? `'${f.due}'` : 'null'}, ${q(f.status || 'open')})`).join(',\n') + ';',
  '',
  '  insert into public.tasks (organization_id, title, description, due_at, status) values',
  data.tasks.map(t => `    (org, ${q(t.title)}, ${q(t.description)}, ${t.due ? `'${t.due}'` : 'null'}, ${q(t.status || 'todo')})`).join(',\n') + ';',
  '',
  `  raise notice 'Import terminé : % membres, % événements, % suivis, % tâches', ${data.members.length}, ${data.events.length}, ${data.followups.length}, ${data.tasks.length};`,
  'end',
  '$import$;',
  '',
  "-- Ensuite : invitez chaque responsable et chaque membre depuis Administration → Inviter (choisir sa fiche membre),",
  "-- puis attribuez tâches et suivis à chacun depuis l'application.",
];
writeFileSync(join(root, 'private', 'import-fi.sql'), lines.join('\n') + '\n');
console.log(`private/import-fi.sql : ${data.members.length} membres, ${data.events.length} événements, ${data.followups.length} suivis, ${data.tasks.length} tâches (organisation « ${orgName} »)`);
