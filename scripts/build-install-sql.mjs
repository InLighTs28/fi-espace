// Assemble les migrations en un seul fichier à coller dans Supabase → SQL Editor.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const db = join(dirname(fileURLToPath(import.meta.url)), '..', 'database');
const files = readdirSync(db).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort();

const header = [
  '-- FI espace — INSTALLATION COMPLÈTE (généré par scripts/build-install-sql.mjs, ne pas modifier à la main).',
  `-- Contient, dans l'ordre : ${files.join(', ')}.`,
  '-- Supabase → SQL Editor → New query → coller tout ce fichier → Run. À exécuter UNE seule fois :',
  "-- tout s'applique d'un bloc (ou rien en cas d'erreur), et le script refuse de tourner sur une base déjà installée.",
  '',
  'begin;',
  '',
  'do $guard$ begin',
  "  if to_regclass('public.org_roles') is not null then",
  "    raise exception 'FI espace est déjà installé sur cette base : rien n''a été modifié.';",
  '  end if;',
  'end $guard$;',
  '',
].join('\n');

const body = files.map(f => `-- ════════════════ ${f} ════════════════\n${readFileSync(join(db, f), 'utf8').trim()}\n`).join('\n');
writeFileSync(join(db, 'INSTALLATION-COMPLETE.sql'), `${header}\n${body}\ncommit;\n`);
console.log(`database/INSTALLATION-COMPLETE.sql (${files.length} migrations)`);
