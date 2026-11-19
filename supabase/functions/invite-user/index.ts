// FI espace — Edge Function « invite-user ».
// Invite une personne par e-mail (responsable, adjoint ou membre), lui attribue un ou plusieurs rôles
// de l'organisation et, si demandé, relie le compte à une fiche membre (accès « espace membre »).
//
// Sécurité :
// - La clé service_role n'existe QUE ici, dans l'environnement serveur de Supabase
//   (variable SUPABASE_SERVICE_ROLE_KEY fournie automatiquement). Elle n'est jamais envoyée au navigateur.
// - L'appelant est identifié par son jeton de session, puis la base vérifie qu'il est
//   administrateur de l'organisation (fonction SQL is_fi_admin, mêmes règles que la RLS).
//
// Variables à définir (Edge Functions → Secrets) :
//   SITE_URL         URL publique de l'application (lien de l'e-mail d'invitation)
//   ALLOWED_ORIGINS  origines autorisées, séparées par des virgules (ex. https://fi.exemple.org)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") ?? "";
const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ?? SITE_URL)
  .split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return reply(401, { error: "Connexion requise" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { error: "Requête invalide" }); }

  const organizationId = String(body.organization_id ?? "");
  const email = String(body.email ?? "").trim().toLowerCase();
  const displayName = String(body.display_name ?? "").trim().slice(0, 80);
  const roleIds = Array.isArray(body.role_ids) ? [...new Set(body.role_ids.map(String))] : [];
  const memberId = body.member_id ? String(body.member_id) : null;
  if (!UUID_RE.test(organizationId)) return reply(400, { error: "Organisation invalide" });
  if (!EMAIL_RE.test(email) || email.length > 254) return reply(400, { error: "Adresse e-mail invalide" });
  if (!roleIds.length || roleIds.length > 20 || !roleIds.every((id) => UUID_RE.test(id))) return reply(400, { error: "Choisissez au moins un rôle" });
  if (memberId && !UUID_RE.test(memberId)) return reply(400, { error: "Membre invalide" });
  if (!displayName) return reply(400, { error: "Nom affiché requis" });

  // 1) Qui appelle ? (client « utilisateur » : soumis à la RLS)
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: who, error: whoErr } = await asCaller.auth.getUser();
  if (whoErr || !who?.user) return reply(401, { error: "Session invalide ou expirée" });

  // 2) Est-il administrateur de cette organisation ? (vérifié par la base)
  const { data: isAdmin, error: adminErr } = await asCaller.rpc("is_fi_admin", { target_org: organizationId });
  if (adminErr) return reply(500, { error: "Vérification des droits impossible" });
  if (isAdmin !== true) return reply(403, { error: "Réservé aux administrateurs de cette FI" });

  // 3) Invitation (client « service » : uniquement après la vérification ci-dessus)
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // Les rôles (et le membre éventuel) doivent appartenir à cette organisation.
  const { data: roles } = await admin.from("org_roles").select("id").eq("organization_id", organizationId).in("id", roleIds);
  if ((roles ?? []).length !== roleIds.length) return reply(400, { error: "Rôle inconnu dans cette FI" });
  if (memberId) {
    const { data: member } = await admin.from("fi_members").select("id,user_id").eq("organization_id", organizationId).eq("id", memberId).maybeSingle();
    if (!member) return reply(400, { error: "Membre introuvable dans cette FI" });
    if (member.user_id) return reply(409, { error: "Ce membre a déjà un compte" });
  }

  let userId: string | null = null;
  let outcome: "invited" | "existing" = "invited";
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: SITE_URL || undefined,
    data: { display_name: displayName },
  });

  if (invited?.user) {
    userId = invited.user.id;
  } else {
    // Compte déjà existant (ex. responsable d'une autre FI) : on lui ajoute simplement le rôle.
    const exists = inviteErr && (inviteErr.status === 422 || /already|registered|exists/i.test(inviteErr.message));
    if (!exists) return reply(502, { error: "L'invitation n'a pas pu être envoyée" });
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) return reply(502, { error: "Recherche du compte impossible" });
      const found = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
      if (found) userId = found.id;
      if (data.users.length < 1000) break;
    }
    if (!userId) return reply(502, { error: "Compte introuvable" });
    outcome = "existing";
  }
  if (userId === who.user.id) return reply(400, { error: "Vous ne pouvez pas modifier votre propre rôle par invitation" });

  const { error: memberErr } = await admin.from("user_roles").upsert({
    user_id: userId,
    organization_id: organizationId,
    active: true,
    display_name: displayName,
    email,
    invited_by: who.user.id,
  }, { onConflict: "user_id,organization_id" });
  if (memberErr) return reply(500, { error: "Création de l'accès impossible" });

  const { error: roleErr } = await admin.from("account_roles").upsert(
    roleIds.map((role_id) => ({ user_id: userId, organization_id: organizationId, role_id })),
    { onConflict: "user_id,role_id", ignoreDuplicates: true },
  );
  if (roleErr) return reply(500, { error: "Attribution des rôles impossible" });

  if (memberId) {
    const { error: linkErr } = await admin.from("fi_members").update({ user_id: userId })
      .eq("organization_id", organizationId).eq("id", memberId).is("user_id", null);
    if (linkErr) return reply(500, { error: "Lien avec la fiche membre impossible" });
  }

  return reply(200, { status: outcome, user_id: userId });
});
