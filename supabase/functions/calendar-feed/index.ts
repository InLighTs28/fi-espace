// FI espace — Edge Function « calendar-feed » : agenda personnel au format iCalendar (.ics).
// L'application Agenda du téléphone (iPhone, Android/Google Agenda, Outlook…) s'abonne à
//   https://<projet>.supabase.co/functions/v1/calendar-feed?token=<lien secret>
// et se met à jour toute seule. Le lien secret est propre à chaque compte (table calendar_tokens) ;
// il ne donne accès qu'aux événements que ce compte peut voir, et peut être renouvelé depuis « Mon compte ».
// Déploiement : supabase functions deploy calendar-feed --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (s: unknown) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
// Les lignes iCalendar ne doivent pas dépasser 75 octets : on replie les longues lignes.
const fold = (line: string) => {
  const out: string[] = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 74) {
    let cut = 74;
    while (new TextEncoder().encode(rest.slice(0, cut)).length > 74) cut--;
    out.push(rest.slice(0, cut));
    rest = " " + rest.slice(cut);
  }
  out.push(rest);
  return out.join("\r\n");
};

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Méthode non autorisée", { status: 405 });
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!UUID_RE.test(token)) return new Response("Lien d'agenda invalide", { status: 400 });

  const { data, error } = await admin.rpc("calendar_feed_events", { feed_token: token });
  if (error) return new Response("Agenda momentanément indisponible", { status: 503 });

  const events = (data ?? []) as Array<{ id: string; title: string; starts_at: string; ends_at: string | null; location: string | null; notes: string | null; org_name: string }>;
  const now = stamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FI espace//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${text(events[0]?.org_name ?? "FI espace")}`, "X-WR-TIMEZONE:Europe/Paris",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of events) {
    const start = new Date(e.starts_at);
    const end = e.ends_at ? new Date(e.ends_at) : new Date(+start + 90 * 60e3);
    lines.push("BEGIN:VEVENT", `UID:${e.id}@fi-espace`, `DTSTAMP:${now}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${text(e.title)}`);
    if (e.location) lines.push(`LOCATION:${text(e.location)}`);
    if (e.notes) lines.push(`DESCRIPTION:${text(e.notes)}`);
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${text(e.title)}`, "TRIGGER:-PT2H", "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");

  // Lien inconnu ou révoqué : agenda vide (on ne révèle pas si le lien a existé).
  return new Response(lines.map(fold).join("\r\n") + "\r\n", {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=900", "Content-Disposition": 'inline; filename="fi-espace.ics"' },
  });
});
