// FI espace — Edge Function « send-reminders ».
// Envoie les rappels par e-mail aux responsables et adjoints.
//
// Deux façons de l'appeler :
//  1. Automatique (planificateur pg_cron, toutes les heures) : en-tête « x-cron-secret: <CRON_SECRET> », corps {}.
//     - rencontre dans les prochaines 24 h  → rappel à tous les comptes actifs de la FI ;
//     - tâche à échéance demain             → rappel à la personne à qui elle est attribuée ;
//     - suivi à faire demain                → rappel au tuteur du suivi ;
//     - dimanche à partir de 18 h           → récapitulatif avant le bilan de 20 h.
//  2. Depuis l'application (jeton de session) :
//     - { organization_id, kind: "test" }                → e-mail de test à soi-même ;
//     - { organization_id, kind: "event", event_id }     → rappel immédiat d'une rencontre (responsables/admin).
//
// Chaque envoi est noté dans reminder_log pour ne jamais envoyer deux fois le même rappel.
// Préférences : table notification_prefs (absence de ligne = tout activé).
//
// Secrets à définir : RESEND_API_KEY, MAIL_FROM, CRON_SECRET, SITE_URL, ALLOWED_ORIGINS, (option) APP_TIMEZONE.
// Déploiement : supabase functions deploy send-reminders --no-verify-jwt
//   (la fonction vérifie elle-même le secret du planificateur ou la session de l'utilisateur).
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const SITE_URL = Deno.env.get("SITE_URL") ?? "";
const TZ = Deno.env.get("APP_TIMEZONE") ?? "Europe/Paris";
const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ?? SITE_URL)
  .split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Prefs = { event_reminders: boolean; task_reminders: boolean; weekly_digest: boolean };
type Person = { user_id: string; display_name: string | null; perms: Set<string> };
type Ev = { id: string; title: string; starts_at: string; location: string | null; notes: string | null; audience: string };

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// ───────── Outils ─────────
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const dayInTz = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const fmtWhen = (iso: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const fmtDay = (day: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${day}T12:00:00Z`));
const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function nowParts() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", hour: "2-digit", hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { weekday: p.weekday as string, hour: Number(p.hour) };
}
function isoWeek(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((+t - +y) / 864e5 + 1) / 7)).padStart(2, "0")}`;
}

const emailCache = new Map<string, string | null>();
async function emailOf(userId: string) {
  if (!emailCache.has(userId)) {
    const { data } = await admin.auth.admin.getUserById(userId);
    emailCache.set(userId, data?.user?.email ?? null);
  }
  return emailCache.get(userId)!;
}

function layout(title: string, bodyHtml: string, orgName: string) {
  const link = SITE_URL ? `<p style="margin:26px 0 0"><a href="${esc(SITE_URL)}" style="background:#0f7a55;color:#fff;text-decoration:none;padding:11px 18px;border-radius:9px;font-weight:600;display:inline-block">Ouvrir FI espace</a></p>` : "";
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f4efe2;font-family:Arial,Helvetica,sans-serif;color:#22302a">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="background:linear-gradient(120deg,#0c4a37,#0f7a55 55%,#1798a8);border-radius:16px 16px 0 0;padding:22px 26px;color:#fffdf2">
<div style="font-size:11px;letter-spacing:1px;color:#f7d98a;text-transform:uppercase">✝ ${esc(orgName)}</div>
<div style="font-size:21px;font-weight:700;margin-top:6px">${esc(title)}</div></div>
<div style="background:#fffdf8;border-radius:0 0 16px 16px;padding:22px 26px;font-size:14px;line-height:1.6">${bodyHtml}${link}
<p style="margin:26px 0 0;padding-top:14px;border-top:1px solid #eee5d3;color:#8a918b;font-size:11px">« Que tout se fasse avec amour. » — 1 Co 16, 14<br>Vous recevez ce message car vous êtes responsable dans cette FI. Réglez vos rappels dans FI espace → Mon compte.</p>
</div></div></body></html>`;
}

async function sendMail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY || !MAIL_FROM) throw new Error("Envoi d'e-mails non configuré (RESEND_API_KEY / MAIL_FROM)");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`Envoi refusé par le service d'e-mail (${res.status})`);
}

// Envoie une seule fois par (kind, ref_key, user) grâce à la contrainte unique du journal.
async function sendOnce(orgId: string, kind: string, refKey: string, userId: string, subject: string, html: string) {
  const to = await emailOf(userId);
  if (!to) return false;
  const { error } = await admin.from("reminder_log").insert({ organization_id: orgId, kind, ref_key: refKey, user_id: userId });
  if (error) return false; // déjà envoyé (doublon) ou erreur : on n'envoie pas
  try {
    await sendMail(to, subject, html);
    return true;
  } catch (e) {
    await admin.from("reminder_log").delete().match({ kind, ref_key: refKey, user_id: userId }); // permettra un nouvel essai
    throw e;
  }
}

async function loadPrefs(orgId: string) {
  const { data } = await admin.from("notification_prefs").select("user_id,event_reminders,task_reminders,weekly_digest").eq("organization_id", orgId);
  const map = new Map<string, Prefs>();
  for (const p of data ?? []) map.set(p.user_id, p);
  return (uid: string): Prefs => map.get(uid) ?? { event_reminders: true, task_reminders: true, weekly_digest: true };
}

// Comptes actifs de la FI avec l'union des permissions de leurs rôles.
async function loadPeople(orgId: string): Promise<Person[]> {
  const { data: accounts } = await admin.from("user_roles").select("user_id,display_name").eq("organization_id", orgId).eq("active", true);
  const { data: assigned } = await admin.from("account_roles").select("user_id, org_roles(permissions)").eq("organization_id", orgId);
  const perms = new Map<string, Set<string>>();
  for (const a of assigned ?? []) {
    const set = perms.get(a.user_id) ?? new Set<string>();
    // deno-lint-ignore no-explicit-any
    for (const p of ((a as any).org_roles?.permissions ?? []) as string[]) set.add(p);
    perms.set(a.user_id, set);
  }
  return (accounts ?? []).map((a) => ({ user_id: a.user_id, display_name: a.display_name, perms: perms.get(a.user_id) ?? new Set<string>() }));
}
const hasP = (p: Person, perm: string) => p.perms.has("administrator") || p.perms.has(perm);

// Mêmes règles que la base : l'équipe voit tout ; un membre voit les événements ouverts à tous et ceux où il est invité.
async function eventRecipients(ev: Ev, people: Person[]) {
  const team = people.filter((p) => hasP(p, "view_all_events") || hasP(p, "manage_events"));
  if (ev.audience === "all") return people;
  if (ev.audience === "team") return team;
  const { data } = await admin.from("event_participants").select("fi_members(user_id)").eq("event_id", ev.id);
  // deno-lint-ignore no-explicit-any
  const invited = new Set((data ?? []).map((d: any) => d.fi_members?.user_id).filter(Boolean));
  return people.filter((p) => invited.has(p.user_id) || team.includes(p));
}

function eventHtml(ev: { title: string; starts_at: string; location: string | null; notes: string | null }) {
  return `<p style="margin:0 0 6px"><b style="font-size:16px">${esc(ev.title)}</b></p>
<p style="margin:0">📅 ${esc(fmtWhen(ev.starts_at))}${ev.location ? `<br>📍 ${esc(ev.location)}` : ""}</p>
${ev.notes ? `<p style="margin:12px 0 0;color:#5d6862">${esc(ev.notes)}</p>` : ""}`;
}

// ───────── Envois automatiques pour une organisation ─────────
async function runOrg(org: { id: string; name: string }, sb: SupabaseClient) {
  const stats = { events: 0, tasks: 0, followups: 0, digests: 0 };
  const people = await loadPeople(org.id);
  if (!people.length) return stats;
  const prefs = await loadPrefs(org.id);
  const now = new Date();
  const today = dayInTz(now);
  const tomorrow = addDays(today, 1);

  // Rencontres dans les prochaines 24 h.
  const { data: events } = await sb.from("fi_events").select("id,title,starts_at,location,notes,audience").eq("organization_id", org.id)
    .gte("starts_at", now.toISOString()).lte("starts_at", new Date(+now + 24 * 3600e3).toISOString());
  for (const ev of (events ?? []) as Ev[]) {
    for (const p of await eventRecipients(ev, people)) {
      if (!prefs(p.user_id).event_reminders) continue;
      if (await sendOnce(org.id, "event", ev.id, p.user_id, `Rappel : ${ev.title}`, layout("Rencontre à venir", eventHtml(ev), org.name))) stats.events++;
    }
  }

  // Tâches à échéance demain.
  const { data: tasks } = await sb.from("tasks").select("id,title,description,assigned_to,due_at").eq("organization_id", org.id)
    .eq("due_at", tomorrow).neq("status", "done").not("assigned_to", "is", null);
  for (const t of tasks ?? []) {
    if (!people.some((p) => p.user_id === t.assigned_to) || !prefs(t.assigned_to).task_reminders) continue;
    const body = `<p style="margin:0">Votre tâche arrive à échéance <b>${esc(fmtDay(t.due_at))}</b> :</p><p style="margin:10px 0 0;font-size:16px"><b>${esc(t.title)}</b></p>${t.description ? `<p style="margin:6px 0 0;color:#5d6862">${esc(t.description)}</p>` : ""}`;
    if (await sendOnce(org.id, "task", `${t.id}:${t.due_at}`, t.assigned_to, `Échéance demain : ${t.title}`, layout("Tâche à terminer", body, org.name))) stats.tasks++;
  }

  // Suivis prévus demain.
  const { data: follows } = await sb.from("follow_ups").select("id,contact_label,next_action,owner_user_id,due_at").eq("organization_id", org.id)
    .eq("due_at", tomorrow).neq("status", "done").not("owner_user_id", "is", null);
  for (const f of follows ?? []) {
    if (!people.some((p) => p.user_id === f.owner_user_id) || !prefs(f.owner_user_id).task_reminders) continue;
    const body = `<p style="margin:0">Suivi prévu <b>${esc(fmtDay(f.due_at))}</b> :</p><p style="margin:10px 0 0"><b>${esc(f.contact_label)}</b> — ${esc(f.next_action)}</p>`;
    if (await sendOnce(org.id, "followup", `${f.id}:${f.due_at}`, f.owner_user_id, `Suivi à faire demain : ${f.contact_label}`, layout("Prendre des nouvelles", body, org.name))) stats.followups++;
  }

  // Dimanche soir : récapitulatif avant le bilan de 20 h.
  const { weekday, hour } = nowParts();
  if (weekday === "Sun" && hour >= 18) {
    const weekEnd = addDays(today, 7);
    const { data: nextEvents } = await sb.from("fi_events").select("id,title,starts_at,location,notes,audience").eq("organization_id", org.id)
      .gte("starts_at", now.toISOString()).lte("starts_at", new Date(+now + 7 * 864e5).toISOString()).order("starts_at");
    const { data: openTasks } = await sb.from("tasks").select("title,assigned_to,due_at").eq("organization_id", org.id).neq("status", "done");
    const { data: openFollows } = await sb.from("follow_ups").select("id").eq("organization_id", org.id).neq("status", "done").lte("due_at", weekEnd);
    const visibleTo = new Map<string, Set<string>>();
    for (const e of (nextEvents ?? []) as Ev[]) visibleTo.set(e.id, new Set((await eventRecipients(e, people)).map((p) => p.user_id)));
    for (const p of people) {
      if (!prefs(p.user_id).weekly_digest) continue;
      const eventsList = ((nextEvents ?? []) as Ev[]).filter((e) => visibleTo.get(e.id)?.has(p.user_id))
        .map((e) => `<li>${esc(fmtWhen(e.starts_at))} — ${esc(e.title)}</li>`).join("") || "<li>Aucune rencontre prévue pour vous.</li>";
      const mine = (openTasks ?? []).filter((t) => t.assigned_to === p.user_id);
      const late = (openTasks ?? []).filter((t) => t.due_at && t.due_at < today).length;
      const leader = hasP(p, "view_stats");
      const body = `<p style="margin:0">Bonsoir ${esc(p.display_name ?? "")}, voici les repères avant le bilan de 20 h.</p>
<p style="margin:16px 0 4px"><b>Cette semaine</b></p><ul style="margin:0;padding-left:20px">${eventsList}</ul>
<p style="margin:16px 0 4px"><b>Vos tâches ouvertes (${mine.length})</b></p><ul style="margin:0;padding-left:20px">${mine.map((t) => `<li>${esc(t.title)}${t.due_at ? ` — ${esc(fmtDay(t.due_at))}` : ""}</li>`).join("") || "<li>Rien en attente 🙏</li>"}</ul>
${leader ? `<p style="margin:16px 0 0">Pour toute la FI : <b>${(openTasks ?? []).length}</b> tâches ouvertes dont <b>${late}</b> en retard, <b>${(openFollows ?? []).length}</b> suivis à mener d'ici 7 jours.</p>` : ""}`;
      if (await sendOnce(org.id, "digest", isoWeek(today), p.user_id, "Récapitulatif avant le bilan du dimanche", layout("Bilan de la semaine", body, org.name))) stats.digests++;
    }
  }
  return stats;
}

// ───────── Point d'entrée ─────────
function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED.includes(origin) ? origin : ALLOWED[0] ?? "";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Méthode non autorisée" });

  // 1) Planificateur
  const cronHeader = req.headers.get("x-cron-secret");
  if (cronHeader !== null) {
    if (!CRON_SECRET || cronHeader !== CRON_SECRET) return reply(401, { error: "Secret invalide" });
    const { data: orgs, error } = await admin.from("organizations").select("id,name");
    if (error) return reply(500, { error: "Lecture des organisations impossible" });
    const results: Record<string, unknown> = {};
    for (const org of orgs ?? []) {
      try { results[org.id] = await runOrg(org, admin); } catch (e) { results[org.id] = { error: String((e as Error).message) }; }
    }
    return reply(200, { ok: true, results });
  }

  // 2) Appel depuis l'application
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return reply(401, { error: "Connexion requise" });
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: who } = await asCaller.auth.getUser();
  if (!who?.user) return reply(401, { error: "Session invalide ou expirée" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { error: "Requête invalide" }); }
  const orgId = String(body.organization_id ?? "");
  if (!UUID_RE.test(orgId)) return reply(400, { error: "Organisation invalide" });
  const { data: role } = await asCaller.rpc("current_fi_role", { target_org: orgId });
  if (!role) return reply(403, { error: "Accès refusé" });
  const { data: org } = await admin.from("organizations").select("id,name").eq("id", orgId).single();
  if (!org) return reply(404, { error: "Organisation introuvable" });

  try {
    if (body.kind === "test") {
      const to = who.user.email;
      if (!to) return reply(400, { error: "Aucune adresse e-mail sur ce compte" });
      await sendMail(to, "Test des rappels FI espace", layout("Les rappels fonctionnent ✓",
        "<p style=\"margin:0\">Ce message confirme que vous recevrez les rappels de rencontres, de tâches et le récapitulatif du dimanche.</p>", org.name));
      return reply(200, { ok: true, sent: 1 });
    }
    if (body.kind === "event") {
      const { data: allowed } = await asCaller.rpc("has_perm", { target_org: orgId, perm: "send_reminders" });
      if (allowed !== true) return reply(403, { error: "Votre rôle ne permet pas d'envoyer des rappels" });
      const eventId = String(body.event_id ?? "");
      if (!UUID_RE.test(eventId)) return reply(400, { error: "Rencontre invalide" });
      // Lecture avec les droits de l'appelant : la RLS garantit que la rencontre est bien de sa FI.
      const { data: ev } = await asCaller.from("fi_events").select("id,title,starts_at,location,notes,audience").eq("id", eventId).eq("organization_id", orgId).single();
      if (!ev) return reply(404, { error: "Rencontre introuvable" });
      const people = await loadPeople(orgId);
      const prefs = await loadPrefs(orgId);
      const stamp = new Date().toISOString().slice(0, 13); // au plus un rappel manuel par heure et par personne
      let sent = 0;
      for (const p of await eventRecipients(ev as Ev, people)) {
        if (!prefs(p.user_id).event_reminders) continue;
        if (await sendOnce(orgId, "manual", `${ev.id}:${stamp}`, p.user_id, `Rappel : ${ev.title}`, layout("Rappel de rencontre", eventHtml(ev), org.name))) sent++;
      }
      return reply(200, { ok: true, sent });
    }
    return reply(400, { error: "Type de rappel inconnu" });
  } catch (e) {
    return reply(502, { error: (e as Error).message });
  }
});
