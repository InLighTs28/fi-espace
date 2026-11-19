// Copie le site dans une application (mobile) : uniquement les fichiers publics, jamais le dossier private/.
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
if (!target) { console.error('Usage : node scripts/copy-web.mjs <dossier cible>'); process.exit(1); }
const PUBLIC = ['index.html', 'theme.css', 'app.js', 'config.js', 'manifest.webmanifest', 'icons'];

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const item of PUBLIC) {
  if (!existsSync(join(root, item))) { console.error(`Fichier manquant : ${item}`); process.exit(1); }
  cpSync(join(root, item), join(target, item), { recursive: true });
}
if (existsSync(join(target, 'private'))) { console.error('Refus : le dossier private/ ne doit jamais être embarqué.'); process.exit(1); }
console.log(`Site copié dans ${target} (${PUBLIC.join(', ')})`);
