/* FI espace — logique de l'application.
 *
 * Deux modes :
 *  - Démonstration : aucune configuration Supabase (ou ?demo dans l'URL). Données fictives en mémoire,
 *    le sélecteur en haut permet de prendre la place d'un compte de démonstration (aucune valeur de sécurité).
 *  - Connecté : Supabase Auth (e-mail + mot de passe, comptes sur invitation) + base PostgreSQL.
 *
 * Droits « façon Discord » : chaque compte a un ou plusieurs rôles ; chaque rôle a une couleur, une position
 * et des permissions. L'interface masque ce qu'un compte ne peut pas faire, par confort ; la sécurité réelle
 * est appliquée par la base (RLS + triggers, voir database/) et par les fonctions serveur.
 */
(() => {
  'use strict';

  // ───────────────────────── Utilitaires ─────────────────────────
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nn = v => (v === '' || v === undefined ? null : v);
  const clone = v => JSON.parse(JSON.stringify(v));
  const safeGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const safeColor = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#8a918b');

  const PERMS = {
    administrator: ['Administrateur', 'Tous les droits, y compris les comptes et les rôles.'],
    manage_members: ['Gérer les membres', 'Ajouter, modifier, photos et tuteurs.'],
    manage_attendance: ['Gérer les présences', 'Faire l’appel à chaque rencontre.'],
    manage_followups: ['Gérer les suivis', 'Créer et suivre les prises de nouvelles.'],
    manage_events: ['Gérer le planning', 'Créer, modifier et cibler les événements.'],
    manage_tasks: ['Gérer les tâches', 'Créer et attribuer toutes les tâches.'],
    view_all_events: ['Voir tous les événements', 'Y compris ceux réservés à l’équipe.'],
    view_stats: ['Voir les statistiques', 'Graphiques et export des présences.'],
    send_reminders: ['Envoyer des rappels', 'Bouton « ✉ Rappel » du planning.'],
  };
  const LEADER_PERMS = ['manage_members', 'manage_attendance', 'manage_followups', 'manage_events', 'manage_tasks', 'view_all_events', 'view_stats', 'send_reminders'];
  const MEMBER_STATUS = { active: 'Actif', occasional: 'Occasionnel', to_contact: 'À recontacter', former: 'Ancien membre' };
  const FOLLOW_STATUS = { open: 'À planifier', planned: 'Planifié', done: 'Terminé' };
  const TASK_STATUS = { todo: 'À faire', in_progress: 'En cours', done: 'Terminé' };
  const AUDIENCES = { all: 'Tout le monde (membres compris)', team: 'Équipe uniquement', selected: 'Membres choisis' };
  const VIEW_LABELS = { dashboard: 'Vue d’ensemble', members: 'Membres', attendance: 'Présences', followups: 'Suivis & contacts', calendar: 'Planning FI', tasks: 'Tâches', stats: 'Statistiques', account: 'Mon compte', admin: 'Administration' };
  const DEFAULT_PREFS = { event_reminders: true, task_reminders: true, weekly_digest: true };
  const WEEKDAYS = [[1, 'Lundi'], [2, 'Mardi'], [3, 'Mercredi'], [4, 'Jeudi'], [5, 'Vendredi'], [6, 'Samedi'], [0, 'Dimanche']];
  // Palette des graphiques (validée daltonisme) : terminé, en cours, à faire.
  const TASK_COLORS = { done: '#0f7a55', in_progress: '#d9932b', todo: '#5b7fd6' };
  const ROLE_SWATCHES = ['#d9932b', '#0f7a55', '#1798a8', '#5b7fd6', '#7a5cc4', '#c2482a', '#e0628a', '#8a918b'];

  const pad = n => String(n).padStart(2, '0');
  const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = s => new Date(`${s}T12:00:00`);
  const fmtMon = d => d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '').toUpperCase();
  const fmtTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const fmtDayMonth = d => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const fmtLongDay = d => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const initials = name => {
    const w = String(name || '?').trim().split(/\s+/).filter(Boolean);
    return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).toUpperCase();
  };

  // ───────────────────────── Effets visuels (décoratifs) ─────────────────────────
  const motionQuery = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const calm = () => motionQuery.matches;
  const HUES = [155, 42, 14, 188, 265, 340, 120, 28];
  const hueFor = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return HUES[h % HUES.length]; };

  function decorate() {
    $$('.mini-avatar').forEach(el => el.style.setProperty('--h', hueFor(el.textContent)));
  }

  function addSparks(host, count) {
    if (!host || host.querySelector('.spark')) return;
    for (let i = 0; i < count; i++) {
      const s = document.createElement('span');
      s.className = 'spark';
      s.style.cssText = `left:${(Math.random() * 92 + 4).toFixed(1)}%;top:${(Math.random() * 70 + 20).toFixed(1)}%;--s:${(Math.random() * 6 + 3).toFixed(1)}px;--d:${(Math.random() * 3 + 3.5).toFixed(2)}s;--delay:${(Math.random() * 5).toFixed(2)}s`;
      host.appendChild(s);
    }
  }

  function countUp(el) {
    const node = [...el.childNodes].find(n => n.nodeType === 3 && /^\s*\d+\s*$/.test(n.textContent));
    if (!node || calm()) return;
    const target = Number(node.textContent);
    if (!target) return;
    const t0 = performance.now();
    const step = t => {
      const p = Math.min(1, (t - t0) / 800);
      node.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function celebrate(el) {
    if (calm() || !el?.getBoundingClientRect) return;
    const r = el.getBoundingClientRect();
    const colors = ['#17a673', '#1798a8', '#e2b24a', '#f7d98a', '#ee7651', '#e0628a', '#7a5cc4'];
    for (let i = 0; i < 22; i++) {
      const c = document.createElement('i');
      const angle = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 70;
      c.className = 'confetti';
      c.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;background:${colors[i % colors.length]};--x:${Math.cos(angle) * dist}px;--y:${Math.sin(angle) * dist - 20}px;--r:${Math.random() * 540 - 270}deg`;
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 1000);
    }
  }

  // ───────────────────────── Configuration ─────────────────────────
  const cfg = window.FI_CONFIG || {};
  const forceDemo = new URLSearchParams(location.search).has('demo');
  const configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const LIVE = configured && !forceDemo;

  // Paramètres des liens e-mail (invitation, réinitialisation), lus avant que supabase-js ne nettoie l'URL.
  const hashParams = new URLSearchParams(location.hash.slice(1));
  const authLinkType = hashParams.get('type');
  const authLinkError = hashParams.get('error_description');

  function isSecretKey(k) {
    if (/^sb_secret_/.test(k)) return true;
    try {
      const payload = JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload.role === 'service_role';
    } catch { return false; }
  }

  let sb = null;
  const emptyData = () => ({
    perms: new Set(), myRoleIds: [], myMemberId: null, roles: [], people: [], members: [], events: [], participants: {},
    attendance: [], followups: [], tasks: [], photoUrls: {}, prefs: { ...DEFAULT_PREFS },
  });
  const state = {
    userId: null, email: '', displayName: '', orgId: null, orgName: '', memberships: [],
    ...emptyData(), attEventId: null, view: 'dashboard', ready: false,
  };

  // ───────────────────────── Permissions ─────────────────────────
  const isAdmin = () => state.perms.has('administrator');
  const can = p => isAdmin() || state.perms.has(p);
  const isStaff = () => state.perms.size > 0;
  const seesMembers = () => can('manage_members') || can('manage_attendance') || can('manage_followups') || can('view_stats');
  const seesAllEvents = () => can('view_all_events') || can('manage_events');
  const VIEW_RULES = { members: seesMembers, attendance: () => can('manage_attendance'), followups: () => can('manage_followups'), stats: () => can('view_stats'), admin: isAdmin };
  const allowedView = v => (VIEW_RULES[v] ? VIEW_RULES[v]() : true);
  const sortedRoles = () => [...state.roles].sort((a, b) => b.position - a.position || a.name.localeCompare(b.name));
  const rolesOf = ids => sortedRoles().filter(r => (ids || []).includes(r.id));
  const topRole = ids => rolesOf(ids)[0] || null;

  // ───────────────────────── Données de démonstration (fictives) ─────────────────────────
  let demo = null;
  let demoSeq = 100;
  const DEMO_USERS = { admin: 'demo-admin', fi_leader: 'demo-marie', deputy: 'demo-thomas', member: 'demo-camille' };

  function buildDemo() {
    const today = startOfToday();
    const nextTue = new Date(today); nextTue.setDate(today.getDate() + ((2 - today.getDay() + 7) % 7));
    const at = (days, h = 19, m = 0) => { const d = new Date(nextTue); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d.toISOString(); };
    const day = n => { const d = new Date(today); d.setDate(d.getDate() + n); return isoDate(d); };
    const roles = [
      { id: 'r-admin', name: 'Administrateur', color: '#d9932b', position: 40, permissions: ['administrator'], system_key: 'admin' },
      { id: 'r-leader', name: 'Responsable FI', color: '#0f7a55', position: 30, permissions: [...LEADER_PERMS], system_key: 'fi_leader' },
      { id: 'r-deputy', name: 'Responsable adjoint', color: '#1798a8', position: 20, permissions: ['view_all_events'], system_key: 'deputy' },
      { id: 'r-member', name: 'Membre', color: '#8a918b', position: 10, permissions: [], system_key: 'member' },
    ];
    const people = [
      { user_id: 'demo-admin', display_name: 'Admin Démo', email: 'admin@exemple.test', role_ids: ['r-admin'], member_id: null, active: true },
      { user_id: 'demo-marie', display_name: 'Marie', email: 'marie@exemple.test', role_ids: ['r-leader'], member_id: null, active: true },
      { user_id: 'demo-thomas', display_name: 'Thomas', email: 'thomas@exemple.test', role_ids: ['r-deputy'], member_id: null, active: true },
      { user_id: 'demo-lea', display_name: 'Léa', email: 'lea@exemple.test', role_ids: ['r-deputy'], member_id: null, active: true },
      { user_id: 'demo-hugo', display_name: 'Hugo', email: 'hugo@exemple.test', role_ids: ['r-deputy'], member_id: null, active: true },
      { user_id: 'demo-camille', display_name: 'Camille Martin', email: 'camille@exemple.test', role_ids: ['r-member'], member_id: 'dm0', active: true },
    ];
    const members = [
      ['Camille Martin', 'Mardi soir · Week-end', 'active', 'demo-marie', 'demo-camille'],
      ['Hugo Bernard', 'Mardi soir', 'active', 'demo-marie', null],
      ['Léa Petit', 'À confirmer', 'active', 'demo-thomas', null],
      ['Noah Robert', 'Week-end', 'occasional', 'demo-thomas', null],
      ['Sarah Moreau', 'Mardi soir · Week-end', 'active', 'demo-marie', null],
      ['Elias Laurent', 'Mardi soir', 'to_contact', 'demo-marie', null],
      ['Inès Simon', 'À confirmer', 'active', 'demo-thomas', null],
    ].map(([display_name, availability, status, tutor_user_id, user_id], i) => ({ id: `dm${i}`, display_name, availability, status, tutor_user_id, user_id }));
    const events = [
      ['de-8', 'FI — rencontre hebdomadaire', at(-56), 'Salle habituelle', 'all'],
      ['de-7', 'FI — rencontre hebdomadaire', at(-49), 'Salle habituelle', 'all'],
      ['de-6', 'FI — rencontre hebdomadaire', at(-42), 'Salle habituelle', 'all'],
      ['de-5', 'FI — rencontre hebdomadaire', at(-35), 'Salle habituelle', 'all'],
      ['de-4', 'FI — rencontre hebdomadaire', at(-28), 'Salle habituelle', 'all'],
      ['de-3', 'FI — rencontre hebdomadaire', at(-21), 'Salle habituelle', 'all'],
      ['de-2', 'FI — rencontre hebdomadaire', at(-14), 'Salle habituelle', 'all'],
      ['de-1', 'FI — rencontre hebdomadaire', at(-7), 'Salle habituelle', 'all'],
      ['de0', 'FI — rencontre hebdomadaire', at(0), 'Salle habituelle', 'all'],
      ['deT', 'Réunion des responsables', at(2, 20, 30), 'En visio', 'team'],
      ['de1', 'FI — rencontre hebdomadaire', at(7), 'Salle habituelle', 'all'],
      ['de2', 'Sortie FI — activité collective', at(11, 14), 'Lieu à confirmer', 'selected'],
      ['de3', 'FI — rencontre hebdomadaire', at(14), 'Salle habituelle', 'all'],
      ['de4', 'FI — rencontre hebdomadaire', at(21), 'Salle habituelle', 'all'],
      ['de5', 'Temps convivial de fin d’année', at(25, 18, 30), 'Horaire à confirmer', 'all'],
    ].map(([id, title, starts_at, location, audience]) => ({ id, title, starts_at, ends_at: null, location, notes: null, audience }));
    // Présences fictives sur 8 rencontres (une ligne par membre, de la plus ancienne à la plus récente).
    const pattern = [[1, 1, 1, 0, 1, 1, 1, 1], [1, 1, 0, 1, 1, 0, 1, 1], [1, 0, 1, 1, 0, 1, 1, 0], [0, 1, 0, 0, 1, 0, 0, 0],
      [1, 1, 1, 1, 1, 1, 1, 1], [1, 0, 1, 0, 0, 0, 0, 0], [1, 1, 1, 1, 1, 1, 0, 1]];
    const attendance = [];
    ['de-8', 'de-7', 'de-6', 'de-5', 'de-4', 'de-3', 'de-2', 'de-1'].forEach((ev, j) => members.forEach((m, i) =>
      attendance.push({ event_id: ev, member_id: m.id, state: pattern[i][j] ? 'present' : 'absent' })));
    const followups = [
      ['Contact A.', 'Prendre des nouvelles et proposer un moment d’échange.', 'demo-marie', day(2), 'open'],
      ['Contact B.', 'Faire un suivi après la rencontre de groupe.', 'demo-thomas', day(5), 'planned'],
      ['Contact C.', 'Envoyer les informations pratiques demandées.', 'demo-marie', day(6), 'open'],
      ['Contact D.', 'Proposer une date pour reprendre contact.', 'demo-lea', day(9), 'open'],
      ['Contact E.', 'Prendre des nouvelles après la sortie.', 'demo-marie', day(-6), 'done'],
    ].map(([contact_label, next_action, owner_user_id, due_at, status], i) => ({ id: `df${i}`, contact_label, next_action, owner_user_id, due_at, status }));
    const tasks = [
      ['Confirmer la salle pour mardi', 'demo-marie', day(2), 'in_progress'],
      ['Préparer le déroulé de la rencontre', 'demo-thomas', day(4), 'todo'],
      ['Accueillir les nouveaux à l’entrée', 'demo-thomas', day(5), 'todo'],
      ['Partager le rappel de la sortie FI', 'demo-lea', day(6), 'todo'],
      ['Apporter le goûter pour la sortie', 'demo-camille', day(10), 'todo'],
      ['Mettre à jour la liste de présence', 'demo-marie', day(-2), 'done'],
      ['Vérifier le matériel de réunion', 'demo-hugo', day(-2), 'done'],
    ].map(([title, assigned_to, due_at, status], i) => ({ id: `dt${i}`, title, description: null, assigned_to, due_at, status }));
    return { roles, people, members, events, participants: { de2: ['dm0', 'dm4'] }, attendance, followups, tasks, photos: {}, prefs: {} };
  }

  function demoPermsOf(person) {
    const set = new Set();
    if (!person?.active) return set;
    demo.roles.filter(r => person.role_ids.includes(r.id)).forEach(r => r.permissions.forEach(p => set.add(p)));
    return set;
  }

  function setDemoAccount(key) {
    state.userId = DEMO_USERS[key];
    const me = demo.people.find(p => p.user_id === state.userId);
    state.displayName = me.display_name;
    state.email = me.email;
    state.orgName = 'FI de démonstration';
  }

  // Reproduit en mémoire ce que la base (RLS) laisse lire à ce compte.
  function loadDemo() {
    const me = demo.people.find(p => p.user_id === state.userId);
    state.perms = demoPermsOf(me);
    state.myRoleIds = [...me.role_ids];
    state.myMemberId = me.member_id;
    state.roles = clone(demo.roles);
    const all = seesAllEvents();
    const invitedTo = id => (demo.participants[id] || []).includes(state.myMemberId);
    state.events = clone(demo.events.filter(e => all || e.audience === 'all' || (e.audience === 'selected' && invitedTo(e.id))));
    state.participants = all ? clone(demo.participants)
      : Object.fromEntries(Object.keys(demo.participants).filter(invitedTo).map(id => [id, [state.myMemberId]]));
    state.tasks = clone(can('manage_tasks') ? demo.tasks : demo.tasks.filter(t => t.assigned_to === state.userId));
    state.members = seesMembers() ? clone(demo.members) : [];
    state.attendance = can('manage_attendance') || can('view_stats') ? clone(demo.attendance) : [];
    state.followups = can('manage_followups') ? clone(demo.followups) : [];
    state.people = seesMembers() || can('manage_tasks')
      ? clone(demo.people).filter(p => p.active || isAdmin()).map(p => (isAdmin() ? p : { ...p, email: null })) : [];
    state.photoUrls = seesMembers() ? { ...demo.photos } : {};
    state.prefs = { ...DEFAULT_PREFS, ...(demo.prefs[state.userId] || {}) };
  }

  const DEMO_TABLES = { fi_members: ['members', 'manage_members'], fi_events: ['events', 'manage_events'], follow_ups: ['followups', 'manage_followups'], tasks: ['tasks', 'manage_tasks'] };
  function denied() { return new Error('Action refusée : votre rôle ne permet pas cette modification.'); }
  function demoHasAdmin() {
    return demo.people.some(p => p.active && demo.roles.some(r => p.role_ids.includes(r.id) && r.permissions.includes('administrator')));
  }

  function demoSave(table, row) {
    const [key, perm] = DEMO_TABLES[table];
    const list = demo[key];
    if (table === 'tasks' && row.id && !can('manage_tasks')) {
      const t = list.find(x => x.id === row.id);
      const onlyStatus = Object.keys(row).every(k => k === 'id' || k === 'status');
      if (!t || t.assigned_to !== state.userId || !onlyStatus) throw denied();
    } else if (!can(perm)) throw denied();
    if (row.id) { Object.assign(list.find(x => x.id === row.id), row); return row.id; }
    const id = `d${++demoSeq}`;
    list.push({ audience: table === 'fi_events' ? 'all' : undefined, ...row, id });
    return id;
  }

  // ───────────────────────── Accès aux données ─────────────────────────
  function friendlyError(err) {
    const msg = String(err?.message || err || '');
    if (/row-level security|permission denied|42501/i.test(msg)) return 'Action refusée : votre rôle ne permet pas cette modification.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Connexion au serveur impossible. Vérifiez votre réseau.';
    if (/JWT|token.*expired/i.test(msg)) return 'Session expirée : reconnectez-vous.';
    if (/violates check constraint/i.test(msg)) return 'Texte trop long ou valeur invalide.';
    if (/duplicate key/i.test(msg)) return 'Ce nom existe déjà.';
    return msg || 'Une erreur est survenue.';
  }

  async function loadLive() {
    const org = state.orgId;
    const { data: perms, error: permErr } = await sb.rpc('my_permissions', { target_org: org });
    if (permErr) throw permErr;
    const next = { ...emptyData(), perms: new Set(perms || []) };
    state.perms = next.perms; // utilisé par can() ci-dessous
    const since = new Date(Date.now() - 120 * 864e5).toISOString();
    const reqs = {
      roles: sb.from('org_roles').select('id,name,color,position,permissions,system_key').eq('organization_id', org),
      myRoles: sb.from('account_roles').select('role_id').eq('organization_id', org).eq('user_id', state.userId),
      events: sb.from('fi_events').select('id,title,starts_at,ends_at,location,notes,audience').eq('organization_id', org).gte('starts_at', since).order('starts_at'),
      parts: sb.from('event_participants').select('event_id,member_id').eq('organization_id', org),
      tasks: sb.from('tasks').select('id,title,description,assigned_to,due_at,status').eq('organization_id', org).order('due_at', { ascending: true, nullsFirst: false }),
      me: sb.from('fi_members').select('id').eq('organization_id', org).eq('user_id', state.userId).maybeSingle(),
      prefs: sb.from('notification_prefs').select('event_reminders,task_reminders,weekly_digest').eq('organization_id', org).eq('user_id', state.userId).maybeSingle(),
    };
    if (seesMembers()) reqs.members = sb.from('fi_members').select('id,display_name,status,availability,tutor_user_id,photo_path,user_id').eq('organization_id', org).order('display_name');
    if (can('manage_followups')) reqs.followups = sb.from('follow_ups').select('id,contact_label,next_action,owner_user_id,due_at,status').eq('organization_id', org).order('due_at', { ascending: true, nullsFirst: false });
    if (seesMembers() || can('manage_tasks')) reqs.people = sb.rpc('list_org_people', { target_org: org });
    const keys = Object.keys(reqs);
    const results = await Promise.all(Object.values(reqs));
    const got = {};
    results.forEach((r, i) => { if (r.error) throw r.error; got[keys[i]] = r.data; });

    next.roles = got.roles || [];
    next.myRoleIds = (got.myRoles || []).map(r => r.role_id);
    next.events = got.events || [];
    (got.parts || []).forEach(p => { (next.participants[p.event_id] ||= []).push(p.member_id); });
    next.tasks = got.tasks || [];
    next.myMemberId = got.me?.id || null;
    next.prefs = { ...DEFAULT_PREFS, ...(got.prefs || {}) };
    next.members = got.members || [];
    next.followups = got.followups || [];
    next.people = (got.people || []).map(p => ({ ...p, role_ids: p.role_ids || [] }));

    if ((can('manage_attendance') || can('view_stats')) && next.events.length) {
      const { data, error } = await sb.from('attendance').select('event_id,member_id,state')
        .eq('organization_id', org).in('event_id', next.events.map(e => e.id));
      if (error) throw error;
      next.attendance = data || [];
    }
    // Photos : liens temporaires (1 h) vers le stockage privé.
    const withPhoto = next.members.filter(m => m.photo_path);
    if (withPhoto.length) {
      const { data } = await sb.storage.from('member-photos').createSignedUrls(withPhoto.map(m => m.photo_path), 3600);
      (data || []).forEach(d => {
        const m = withPhoto.find(x => x.photo_path === d.path);
        if (m && d.signedUrl) next.photoUrls[m.id] = d.signedUrl;
      });
    }
    Object.assign(state, next);
  }

  async function invokeFn(name, body) {
    const { data, error } = await sb.functions.invoke(name, { body: { organization_id: state.orgId, ...body } });
    if (error) {
      let detail = '';
      try { detail = (await error.context.json()).error; } catch { /* réponse non JSON */ }
      throw new Error(detail || 'Le serveur n’a pas pu traiter la demande.');
    }
    return data;
  }

  // Recadre en carré 320 px et ré-encode en JPEG : fichier léger, métadonnées (GPS…) supprimées.
  async function resizePhoto(file) {
    if (!/^image\//.test(file.type)) throw new Error('Choisissez une image (JPEG, PNG…).');
    if (file.size > 15e6) throw new Error('Image trop lourde (15 Mo maximum).');
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Image illisible.'));
        i.src = url;
      });
      const size = 320;
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement('canvas');
      c.width = c.height = size;
      c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
      return await new Promise(resolve => c.toBlob(resolve, 'image/jpeg', 0.85));
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const blobToDataUrl = blob => new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
  const check = ({ data, error }, emptyMsg) => { if (error) throw error; if (emptyMsg && (!data || !data.length)) throw new Error(emptyMsg); return data; };

  const api = {
    async load() { if (LIVE) await loadLive(); else loadDemo(); },

    async save(table, row) {
      if (!LIVE) return demoSave(table, row);
      const { id, ...fields } = row;
      const q = id
        ? sb.from(table).update(fields).eq('id', id).eq('organization_id', state.orgId).select('id')
        : sb.from(table).insert({ ...fields, organization_id: state.orgId }).select('id');
      return check(await q, 'Action refusée : votre rôle ne permet pas cette modification.')[0].id;
    },

    async remove(table, id) {
      if (!LIVE) {
        const [key, perm] = DEMO_TABLES[table];
        if (!can(perm)) throw denied();
        demo[key] = demo[key].filter(x => x.id !== id);
        if (table === 'fi_members') {
          demo.attendance = demo.attendance.filter(a => a.member_id !== id);
          delete demo.photos[id];
          demo.people.forEach(p => { if (p.member_id === id) p.member_id = null; });
        }
        if (table === 'fi_events') { demo.attendance = demo.attendance.filter(a => a.event_id !== id); delete demo.participants[id]; }
        return;
      }
      if (table === 'fi_members') await sb.storage.from('member-photos').remove([`${state.orgId}/${id}.jpg`]);
      check(await sb.from(table).delete().eq('id', id).eq('organization_id', state.orgId).select('id'), 'Suppression refusée.');
    },

    async setParticipants(eventId, memberIds) {
      if (!LIVE) {
        if (!can('manage_events')) throw denied();
        if (memberIds.length) demo.participants[eventId] = [...memberIds]; else delete demo.participants[eventId];
        return;
      }
      check(await sb.from('event_participants').delete().eq('event_id', eventId).eq('organization_id', state.orgId));
      if (memberIds.length) {
        check(await sb.from('event_participants').insert(memberIds.map(member_id => ({ event_id: eventId, member_id, organization_id: state.orgId }))));
      }
    },

    async saveAttendance(eventId, entries) {
      if (!LIVE) {
        if (!can('manage_attendance')) throw denied();
        demo.attendance = demo.attendance.filter(a => a.event_id !== eventId).concat(entries.map(e => ({ ...e, event_id: eventId })));
        return;
      }
      const rows = entries.map(e => ({ ...e, event_id: eventId, organization_id: state.orgId }));
      check(await sb.from('attendance').upsert(rows, { onConflict: 'event_id,member_id' }));
    },

    async setPhoto(memberId, blob) {
      if (!LIVE) {
        if (!can('manage_members')) throw denied();
        if (blob) demo.photos[memberId] = await blobToDataUrl(blob);
        else delete demo.photos[memberId];
        return;
      }
      const path = `${state.orgId}/${memberId}.jpg`;
      const bucket = sb.storage.from('member-photos');
      if (blob) {
        const { error } = await bucket.upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
        if (error) throw error;
      } else {
        await bucket.remove([path]);
      }
      await api.save('fi_members', { id: memberId, photo_path: blob ? path : null });
    },

    // Compte : nom, accès, rôles (ajouts avant retraits, pour ne jamais passer par « zéro admin »), fiche membre liée.
    async saveAccount(userId, { display_name, active, role_ids, member_id }) {
      const before = state.people.find(p => p.user_id === userId);
      const add = role_ids.filter(r => !before.role_ids.includes(r));
      const del = before.role_ids.filter(r => !role_ids.includes(r));
      if (!LIVE) {
        if (!isAdmin()) throw denied();
        const p = demo.people.find(x => x.user_id === userId);
        const snapshot = clone(p);
        Object.assign(p, { display_name, active, role_ids: [...role_ids] });
        if (!demoHasAdmin()) { Object.assign(p, snapshot); throw new Error('Il doit toujours rester au moins un administrateur actif dans la FI'); }
        demo.members.forEach(m => { if (m.user_id === userId) m.user_id = null; });
        p.member_id = member_id || null;
        if (member_id) demo.members.find(m => m.id === member_id).user_id = userId;
        return;
      }
      const org = state.orgId;
      if (add.length) check(await sb.from('account_roles').insert(add.map(role_id => ({ user_id: userId, organization_id: org, role_id }))));
      if (del.length) check(await sb.from('account_roles').delete().eq('user_id', userId).eq('organization_id', org).in('role_id', del));
      check(await sb.from('user_roles').update({ display_name, active }).eq('user_id', userId).eq('organization_id', org).select('user_id'), 'Modification refusée.');
      if ((member_id || null) !== (before.member_id || null)) {
        if (before.member_id) check(await sb.from('fi_members').update({ user_id: null }).eq('id', before.member_id).eq('organization_id', org));
        if (member_id) check(await sb.from('fi_members').update({ user_id: userId }).eq('id', member_id).eq('organization_id', org).select('id'), 'Lien refusé.');
      }
    },

    async saveRole(role) {
      if (!LIVE) {
        if (!isAdmin()) throw denied();
        if (demo.roles.some(r => r.id !== role.id && norm(r.name) === norm(role.name))) throw new Error('Ce nom existe déjà.');
        if (role.id) {
          const r = demo.roles.find(x => x.id === role.id);
          const snapshot = clone(r);
          Object.assign(r, role);
          if (!demoHasAdmin()) { Object.assign(r, snapshot); throw new Error('Il doit toujours rester au moins un administrateur actif dans la FI'); }
        } else {
          demo.roles.push({ ...role, id: `r${++demoSeq}`, system_key: null });
        }
        return;
      }
      const { id, ...fields } = role;
      if (id) check(await sb.from('org_roles').update(fields).eq('id', id).eq('organization_id', state.orgId).select('id'), 'Modification refusée.');
      else check(await sb.from('org_roles').insert({ ...fields, organization_id: state.orgId }).select('id'), 'Création refusée.');
    },

    async deleteRole(id) {
      if (!LIVE) {
        if (!isAdmin()) throw denied();
        const r = demo.roles.find(x => x.id === id);
        if (r.system_key) throw new Error('Un rôle de base ne peut pas être supprimé.');
        const snapshot = clone(demo);
        demo.roles = demo.roles.filter(x => x.id !== id);
        demo.people.forEach(p => { p.role_ids = p.role_ids.filter(x => x !== id); });
        if (!demoHasAdmin()) { demo = snapshot; throw new Error('Il doit toujours rester au moins un administrateur actif dans la FI'); }
        return;
      }
      check(await sb.from('org_roles').delete().eq('id', id).eq('organization_id', state.orgId).select('id'), 'Suppression refusée (rôle de base ?).');
    },

    async moveRole(id, dir) {
      const list = sortedRoles();
      const i = list.findIndex(r => r.id === id);
      const j = i + (dir === 'up' ? -1 : 1);
      if (j < 0 || j >= list.length) return;
      const a = list[i]; const b = list[j];
      let pa = b.position; let pb = a.position;
      if (pa === pb) { pa = dir === 'up' ? pb + 1 : pb - 1; }
      await api.saveRole({ id: a.id, position: pa });
      await api.saveRole({ id: b.id, position: pb });
    },

    async invite({ email, display_name, role_ids, member_id }) {
      if (!LIVE) {
        if (!isAdmin()) throw denied();
        const user_id = `demo-${++demoSeq}`;
        demo.people.push({ user_id, display_name, email, role_ids, member_id: member_id || null, active: true });
        if (member_id) demo.members.find(m => m.id === member_id).user_id = user_id;
        return { status: 'demo' };
      }
      return invokeFn('invite-user', { email, display_name, role_ids, member_id: member_id || null });
    },

    async savePrefs(prefs) {
      if (!LIVE) { demo.prefs[state.userId] = { ...prefs }; return; }
      check(await sb.from('notification_prefs').upsert({ user_id: state.userId, organization_id: state.orgId, ...prefs }, { onConflict: 'user_id,organization_id' }));
    },

    async notify(body) {
      if (!LIVE) {
        if (body.kind === 'event' && !can('send_reminders')) throw denied();
        return { sent: body.kind === 'test' ? 1 : demo.people.filter(p => p.active).length, demo: true };
      }
      return invokeFn('send-reminders', body);
    },

    async changePassword(password) {
      if (!LIVE) return;
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
    },
  };

  async function refresh() {
    try {
      await api.load();
    } catch (err) {
      toast(friendlyError(err));
    }
    renderAll();
  }

  // ───────────────────────── Rendu : outils ─────────────────────────
  const personName = uid => {
    if (!uid) return 'Non attribué';
    const p = state.people.find(x => x.user_id === uid);
    if (p) return p.display_name;
    if (uid === state.userId) return state.displayName || 'Moi';
    return 'Responsable';
  };
  const memberName = id => state.members.find(m => m.id === id)?.display_name;
  const eventDate = e => new Date(e.starts_at);
  const upcoming = () => { const t = startOfToday(); return state.events.filter(e => eventDate(e) >= t).sort((a, b) => eventDate(a) - eventDate(b)); };
  const pastRecorded = () => {
    const now = new Date();
    return state.events.filter(e => eventDate(e) <= now && state.attendance.some(a => a.event_id === e.id))
      .sort((a, b) => eventDate(b) - eventDate(a));
  };
  const rateFor = ev => {
    const recs = state.attendance.filter(a => a.event_id === ev.id && a.state !== 'unknown');
    return recs.length ? recs.filter(a => a.state === 'present').length / recs.length : null;
  };
  const avgRate = evs => { const r = evs.map(rateFor).filter(x => x !== null); return r.length ? r.reduce((a, b) => a + b, 0) / r.length : null; };
  const dueLabel = d => (d ? `Échéance ${fmtDayMonth(parseDay(d))}` : 'Sans échéance');
  const isInvited = e => e.audience === 'selected' && (state.participants[e.id] || []).includes(state.myMemberId);

  function avatar(name, memberId, cls = '') {
    const url = memberId && state.photoUrls[memberId];
    return url
      ? `<div class="mini-avatar has-photo ${cls}"><img src="${esc(url)}" alt="" loading="lazy"></div>`
      : `<div class="mini-avatar ${cls}">${esc(initials(name))}</div>`;
  }
  const roleChip = r => `<span class="role-chip" style="--c:${safeColor(r.color)}">${esc(r.name)}</span>`;

  function datebox(e) {
    const d = eventDate(e);
    return `<div class="datebox"><b>${pad(d.getDate())}</b><small>${esc(fmtMon(d))}</small></div>`;
  }
  function eventTag(e) {
    const days = (eventDate(e) - Date.now()) / 864e5;
    return days < 7 ? '<span class="tag green">À venir</span>' : '<span class="tag">Prévue</span>';
  }
  function audienceTag(e) {
    if (e.audience === 'team') return '<span class="tag aud-team">Équipe</span>';
    if (e.audience !== 'selected') return '';
    if (!seesAllEvents()) return '<span class="tag aud-invite">Invitation personnelle</span>';
    const names = (state.participants[e.id] || []).map(memberName).filter(Boolean);
    const n = (state.participants[e.id] || []).length;
    return `<span class="tag aud-invite" title="${esc(names.join(', '))}">${n} invité${n > 1 ? 's' : ''}${names.length && names.length <= 3 ? ` : ${esc(names.join(', '))}` : ''}</span>`;
  }
  function eventMeta(e) {
    return [fmtTime(eventDate(e)), e.location].filter(Boolean).map(esc).join(' · ');
  }
  function metric(label, icon, value, foot) {
    return `<div class="metric"><div class="metric-top">${esc(label)} <span class="metric-icon">${icon}</span></div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></div>`;
  }

  // Membres absents aux N dernières rencontres renseignées.
  function absentStreaks(n = 3) {
    const last = pastRecorded().slice(0, n);
    if (last.length < n) return [];
    return state.members.filter(m => m.status !== 'former' && last.every(e => {
      const a = state.attendance.find(x => x.event_id === e.id && x.member_id === m.id);
      return a && a.state === 'absent';
    }));
  }

  function alertsHtml() {
    const list = absentStreaks();
    if (!list.length) return '';
    return `<div class="panel alert-panel"><div class="panel-head"><div class="panel-title">À surveiller</div><span class="tag orange">${list.length} membre${list.length > 1 ? 's' : ''}</span></div>`
      + '<p class="sub" style="margin:0 0 12px">Absents aux 3 dernières rencontres : un mot de leur tuteur peut faire la différence.</p>'
      + list.map(m => `<div class="attendance-person">${avatar(m.display_name, m.id)}<div><b style="font-size:12px">${esc(m.display_name)}</b><small class="availability" style="display:block">Tuteur : ${esc(m.tutor_user_id ? personName(m.tutor_user_id) : 'aucun')}</small></div><span class="spacer"></span>${can('manage_followups') ? `<button class="row-btn" data-follow-member="${esc(m.id)}">＋ Créer un suivi</button>` : ''}</div>`).join('')
      + '</div>';
  }

  // ───────────────────────── Rendu : vues ─────────────────────────
  function renderDashboard() {
    const now = new Date();
    const memberSpace = !isStaff();
    $('#dashEyebrow').textContent = `${cap(now.toLocaleDateString('fr-FR', { weekday: 'long' }))} · ${memberSpace ? 'Espace membre' : 'Espace de coordination'}`;
    $('#hello').textContent = `Bonjour, ${(state.displayName || '').split(' ')[0] || 'bienvenue'}`;
    $('#dashSub').firstChild.textContent = memberSpace ? 'Voici les événements qui vous concernent.' : 'Voici les repères de votre FI cette semaine.';
    $('#todayBadge').textContent = LIVE ? state.orgName : 'Données de démonstration';

    const openTasks = state.tasks.filter(t => t.status !== 'done');
    const weekEnd = isoDate(new Date(Date.now() + 7 * 864e5));
    const dueSoon = openTasks.filter(t => t.due_at && t.due_at <= weekEnd).length;
    const next = upcoming();
    const next30 = next.filter(e => eventDate(e) - now < 30 * 864e5).length;
    let html;
    if (seesMembers()) {
      const followed = state.members.filter(m => m.status !== 'former');
      const active = followed.filter(m => m.status === 'active').length;
      const recorded = pastRecorded();
      const r4 = avgRate(recorded.slice(0, 4));
      const prev = avgRate(recorded.slice(4, 8));
      const trend = r4 !== null && prev !== null ? Math.round((r4 - prev) * 100) : null;
      const openFollow = state.followups.filter(f => f.status !== 'done').length;
      html = metric('Membres actifs', '♙', active, `sur <span>${followed.length}</span> membres suivis`)
        + metric('Présence récente', '✓', r4 === null ? '–' : `${Math.round(r4 * 100)}<span style="font-size:15px">%</span>`,
          trend === null ? `sur les ${Math.min(recorded.length, 4)} dernières FI` : `<span class="${trend >= 0 ? 'positive' : ''}">${trend >= 0 ? '↑' : '↓'} ${Math.abs(trend)} pts</span> sur les 4 dernières FI`)
        + metric('Suivis à mener', '♡', can('manage_followups') ? openFollow : '–', 'prochaine action à organiser')
        + metric('Tâches ouvertes', '☷', openTasks.length, `${dueSoon} échéance${dueSoon > 1 ? 's' : ''} cette semaine`);
    } else {
      const invites = next.filter(isInvited).length;
      html = metric(memberSpace ? 'Mes événements' : 'Rencontres à venir', '▦', next30, 'dans les 30 prochains jours')
        + metric('Mes tâches ouvertes', '☷', openTasks.length, `${dueSoon} échéance${dueSoon > 1 ? 's' : ''} cette semaine`)
        + (memberSpace
          ? metric('Invitations', '✉', invites, 'événements où vous êtes invité')
          : metric('Tâches terminées', '✓', state.tasks.filter(t => t.status === 'done').length, 'sur vos tâches attribuées'))
        + metric('Prochain rendez-vous', '⌂', next[0] ? `<span style="font-size:19px">${esc(fmtLongDay(eventDate(next[0])))}</span>` : '–', next[0] ? esc(eventMeta(next[0])) : 'aucune date prévue');
    }
    $('#metrics').innerHTML = html;
    $$('#metrics .metric-value').forEach(countUp);

    $('#dashEventsTitle').textContent = memberSpace ? 'Mes prochains événements' : 'Prochaines rencontres';
    $('#dashEvents').innerHTML = next.slice(0, memberSpace ? 5 : 3).map(e =>
      `<div class="event">${datebox(e)}<div class="event-info"><b>${esc(e.title)}</b><small>${eventMeta(e)}</small></div>${audienceTag(e) || eventTag(e)}</div>`).join('')
      || '<div class="empty">Aucun événement prévu.</div>';

    $('#dashTasksTitle').textContent = can('manage_tasks') ? 'À faire cette semaine' : 'Mes tâches';
    $('#dashTasks').innerHTML = openTasks.slice(0, can('manage_tasks') ? 3 : 5).map(t =>
      `<div class="task"><input type="checkbox" class="check" data-task-done="${esc(t.id)}" ${canEditTask(t) ? '' : 'disabled'} aria-label="Marquer « ${esc(t.title)} » comme terminée"><div class="task-copy"><b>${esc(t.title)}</b><small>${esc(personName(t.assigned_to))} · ${esc(dueLabel(t.due_at))}</small></div></div>`).join('')
      || '<div class="empty">Rien d’urgent pour le moment.</div>';
    const done = state.tasks.length - openTasks.length;
    $('#progressText').textContent = state.tasks.length ? `${done} sur ${state.tasks.length}` : '–';
    $('#progressBar').style.width = state.tasks.length ? `${(done / state.tasks.length) * 100}%` : '0';
    $('#dashAlerts').innerHTML = seesMembers() && state.attendance.length ? alertsHtml() : '';
  }

  function renderMembers() {
    const q = norm($('#memberSearch').value);
    const last5 = pastRecorded().slice(0, 5);
    const rows = state.members.filter(m => norm(m.display_name).includes(q)).map(m => {
      const recs = last5.map(e => state.attendance.find(a => a.event_id === e.id && a.member_id === m.id)).filter(Boolean);
      const present = recs.filter(a => a.state === 'present').length;
      const tagClass = m.status === 'active' ? 'green' : m.status === 'to_contact' ? 'orange' : '';
      const account = m.user_id ? '<span class="tag aud-invite" title="Peut se connecter à l’espace membre">compte</span>' : '';
      return `<tr><td><div class="person">${avatar(m.display_name, m.id)}<div>${esc(m.display_name)} ${account}${LIVE ? '' : '<small>Données de démonstration</small>'}</div></div></td>`
        + `<td>${esc(m.availability || '—')}</td><td><span class="tag ${tagClass}">${esc(MEMBER_STATUS[m.status] || m.status)}</span></td>`
        + `<td>${recs.length ? `${present} / ${recs.length}` : '—'}</td><td>${esc(m.tutor_user_id ? personName(m.tutor_user_id) : '—')}</td>`
        + `<td><button class="row-btn" data-perm="manage_members" data-edit-member="${esc(m.id)}">Modifier</button></td></tr>`;
    });
    $('#memberRows').innerHTML = rows.join('')
      || `<tr><td colspan="6" class="empty">${state.members.length ? 'Aucun résultat.' : 'Aucun membre pour le moment.'}</td></tr>`;
  }

  function attendanceEvents() { return state.events.filter(e => e.audience !== 'team').sort((a, b) => eventDate(b) - eventDate(a)); }

  function renderAttendance() {
    const evs = attendanceEvents();
    if (!evs.some(e => e.id === state.attEventId)) {
      const now = Date.now() + 12 * 3600e3;
      state.attEventId = (evs.find(e => eventDate(e) <= now) || evs[evs.length - 1] || {}).id || null;
    }
    $('#attEvent').innerHTML = evs.map(e => `<option value="${esc(e.id)}" ${e.id === state.attEventId ? 'selected' : ''}>${esc(e.title.replace(/\s—.*$/, ''))} du ${esc(fmtLongDay(eventDate(e)))}</option>`).join('')
      || '<option value="">Aucune rencontre</option>';
    const followed = state.members.filter(m => m.status !== 'former');
    $('#attendanceRows').innerHTML = state.attEventId && followed.length ? followed.map(m => {
      const rec = state.attendance.find(a => a.event_id === state.attEventId && a.member_id === m.id);
      return `<div class="attendance-person">${avatar(m.display_name, m.id)}<b style="font-size:12px">${esc(m.display_name)}</b><span class="spacer"></span><span class="availability">${esc(m.availability || '')}</span><input class="check presence-check" type="checkbox" data-member="${esc(m.id)}" ${rec?.state === 'present' ? 'checked' : ''} ${can('manage_attendance') ? '' : 'disabled'} aria-label="${esc(m.display_name)} présent"></div>`;
    }).join('') : `<div class="empty">${state.attEventId ? 'Ajoutez d’abord des membres.' : 'Ajoutez d’abord une rencontre au planning.'}</div>`;
    const r4 = avgRate(pastRecorded().slice(0, 4));
    $('#attRate').innerHTML = r4 === null ? '–' : `${Math.round(r4 * 100)}<span style="font-size:15px">%</span>`;
    updatePresentCount();
  }

  function updatePresentCount() {
    const boxes = $$('.presence-check');
    const n = boxes.filter(b => b.checked).length;
    $('#presentCount').textContent = `${n} présent${n > 1 ? 's' : ''}`;
    $('#attThis').textContent = boxes.length ? `${n} / ${boxes.length}` : '–';
    $('#attBar').style.width = boxes.length ? `${(n / boxes.length) * 100}%` : '0';
  }

  function renderFollowups() {
    const order = { open: 0, planned: 1, done: 2 };
    const list = [...state.followups].sort((a, b) => order[a.status] - order[b.status] || String(a.due_at || '9').localeCompare(String(b.due_at || '9')));
    $('#followTag').textContent = `${list.filter(f => f.status !== 'done').length} à mener`;
    $('#followRows').innerHTML = list.map(f => {
      const tag = f.status === 'done' ? 'green' : 'orange';
      return `<div class="follow-card ${f.status === 'done' ? 'done' : ''}"><div><h4>${esc(f.contact_label)} <span class="tag ${tag}">${esc(FOLLOW_STATUS[f.status])}</span></h4><p>${esc(f.next_action)}</p>`
        + `<small>Tuteur : ${esc(personName(f.owner_user_id))} · Prochaine étape : ${esc(f.due_at ? fmtDayMonth(parseDay(f.due_at)) : 'à définir')}</small></div>`
        + `<div class="follow-actions" data-perm="manage_followups">${f.status !== 'done' ? `<button class="row-btn" data-follow-done="${esc(f.id)}">✓ Fait</button>` : ''}<button class="row-btn" data-edit-follow="${esc(f.id)}">Modifier</button></div></div>`;
    }).join('') || '<div class="empty">Aucun suivi en cours.</div>';
  }

  function renderCalendar() {
    $('#calendarTitle').textContent = isStaff() ? 'Planning FI' : 'Mes événements';
    $('#calendarSub').textContent = isStaff() ? 'Rencontres et activités des prochaines semaines.' : 'Les rencontres ouvertes à tous et celles où vous êtes invité.';
    $('#calendarRows').innerHTML = upcoming().map(e =>
      `<div class="calendar-item">${datebox(e)}<div><h3>${esc(e.title)}</h3><p>${esc(cap(eventDate(e).toLocaleDateString('fr-FR', { weekday: 'long' })))} · ${eventMeta(e)}</p>${e.notes ? `<p style="margin-top:6px">${esc(e.notes)}</p>` : ''}`
      + `<div class="cal-tags">${eventTag(e)}${audienceTag(e)}</div>`
      + `<button class="row-btn" data-perm="manage_events" data-edit-event="${esc(e.id)}">Modifier</button><button class="row-btn" data-perm="send_reminders" data-remind-event="${esc(e.id)}" title="Envoyer un rappel par e-mail aux personnes concernées">✉ Rappel</button></div></div>`).join('')
      || '<div class="panel empty">Aucune date à venir.</div>';
  }

  const canEditTask = t => can('manage_tasks') || t.assigned_to === state.userId;

  function renderTasks() {
    const order = { in_progress: 0, todo: 1, done: 2 };
    const list = [...state.tasks].sort((a, b) => order[a.status] - order[b.status] || String(a.due_at || '9').localeCompare(String(b.due_at || '9')));
    $('#taskTag').textContent = can('manage_tasks') ? `${list.filter(t => t.status !== 'done').length} ouvertes` : 'Mes tâches';
    $('#taskRows').innerHTML = list.map(t => {
      const editable = canEditTask(t);
      const tag = t.status === 'done' ? 'green' : t.status === 'in_progress' ? 'orange' : '';
      const control = editable
        ? `<select class="status-select" data-task-status="${esc(t.id)}" aria-label="Avancement">${Object.entries(TASK_STATUS).map(([v, l]) => `<option value="${v}" ${v === t.status ? 'selected' : ''}>${l}</option>`).join('')}</select>`
        : `<span class="tag ${tag}">${esc(TASK_STATUS[t.status])}</span>`;
      return `<div class="task ${t.status === 'done' ? 'done' : ''}"><input type="checkbox" class="check" data-task-done="${esc(t.id)}" ${t.status === 'done' ? 'checked' : ''} ${editable ? '' : 'disabled'} aria-label="Marquer « ${esc(t.title)} » comme terminée">`
        + `<div class="task-copy"><b>${esc(t.title)}</b><small>${esc(personName(t.assigned_to))} · ${esc(dueLabel(t.due_at))}</small>${t.description ? `<small>${esc(t.description)}</small>` : ''}</div>`
        + `<div class="task-actions">${control}<button class="row-btn" data-perm="manage_tasks" data-edit-task="${esc(t.id)}">Modifier</button></div></div>`;
    }).join('') || `<div class="empty">${can('manage_tasks') ? 'Aucune tâche pour le moment.' : 'Aucune tâche attribuée pour le moment.'}</div>`;
  }

  // ───────────────────────── Statistiques ─────────────────────────
  const pct = x => `${Math.round(x * 100)} %`;
  const shortDay = e => eventDate(e).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).replace('.', '');

  // Colonnes arrondies uniquement en haut (ancrées sur la ligne de base).
  function colPath(x, y, w, base, r = 4) {
    const rr = Math.min(r, (base - y) / 2, w / 2);
    return `M${x},${base}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${base}Z`;
  }

  function attendanceChart(evs) {
    if (!evs.length) return '<div class="empty">Enregistrez des présences pour voir l’évolution.</div>';
    const W = 640, H = 230, top = 26, base = 190, left = 34, right = 10;
    const slot = (W - left - right) / evs.length;
    const bw = Math.min(46, slot * 0.56);
    const rates = evs.map(e => rateFor(e) ?? 0);
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    const y = v => base - v * (base - top);
    const grid = [0, 0.5, 1].map(v => `<line x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${left - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${v * 100}</text>`).join('');
    const bars = evs.map((e, i) => {
      const recs = state.attendance.filter(a => a.event_id === e.id && a.state !== 'unknown');
      const present = recs.filter(a => a.state === 'present').length;
      const x = left + i * slot + (slot - bw) / 2;
      const tip = `${shortDay(e)} : ${present} présent${present > 1 ? 's' : ''} sur ${recs.length} (${pct(rates[i])})`;
      return `<g class="hit" data-tip="${esc(tip)}" tabindex="0"><rect x="${left + i * slot}" y="${top}" width="${slot}" height="${base - top}" fill="transparent"/>`
        + `<path d="${colPath(x, y(rates[i]), bw, base)}" class="col"/>`
        + `<text x="${x + bw / 2}" y="${y(rates[i]) - 7}" class="val" text-anchor="middle">${present}/${recs.length}</text>`
        + `<text x="${x + bw / 2}" y="${base + 18}" class="axis" text-anchor="middle">${esc(shortDay(e))}</text></g>`;
    }).join('');
    const avgLine = `<line x1="${left}" x2="${W - right}" y1="${y(avg)}" y2="${y(avg)}" class="avg"/>`;
    return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="Taux de présence par rencontre, moyenne ${pct(avg)}">${grid}${avgLine}${bars}</svg>`
      + `<div class="legend" style="margin:8px 0 0"><span><i style="background:#17a673"></i>Taux de présence (%)</span><span><i class="dash"></i>Moyenne : ${pct(avg)}</span></div>`
      + `<details class="chart-table"><summary>Voir les données</summary><table class="data-table" style="min-width:0"><thead><tr><th>Rencontre</th><th>Présents</th><th>Taux</th></tr></thead><tbody>${evs.map((e, i) => {
        const recs = state.attendance.filter(a => a.event_id === e.id && a.state !== 'unknown');
        return `<tr><td>${esc(shortDay(e))}</td><td>${recs.filter(a => a.state === 'present').length} / ${recs.length}</td><td>${pct(rates[i])}</td></tr>`;
      }).join('')}</tbody></table></details>`;
  }

  function assiduityChart(evs) {
    const rows = state.members.filter(m => m.status !== 'former').map(m => {
      const recs = evs.map(e => state.attendance.find(a => a.event_id === e.id && a.member_id === m.id)).filter(a => a && a.state !== 'unknown');
      const present = recs.filter(a => a.state === 'present').length;
      return { m, present, total: recs.length, rate: recs.length ? present / recs.length : null };
    }).filter(r => r.total).sort((a, b) => b.rate - a.rate);
    if (!rows.length) return '<div class="empty">Pas encore de données.</div>';
    return rows.map(({ m, present, total, rate }) => {
      const low = rate < 0.5;
      return `<div class="hbar-row" data-tip="${esc(`${m.display_name} : ${present} présence${present > 1 ? 's' : ''} sur ${total}`)}" tabindex="0">${avatar(m.display_name, m.id)}<span class="hbar-name">${esc(m.display_name)}</span>`
        + `<span class="hbar-track"><i class="${low ? 'low' : ''}" style="width:${Math.max(rate * 100, 2)}%"></i></span>`
        + `<span class="hbar-val">${pct(rate)}${low ? ' <em class="low-label">faible</em>' : ''}</span></div>`;
    }).join('');
  }

  function tasksChart() {
    const byPerson = new Map();
    state.tasks.forEach(t => {
      const k = t.assigned_to || '';
      if (!byPerson.has(k)) byPerson.set(k, { done: 0, in_progress: 0, todo: 0 });
      byPerson.get(k)[t.status]++;
    });
    if (!byPerson.size) return '<div class="empty">Aucune tâche pour le moment.</div>';
    const total = c => c.done + c.in_progress + c.todo;
    const max = Math.max(...[...byPerson.values()].map(total));
    const legend = `<div class="legend">${['done', 'in_progress', 'todo'].map(k => `<span><i style="background:${TASK_COLORS[k]}"></i>${TASK_STATUS[k]}</span>`).join('')}</div>`;
    return legend + [...byPerson.entries()].sort((a, b) => total(b[1]) - total(a[1])).map(([uid, c]) => {
      const segs = ['done', 'in_progress', 'todo'].filter(k => c[k]).map(k =>
        `<i style="flex:${c[k]};background:${TASK_COLORS[k]}" data-tip="${esc(`${personName(uid)} · ${TASK_STATUS[k]} : ${c[k]}`)}"></i>`).join('');
      return `<div class="hbar-row"><span class="hbar-name wide">${esc(personName(uid))}</span><span class="stack-track"><span class="stack" style="width:${(total(c) / max) * 100}%">${segs}</span></span><span class="hbar-val">${c.done}/${total(c)} faites</span></div>`;
    }).join('');
  }

  function statusChart() {
    const counts = Object.keys(MEMBER_STATUS).map(k => [k, state.members.filter(m => m.status === k).length]);
    const max = Math.max(1, ...counts.map(c => c[1]));
    return counts.map(([k, n]) => `<div class="hbar-row" data-tip="${esc(`${MEMBER_STATUS[k]} : ${n}`)}" tabindex="0"><span class="hbar-name wide">${esc(MEMBER_STATUS[k])}</span><span class="hbar-track"><i class="teal" style="width:${Math.max((n / max) * 100, n ? 4 : 0)}%"></i></span><span class="hbar-val">${n}</span></div>`).join('');
  }

  function renderStats() {
    if (!can('view_stats')) { $('#statsMetrics').innerHTML = ''; return; }
    const evs = pastRecorded().slice(0, 8).reverse();
    const avg = avgRate(evs);
    const followed = state.members.filter(m => m.status !== 'former');
    const loyal = followed.filter(m => {
      const recs = evs.map(e => state.attendance.find(a => a.event_id === e.id && a.member_id === m.id)).filter(a => a && a.state !== 'unknown');
      return recs.length && recs.filter(a => a.state === 'present').length / recs.length >= 0.75;
    }).length;
    const fDone = state.followups.filter(f => f.status === 'done').length;
    const tDone = state.tasks.filter(t => t.status === 'done').length;
    $('#statsMetrics').innerHTML =
      metric('Présence moyenne', '✓', avg === null ? '–' : `${Math.round(avg * 100)}<span style="font-size:15px">%</span>`, `sur les ${evs.length} dernières rencontres`)
      + metric('Membres fidèles', '♥', loyal, `présents à 75 % ou plus, sur ${followed.length}`)
      + metric('Suivis réalisés', '♡', can('manage_followups') ? fDone : '–', `sur ${state.followups.length} suivis enregistrés`)
      + metric('Tâches terminées', '☷', state.tasks.length ? `${Math.round((tDone / state.tasks.length) * 100)}<span style="font-size:15px">%</span>` : '–', `${tDone} sur ${state.tasks.length}`);
    $$('#statsMetrics .metric-value').forEach(countUp);
    $('#chartAttendance').innerHTML = attendanceChart(evs);
    $('#chartAssiduity').innerHTML = assiduityChart(evs);
    $('#chartTasks').innerHTML = tasksChart();
    $('#chartStatus').innerHTML = statusChart();
    $('#statsAlerts').innerHTML = alertsHtml() || '<div class="panel"><div class="panel-title">À surveiller</div><p class="sub" style="margin:10px 0 0">Personne n’a manqué les 3 dernières rencontres. 🙏</p></div>';
  }

  function exportAttendanceCsv() {
    const evs = pastRecorded().reverse();
    const label = { present: 'Présent', absent: 'Absent', excused: 'Excusé', unknown: '' };
    const safe = v => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; }; // pas de formules Excel
    const rows = [['Membre', 'Statut', ...evs.map(e => isoDate(eventDate(e)))],
      ...state.members.map(m => [m.display_name, MEMBER_STATUS[m.status], ...evs.map(e => label[state.attendance.find(a => a.event_id === e.id && a.member_id === m.id)?.state] || '')])];
    const csv = rows.map(r => r.map(c => `"${safe(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `presences-fi-${isoDate(new Date())}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ───────────────────────── Mon compte ─────────────────────────
  function renderAccount() {
    const chips = rolesOf(state.myRoleIds).map(roleChip).join('') || '<span class="role-chip">Aucun rôle</span>';
    $('#accountCard').innerHTML = `<div class="account-id">${avatar(state.displayName || '?', state.myMemberId, 'big')}<div><b>${esc(state.displayName || '—')}</b><small>${esc(state.email || '')}</small><div class="chips" style="margin-top:8px">${chips}</div></div></div>`
      + `<div class="notice" style="margin-top:14px">Connexion par adresse e-mail et mot de passe. ${LIVE ? `FI : <b>${esc(state.orgName)}</b>.` : 'En démonstration, aucun e-mail n’est envoyé.'}</div>`;
    $$('#prefsForm input[type=checkbox]').forEach(cb => { cb.checked = Boolean(state.prefs[cb.name]); });
  }

  // ───────────────────────── Administration (rôles façon Discord) ─────────────────────────
  function renderAdmin() {
    if (!isAdmin()) { $('#rolesList').innerHTML = ''; $('#peopleRows').innerHTML = ''; return; }
    const roles = sortedRoles();
    $('#rolesList').innerHTML = roles.map((r, i) => {
      const count = state.people.filter(p => p.active && p.role_ids.includes(r.id)).length;
      const perms = r.permissions.includes('administrator') ? 'Tous les droits'
        : r.permissions.map(p => PERMS[p]?.[0]).filter(Boolean).join(' · ') || 'Espace membre : ses événements et ses tâches';
      return `<div class="role-row" style="--c:${safeColor(r.color)}"><span class="role-dot"></span><div class="role-info"><b>${esc(r.name)}</b>${r.system_key ? '<em>de base</em>' : ''}<small>${esc(perms)}</small></div>`
        + `<span class="role-count" title="Comptes actifs ayant ce rôle">${count} compte${count > 1 ? 's' : ''}</span><div class="role-actions">`
        + `<button class="icon-btn" data-role-up="${esc(r.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Monter ${esc(r.name)}">↑</button>`
        + `<button class="icon-btn" data-role-down="${esc(r.id)}" ${i === roles.length - 1 ? 'disabled' : ''} aria-label="Descendre ${esc(r.name)}">↓</button>`
        + `<button class="row-btn" data-edit-role="${esc(r.id)}">Modifier</button></div></div>`;
    }).join('');
    $('#peopleRows').innerHTML = state.people.map(p => {
      const self = p.user_id === state.userId;
      const linked = p.member_id ? memberName(p.member_id) : null;
      const chips = rolesOf(p.role_ids).map(roleChip).join('') || '<span class="role-chip">Aucun rôle</span>';
      return `<div class="people-row ${p.active ? '' : 'inactive'}" style="--c:${safeColor(topRole(p.role_ids)?.color)}">${avatar(p.display_name, p.member_id)}<div class="people-info"><b>${esc(p.display_name)}${self ? ' · vous' : ''}</b>`
        + `<small>${esc(p.email || '')}${linked ? ` · fiche membre : ${esc(linked)}` : ''}${p.active ? '' : ' · accès retiré'}</small><div class="chips">${chips}</div></div>`
        + `<button class="row-btn" data-edit-account="${esc(p.user_id)}">Gérer</button></div>`;
    }).join('') || '<div class="empty">Aucun compte.</div>';
  }

  function renderDatalists() {
    const opts = names => [...new Set(names.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')).map(n => `<option value="${esc(n)}"></option>`).join('');
    $('#dlMembers').innerHTML = opts(state.members.map(m => m.display_name));
    $('#dlNames').innerHTML = opts([...state.members.map(m => m.display_name), ...state.people.map(p => p.display_name)]);
  }

  function applyRoleUI() {
    document.body.dataset.staff = isStaff() ? 'yes' : 'no';
    $$('.nav button').forEach(b => { b.style.display = allowedView(b.dataset.view) ? 'flex' : 'none'; });
    $('[data-view="calendar"] .nav-text').textContent = isStaff() ? 'Planning FI' : 'Mes événements';
    $$('[data-perm]').forEach(el => { el.style.display = can(el.dataset.perm) ? '' : 'none'; });
    $('#avatar').textContent = initials(state.displayName || '?');
    $('#avatar').title = state.displayName;
    const top = topRole(state.myRoleIds);
    $('#roleBadge').textContent = top ? top.name : '';
    $('#roleBadge').style.setProperty('--c', safeColor(top?.color));
    $('#orgLabel').textContent = state.orgName || 'Espace connecté';
    if (!allowedView(state.view)) showView('dashboard', true);
  }

  function renderAll() {
    renderDashboard(); renderMembers(); renderAttendance(); renderFollowups(); renderCalendar(); renderTasks(); renderAdmin();
    renderStats(); renderAccount(); renderDatalists();
    applyRoleUI();
    decorate();
  }

  // ───────────────────────── Navigation ─────────────────────────
  function showView(id, silent) {
    if (!allowedView(id)) { if (!silent) toast('Cette rubrique n’est pas accessible avec votre rôle.'); return; }
    state.view = id;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === id));
    $$('.nav button').forEach(b => b.classList.toggle('active', b.dataset.view === id));
    $('#crumb').textContent = id === 'calendar' && !isStaff() ? 'Mes événements' : VIEW_LABELS[id];
    $('#sidebar').classList.remove('open');
    if (!silent) window.scrollTo(0, 0);
  }

  let toastTimer;
  function toast(s) {
    const el = $('#toast');
    el.textContent = s; el.style.opacity = 1; el.style.transform = 'translate(-50%,0)';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = 0; el.style.transform = 'translate(-50%,20px)'; }, 3200);
  }

  // ───────────────────────── Formulaires (modale) ─────────────────────────
  let modalSubmit = null;
  let modalDelete = null;

  function fieldHtml(f) {
    const id = `f_${f.name}`;
    const val = f.value ?? '';
    const common = `id="${id}" name="${f.name}" ${f.required ? 'required' : ''} ${f.maxlength ? `maxlength="${f.maxlength}"` : ''}`;
    const wrap = (inner, extraCls = '') => `<div class="field ${extraCls}" ${f.hidden ? 'hidden' : ''} data-field="${f.name}"><span>${esc(f.label)}${f.required ? ' *' : ''}</span>${inner}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</div>`;
    if (f.type === 'photo') {
      return wrap(`<div class="photo-field">${f.preview}<div><input type="file" name="${f.name}" accept="image/*" aria-label="${esc(f.label)}">`
        + `${f.value ? '<label class="switch" style="margin-top:8px"><input type="checkbox" class="check" name="remove_photo"> Retirer la photo</label>' : ''}</div></div>`);
    }
    if (f.type === 'checkbox') {
      return `<label class="switch field-check" data-field="${f.name}"><input type="checkbox" class="check" name="${f.name}" ${f.value ? 'checked' : ''}> ${esc(f.label)}</label>`;
    }
    if (f.type === 'checklist') {
      const chosen = new Set(f.value || []);
      const items = f.options.map(o => `<label class="check-item" ${o.color ? `style="--c:${safeColor(o.color)}"` : ''}><input type="checkbox" class="check" name="${f.name}" value="${esc(o.value)}" data-multi ${chosen.has(o.value) ? 'checked' : ''} ${o.disabled ? 'disabled' : ''}>`
        + `${o.color ? '<span class="role-dot"></span>' : ''}<span><b>${esc(o.label)}</b>${o.desc ? `<small>${esc(o.desc)}</small>` : ''}</span></label>`).join('');
      return wrap(`<div class="checklist ${f.compact ? 'compact' : ''}">${items || '<small>Aucun choix disponible.</small>'}</div>`, 'checklist-field');
    }
    if (f.type === 'swatches') {
      return wrap(`<div class="swatches">${ROLE_SWATCHES.map(c => `<label class="swatch" style="--c:${c}"><input type="radio" name="${f.name}" value="${c}" ${c === val ? 'checked' : ''}><span></span></label>`).join('')}`
        + `<label class="swatch custom" title="Autre couleur"><input type="color" name="${f.name}_custom" value="${esc(safeColor(val))}"></label></div>`);
    }
    let input;
    if (f.type === 'select') {
      input = `<select ${common}>${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea ${common} rows="3" placeholder="${esc(f.placeholder || '')}">${esc(val)}</textarea>`;
    } else {
      input = `<input type="${f.type || 'text'}" ${common} value="${esc(val)}" placeholder="${esc(f.placeholder || '')}" autocomplete="${f.autocomplete || 'off'}" ${f.list ? `list="${f.list}"` : ''}>`;
    }
    return `<label class="field" for="${id}" data-field="${f.name}" ${f.hidden ? 'hidden' : ''}><span>${esc(f.label)}${f.required ? ' *' : ''}</span>${input}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</label>`;
  }

  function openForm({ title, fields, submitLabel = 'Enregistrer', onSubmit, onDelete, deleteLabel = 'Supprimer' }) {
    $('#modalTitle').textContent = title;
    $('#modalFields').innerHTML = fields.map(fieldHtml).join('');
    $('#modalSubmit').textContent = submitLabel;
    $('#modalDelete').hidden = !onDelete;
    $('#modalDelete').textContent = deleteLabel;
    $('#modalError').textContent = '';
    modalSubmit = onSubmit; modalDelete = onDelete || null;
    $('#modal').showModal();
    $('#modalFields').querySelector('input:not([type=checkbox]):not([type=radio]),select,textarea')?.focus();
  }

  async function runModal(fn) {
    const buttons = $$('#modalForm button');
    buttons.forEach(b => { b.disabled = true; });
    try {
      await fn();
      $('#modal').close();
      await refresh();
    } catch (err) {
      $('#modalError').textContent = friendlyError(err);
    } finally {
      buttons.forEach(b => { b.disabled = false; });
    }
  }

  const peopleOptions = (emptyLabel = 'Non attribué') =>
    [['', emptyLabel], ...state.people.filter(p => p.active).map(p => [p.user_id, `${p.display_name}${topRole(p.role_ids) ? ` · ${topRole(p.role_ids).name}` : ''}`])];
  const roleOptions = () => sortedRoles().map(r => ({ value: r.id, label: r.name, color: r.color, desc: r.permissions.includes('administrator') ? 'Tous les droits' : r.permissions.map(p => PERMS[p]?.[0]).join(', ') || 'Espace membre' }));

  function memberForm(m = {}) {
    openForm({
      title: m.id ? 'Modifier le membre' : 'Ajouter un membre',
      fields: [
        { name: 'display_name', label: 'Nom affiché', value: m.display_name, required: true, maxlength: 80, list: 'dlNames', hint: 'Un prénom et une initiale suffisent. Les noms déjà enregistrés sont proposés.' },
        { name: 'availability', label: 'Disponibilité générale', value: m.availability, maxlength: 80, placeholder: 'Mardi soir · Week-end' },
        { name: 'status', label: 'Statut', type: 'select', value: m.status || 'active', options: Object.entries(MEMBER_STATUS) },
        { name: 'tutor_user_id', label: 'Tuteur', type: 'select', value: m.tutor_user_id || '', options: peopleOptions('Aucun'), hint: 'Le responsable qui accompagne ce membre et prend de ses nouvelles.' },
        { name: 'photo', label: 'Photo de profil', type: 'photo', value: Boolean(m.id && state.photoUrls[m.id]), preview: avatar(m.display_name || '?', m.id, 'big'), hint: 'Uniquement avec l’accord de la personne. L’image est recadrée et allégée avant envoi.' },
      ],
      onSubmit: async d => {
        const twin = state.members.find(x => x.id !== m.id && norm(x.display_name) === norm(d.display_name));
        if (twin && !confirm(`Un membre s’appelle déjà « ${twin.display_name} ». Enregistrer quand même ?`)) throw new Error('Enregistrement annulé : nom déjà utilisé.');
        const id = await api.save('fi_members', { id: m.id, display_name: d.display_name, availability: nn(d.availability), status: d.status, tutor_user_id: nn(d.tutor_user_id) });
        if (d.photo && d.photo.size) await api.setPhoto(id, await resizePhoto(d.photo));
        else if (d.remove_photo) await api.setPhoto(id, null);
      },
      onDelete: m.id ? () => api.remove('fi_members', m.id) : null,
    });
  }

  function eventForm(e = {}) {
    const d = e.starts_at ? new Date(e.starts_at) : null;
    const canTarget = seesMembers();
    const audiences = Object.entries(AUDIENCES).filter(([k]) => k !== 'selected' || canTarget);
    openForm({
      title: e.id ? 'Modifier la date' : 'Ajouter une date',
      fields: [
        { name: 'title', label: 'Intitulé', value: e.title || 'FI — rencontre hebdomadaire', required: true, maxlength: 120 },
        { name: 'date', label: 'Date', type: 'date', value: d ? isoDate(d) : '', required: true },
        { name: 'time', label: 'Heure', type: 'time', value: d ? fmtTime(d) : '19:00', required: true },
        { name: 'location', label: 'Lieu', value: e.location, maxlength: 120, placeholder: 'Salle habituelle' },
        { name: 'audience', label: 'Qui voit cet événement ?', type: 'select', value: e.audience || 'all', options: audiences, hint: 'Les membres ne voient que les événements ouverts à tous et ceux où ils sont invités.' },
        { name: 'participants', label: 'Membres invités', type: 'checklist', compact: true, hidden: (e.audience || 'all') !== 'selected', value: state.participants[e.id] || [],
          options: state.members.filter(m => m.status !== 'former').map(m => ({ value: m.id, label: m.display_name, desc: m.user_id ? 'a un compte membre' : '' })) },
        { name: 'notes', label: 'Note pratique', type: 'textarea', value: e.notes, maxlength: 200, hint: 'Informations d’organisation uniquement.' },
      ],
      onSubmit: async f => {
        const participants = f.audience === 'selected' ? (f.participants || []) : [];
        if (f.audience === 'selected' && !participants.length) throw new Error('Choisissez au moins un membre invité.');
        const id = await api.save('fi_events', { id: e.id, title: f.title, starts_at: new Date(`${f.date}T${f.time}`).toISOString(), location: nn(f.location), notes: nn(f.notes), audience: f.audience });
        if (canTarget) await api.setParticipants(id, participants);
      },
      onDelete: e.id ? () => api.remove('fi_events', e.id) : null,
    });
  }

  function followForm(f = {}) {
    openForm({
      title: f.id ? 'Modifier le suivi' : 'Nouveau suivi',
      fields: [
        { name: 'contact_label', label: 'Contact', value: f.contact_label, required: true, maxlength: 60, list: 'dlMembers', hint: 'Nom d’un membre (proposé automatiquement) ou libellé court — pas de détails personnels.' },
        { name: 'next_action', label: 'Prochaine action', value: f.next_action, required: true, maxlength: 160 },
        { name: 'owner_user_id', label: 'Tuteur du suivi', type: 'select', value: f.owner_user_id || state.userId, options: peopleOptions() },
        { name: 'due_at', label: 'Pour le', type: 'date', value: f.due_at },
        { name: 'status', label: 'État', type: 'select', value: f.status || 'open', options: Object.entries(FOLLOW_STATUS) },
      ],
      onSubmit: d => api.save('follow_ups', { id: f.id, contact_label: d.contact_label, next_action: d.next_action, owner_user_id: nn(d.owner_user_id), due_at: nn(d.due_at), status: d.status }),
      onDelete: f.id ? () => api.remove('follow_ups', f.id) : null,
    });
  }

  function taskForm(t = {}) {
    openForm({
      title: t.id ? 'Modifier la tâche' : 'Nouvelle tâche',
      fields: [
        { name: 'title', label: 'Tâche', value: t.title, required: true, maxlength: 120 },
        { name: 'description', label: 'Précision', type: 'textarea', value: t.description, maxlength: 200 },
        { name: 'assigned_to', label: 'Attribuée à', type: 'select', value: t.assigned_to || '', options: peopleOptions() },
        { name: 'due_at', label: 'Échéance', type: 'date', value: t.due_at },
        { name: 'status', label: 'Avancement', type: 'select', value: t.status || 'todo', options: Object.entries(TASK_STATUS) },
      ],
      onSubmit: d => api.save('tasks', { id: t.id, title: d.title, description: nn(d.description), assigned_to: nn(d.assigned_to), due_at: nn(d.due_at), status: d.status }),
      onDelete: t.id ? () => api.remove('tasks', t.id) : null,
    });
  }

  function monthPlanForm() {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth() + (now.getDate() > 20 ? 1 : 0), 1);
    openForm({
      title: 'Planifier le mois',
      submitLabel: 'Créer les dates',
      fields: [
        { name: 'month', label: 'Mois', type: 'month', value: `${target.getFullYear()}-${pad(target.getMonth() + 1)}`, required: true },
        { name: 'weekday', label: 'Jour de la FI', type: 'select', value: 2, options: WEEKDAYS },
        { name: 'time', label: 'Heure', type: 'time', value: '19:00', required: true },
        { name: 'title', label: 'Intitulé', value: 'FI — rencontre hebdomadaire', required: true, maxlength: 120 },
        { name: 'location', label: 'Lieu', maxlength: 120, placeholder: 'Salle habituelle' },
        { name: 'outing', label: 'La 1re date du mois est une sortie fraternelle', type: 'checkbox', value: true },
      ],
      onSubmit: async d => {
        const [y, mo] = d.month.split('-').map(Number);
        const today = startOfToday();
        const taken = new Set(state.events.map(e => isoDate(eventDate(e))));
        const dates = [];
        for (let day = 1; day <= 31; day++) {
          const dt = new Date(y, mo - 1, day);
          if (dt.getMonth() !== mo - 1) break;
          if (dt.getDay() === Number(d.weekday)) dates.push(dt);
        }
        let created = 0;
        for (const [i, dt] of dates.entries()) {
          if (dt < today || taken.has(isoDate(dt))) continue;
          const outing = d.outing && i === 0;
          await api.save('fi_events', {
            title: outing ? 'Sortie fraternelle FI' : d.title,
            starts_at: new Date(`${isoDate(dt)}T${d.time}`).toISOString(),
            location: nn(d.location),
            notes: outing ? 'Sortie du premier rendez-vous du mois.' : null,
            audience: 'all',
          });
          created++;
        }
        toast(created ? `${created} date${created > 1 ? 's' : ''} ajoutée${created > 1 ? 's' : ''} au planning.` : 'Aucune nouvelle date : le mois est déjà planifié.');
      },
    });
  }

  const freeMembers = keepId => state.members.filter(m => !m.user_id || m.id === keepId);

  function inviteForm() {
    const memberRole = state.roles.find(r => r.system_key === 'member');
    openForm({
      title: 'Inviter une personne',
      submitLabel: LIVE ? 'Envoyer l’invitation' : 'Simuler l’invitation',
      fields: [
        { name: 'display_name', label: 'Nom affiché', required: true, maxlength: 80, list: 'dlMembers', hint: 'Choisir le nom d’un membre relie automatiquement sa fiche.' },
        { name: 'email', label: 'Adresse e-mail', type: 'email', required: true, maxlength: 254, hint: 'La personne recevra un lien pour choisir son mot de passe.' },
        { name: 'member_id', label: 'Fiche membre liée (espace membre)', type: 'select', value: '', options: [['', 'Aucune (responsable sans fiche)'], ...freeMembers().map(m => [m.id, m.display_name])] },
        { name: 'role_ids', label: 'Rôles', type: 'checklist', value: memberRole ? [memberRole.id] : [], options: roleOptions() },
      ],
      onSubmit: async d => {
        const role_ids = d.role_ids || [];
        if (!role_ids.length) throw new Error('Choisissez au moins un rôle.');
        const r = await api.invite({ email: d.email, display_name: d.display_name, role_ids, member_id: nn(d.member_id) });
        toast(r?.status === 'existing' ? 'Compte existant : rôles attribués.' : LIVE ? 'Invitation envoyée.' : 'Invitation simulée (démo) : aucun e-mail envoyé.');
      },
    });
  }

  function accountForm(p) {
    const self = p.user_id === state.userId;
    openForm({
      title: `Gérer : ${p.display_name}`,
      fields: [
        { name: 'display_name', label: 'Nom affiché', value: p.display_name, required: true, maxlength: 80, list: 'dlMembers' },
        { name: 'role_ids', label: 'Rôles (cumulables, comme sur Discord)', type: 'checklist', value: p.role_ids, options: roleOptions(), hint: self ? 'Vous ne pouvez pas retirer le dernier rôle administrateur de la FI.' : '' },
        { name: 'member_id', label: 'Fiche membre liée', type: 'select', value: p.member_id || '', options: [['', 'Aucune'], ...freeMembers(p.member_id).map(m => [m.id, m.display_name])], hint: 'Un compte lié à une fiche voit les événements où ce membre est invité.' },
        { name: 'active', label: self ? 'Accès actif (vous ne pouvez pas vous retirer l’accès)' : 'Accès actif', type: 'checkbox', value: p.active },
      ],
      onSubmit: d => api.saveAccount(p.user_id, { display_name: d.display_name, active: self ? true : Boolean(d.active), role_ids: d.role_ids || [], member_id: nn(d.member_id) }),
    });
  }

  function roleForm(r = {}) {
    openForm({
      title: r.id ? `Rôle : ${r.name}` : 'Créer un rôle',
      fields: [
        { name: 'name', label: 'Nom du rôle', value: r.name, required: true, maxlength: 40, placeholder: 'Ex. Équipe louange, Accueil, Intercession…' },
        { name: 'color', label: 'Couleur', type: 'swatches', value: r.color || ROLE_SWATCHES[3] },
        { name: 'permissions', label: 'Permissions', type: 'checklist', value: r.permissions || [],
          options: Object.entries(PERMS).map(([k, [label, desc]]) => ({ value: k, label, desc })),
          hint: 'Sans aucune permission, le rôle donne accès à l’espace membre : ses événements, ses tâches, son compte.' },
      ],
      onSubmit: d => {
        // Pastille cochée en priorité ; sinon la couleur libre (choisir une couleur libre décoche les pastilles).
        const color = safeColor(d.color || d.color_custom);
        const position = r.id ? r.position : Math.max(0, ...state.roles.filter(x => x.system_key !== 'admin').map(x => x.position)) + 1;
        return api.saveRole({ id: r.id, name: d.name, color, permissions: d.permissions || [], position });
      },
      onDelete: r.id && !r.system_key ? () => api.deleteRole(r.id) : null,
      deleteLabel: 'Supprimer le rôle',
    });
  }

  $('#modalForm').addEventListener('submit', e => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.reportValidity()) return;
    const fd = new FormData(form);
    const data = {};
    for (const k of new Set(fd.keys())) {
      const multi = form.querySelector(`[name="${k}"][data-multi]`);
      const all = fd.getAll(k).map(v => (typeof v === 'string' ? v.trim() : v));
      data[k] = multi ? all : all[0];
    }
    $$('[data-multi]', form).forEach(el => { if (!(el.name in data)) data[el.name] = []; });
    runModal(() => modalSubmit(data));
  });
  $('#modalCancel').onclick = () => $('#modal').close();
  $('#modalDelete').onclick = () => {
    if (modalDelete && confirm('Supprimer définitivement cet élément ?')) runModal(modalDelete);
  };

  // ───────────────────────── Actions (délégation) ─────────────────────────
  async function act(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); } catch (err) { toast(friendlyError(err)); }
    await refresh();
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('button,[data-go]');
    if (!t) return;
    const ds = t.dataset;
    if (ds.go) showView(ds.go);
    else if (ds.view) showView(ds.view);
    else if (ds.editMember) memberForm(state.members.find(x => x.id === ds.editMember));
    else if (ds.editEvent) eventForm(state.events.find(x => x.id === ds.editEvent));
    else if (ds.editFollow) followForm(state.followups.find(x => x.id === ds.editFollow));
    else if (ds.editTask) taskForm(state.tasks.find(x => x.id === ds.editTask));
    else if (ds.editAccount) accountForm(state.people.find(x => x.user_id === ds.editAccount));
    else if (ds.editRole) roleForm(state.roles.find(x => x.id === ds.editRole));
    else if (ds.roleUp) act(() => api.moveRole(ds.roleUp, 'up'));
    else if (ds.roleDown) act(() => api.moveRole(ds.roleDown, 'down'));
    else if (ds.followDone) { celebrate(t); act(() => api.save('follow_ups', { id: ds.followDone, status: 'done' }), 'Suivi marqué comme fait.'); }
    else if (ds.followMember) {
      const m = state.members.find(x => x.id === ds.followMember);
      const due = new Date(); due.setDate(due.getDate() + 3);
      if (m) followForm({ contact_label: m.display_name.slice(0, 60), next_action: 'Prendre des nouvelles après plusieurs absences.', owner_user_id: m.tutor_user_id || state.userId, due_at: isoDate(due) });
    } else if (ds.remindEvent) {
      const ev = state.events.find(x => x.id === ds.remindEvent);
      if (ev && confirm(`Envoyer maintenant un rappel par e-mail pour « ${ev.title} » aux personnes concernées ?`)) {
        t.disabled = true;
        api.notify({ kind: 'event', event_id: ev.id })
          .then(r => toast(r.demo ? 'Démonstration : aucun e-mail envoyé.' : `Rappel envoyé à ${r.sent} personne${r.sent > 1 ? 's' : ''}.`))
          .catch(err => toast(friendlyError(err)))
          .finally(() => { t.disabled = false; });
      }
    }
  });

  // Info-bulles des graphiques (souris et clavier).
  const tip = $('#chartTip');
  const showTip = (el, x, y) => { tip.textContent = el.dataset.tip; tip.hidden = false; const w = tip.offsetWidth; tip.style.left = `${Math.min(Math.max(8, x - w / 2), innerWidth - w - 8)}px`; tip.style.top = `${y - 40}px`; };
  document.addEventListener('mousemove', e => {
    const el = e.target.closest?.('[data-tip]');
    if (el) showTip(el, e.clientX, e.clientY); else tip.hidden = true;
  });
  document.addEventListener('focusin', e => {
    const el = e.target.closest?.('[data-tip]');
    if (el) { const r = el.getBoundingClientRect(); showTip(el, r.left + r.width / 2, r.top); } else tip.hidden = true;
  });

  document.addEventListener('change', e => {
    const t = e.target;
    const ds = t.dataset;
    if (ds.taskDone) { if (t.checked) celebrate(t); act(() => api.save('tasks', { id: ds.taskDone, status: t.checked ? 'done' : 'todo' })); }
    else if (ds.taskStatus) { if (t.value === 'done') celebrate(t); act(() => api.save('tasks', { id: ds.taskStatus, status: t.value })); }
    else if (t.classList.contains('presence-check')) updatePresentCount();
    else if (t.name === 'photo' && t.files?.[0]) {
      const box = t.closest('.photo-field')?.querySelector('.mini-avatar');
      if (box) { const url = URL.createObjectURL(t.files[0]); box.classList.add('has-photo'); box.innerHTML = `<img src="${url}" alt="">`; }
    } else if (t.name === 'audience' && t.closest('#modal')) {
      const box = $('#modal [data-field="participants"]');
      if (box) box.hidden = t.value !== 'selected';
    } else if (t.name === 'color_custom') {
      $$('#modal input[name=color]').forEach(r => { r.checked = false; });
    }
  });

  // Suggestion : choisir un nom de membre dans l'invitation relie automatiquement sa fiche.
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'f_display_name' && $('#f_member_id')) {
      const m = state.members.find(x => norm(x.display_name) === norm(t.value) && !x.user_id);
      if (m) $('#f_member_id').value = m.id;
    }
  });

  $('#addMember').onclick = () => memberForm();
  $('#addEvent').onclick = () => eventForm();
  $('#addFollow').onclick = () => followForm();
  $('#addTask').onclick = () => taskForm();
  $('#inviteBtn').onclick = () => inviteForm();
  $('#addRole').onclick = () => roleForm();
  $('#planMonth').onclick = () => monthPlanForm();
  $('#exportCsv').onclick = () => exportAttendanceCsv();
  $('#memberSearch').oninput = renderMembers;
  $('#menu').onclick = () => $('#sidebar').classList.toggle('open');
  $('#attEvent').onchange = e => { state.attEventId = e.target.value; renderAttendance(); };
  $('#saveAttendance').onclick = () => {
    if (!state.attEventId) return;
    const entries = $$('.presence-check').map(b => ({ member_id: b.dataset.member, state: b.checked ? 'present' : 'absent' }));
    act(() => api.saveAttendance(state.attEventId, entries), 'Présences enregistrées.');
  };

  $('#prefsForm').addEventListener('submit', e => {
    e.preventDefault();
    const prefs = {};
    $$('#prefsForm input[type=checkbox]').forEach(cb => { prefs[cb.name] = cb.checked; });
    act(() => api.savePrefs(prefs), 'Préférences de rappels enregistrées.');
  });
  $('#testMail').onclick = async () => {
    const b = $('#testMail');
    b.disabled = true;
    try {
      const r = await api.notify({ kind: 'test' });
      toast(r.demo ? 'Démonstration : aucun e-mail envoyé.' : `E-mail de test envoyé à ${state.email}.`);
    } catch (err) { toast(friendlyError(err)); } finally { b.disabled = false; }
  };
  $('#accountPassword').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.currentTarget;
    const msg = $('#accountPwdMsg');
    if (f.password.value.length < 10) { msg.textContent = 'Au moins 10 caractères.'; return; }
    if (f.password.value !== f.confirm.value) { msg.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
    try {
      await api.changePassword(f.password.value);
      f.reset(); msg.textContent = '';
      toast(LIVE ? 'Mot de passe modifié.' : 'Démonstration : rien n’a été modifié.');
    } catch (err) { msg.textContent = friendlyError(err); }
  });

  // ───────────────────────── Authentification (mode connecté) ─────────────────────────
  function authMessage(text, isError) {
    const el = $('#authMsg');
    el.textContent = text || '';
    el.classList.toggle('error', Boolean(isError));
  }

  function showAuth(mode, msg, isError) {
    clearData();
    document.body.classList.remove('booting');
    $('#app').hidden = true;
    $('#auth').hidden = false;
    $$('#auth [data-auth]').forEach(f => { f.hidden = f.dataset.auth !== mode; });
    authMessage(msg, isError);
    $(`#auth [data-auth="${mode}"] input`)?.focus();
  }

  function hideAuth() {
    $('#auth').hidden = true;
    $('#app').hidden = false;
    authMessage('');
  }

  function clearData() {
    Object.assign(state, emptyData(), { memberships: [], orgId: null, userId: null });
    if (state.ready) renderAll();
  }

  async function withBusy(form, fn) {
    const btn = form.querySelector('.auth-submit');
    btn.disabled = true;
    try { await fn(); } finally { btn.disabled = false; }
  }

  function siteUrl() { return cfg.siteUrl || `${location.origin}${location.pathname}`; }

  function bindAuthForms() {
    $$('[data-auth-go]').forEach(b => { b.onclick = () => showAuth(b.dataset.authGo); });

    $('#loginForm').addEventListener('submit', e => {
      e.preventDefault();
      const f = e.currentTarget;
      withBusy(f, async () => {
        authMessage('Connexion…');
        const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
        if (error) { authMessage(/Invalid login/i.test(error.message) ? 'Adresse ou mot de passe incorrect.' : friendlyError(error), true); return; }
        f.reset();
        await enterApp();
      });
    });

    $('#forgotForm').addEventListener('submit', e => {
      e.preventDefault();
      const f = e.currentTarget;
      withBusy(f, async () => {
        await sb.auth.resetPasswordForEmail(f.email.value.trim(), { redirectTo: siteUrl() });
        // Même message dans tous les cas : ne révèle pas si un compte existe.
        authMessage('Si un compte existe pour cette adresse, un lien de réinitialisation vient d’être envoyé.');
      });
    });

    $('#passwordForm').addEventListener('submit', e => {
      e.preventDefault();
      const f = e.currentTarget;
      if (f.password.value.length < 10) { authMessage('Le mot de passe doit contenir au moins 10 caractères.', true); return; }
      if (f.password.value !== f.confirm.value) { authMessage('Les deux mots de passe ne correspondent pas.', true); return; }
      withBusy(f, async () => {
        const { error } = await sb.auth.updateUser({ password: f.password.value });
        if (error) { authMessage(friendlyError(error), true); return; }
        f.reset();
        history.replaceState(null, '', location.pathname + location.search);
        toast('Mot de passe enregistré.');
        await enterApp();
      });
    });

    $('#noAccessLogout').onclick = () => sb.auth.signOut();
    $('#logout').onclick = async () => { await sb.auth.signOut(); };
    $('#orgSelect').onchange = async e => {
      const m = state.memberships.find(x => x.organization_id === e.target.value);
      if (m) { selectMembership(m); safeSet('fi.org', m.organization_id); await refresh(); }
    };
  }

  function selectMembership(m) {
    state.orgId = m.organization_id;
    state.orgName = m.organizations?.name || 'FI';
    state.displayName = m.display_name || state.email.split('@')[0];
    state.attEventId = null;
  }

  async function enterApp() {
    const { data: { user }, error } = await sb.auth.getUser(); // vérifié auprès du serveur
    if (error || !user) { showAuth('login'); return; }
    const { data, error: rolesErr } = await sb.from('user_roles')
      .select('organization_id, display_name, organizations(name)')
      .eq('user_id', user.id).eq('active', true);
    if (rolesErr) { showAuth('login', friendlyError(rolesErr), true); return; }
    if (!data.length) {
      showAuth('noaccess', 'Votre compte n’a pas (ou plus) d’accès actif à une FI. Contactez l’administrateur.', true);
      return;
    }
    state.userId = user.id;
    state.email = user.email || '';
    state.memberships = data;
    const saved = safeGet('fi.org');
    selectMembership(data.find(x => x.organization_id === saved) || data[0]);
    const sel = $('#orgSelect');
    sel.hidden = data.length < 2;
    sel.innerHTML = data.map(m => `<option value="${esc(m.organization_id)}" ${m.organization_id === state.orgId ? 'selected' : ''}>${esc(m.organizations?.name || 'FI')}</option>`).join('');
    hideAuth();
    await refresh();
    document.body.classList.remove('booting');
  }

  async function bootLive() {
    document.body.classList.add('live');
    if (isSecretKey(cfg.supabaseAnonKey)) {
      showAuth('noaccess', 'Configuration refusée : config.js contient une clé SECRÈTE (service_role). Retirez-la immédiatement, régénérez-la dans Supabase et utilisez uniquement la clé publique anon / publishable.', true);
      $('#noAccessLogout').hidden = true;
      return;
    }
    if (!window.supabase?.createClient) {
      showAuth('noaccess', 'Bibliothèque Supabase indisponible (connexion Internet requise).', true);
      $('#noAccessLogout').hidden = true;
      return;
    }
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
    });
    bindAuthForms();
    sb.auth.onAuthStateChange(event => {
      // Pas d'appel réseau directement dans ce rappel (recommandation supabase-js) : on diffère.
      if (event === 'PASSWORD_RECOVERY') setTimeout(() => showAuth('password', 'Choisissez un nouveau mot de passe.'));
      if (event === 'SIGNED_OUT') setTimeout(() => showAuth('login', 'Vous êtes déconnecté.'));
    });

    const { data: { session } } = await sb.auth.getSession();
    if (authLinkError) { showAuth('login', `Lien invalide ou expiré (${authLinkError}). Demandez une nouvelle invitation ou un nouveau lien.`, true); return; }
    if (!session) { showAuth('login'); return; }
    if (authLinkType === 'invite') { showAuth('password', 'Bienvenue ! Choisissez votre mot de passe pour activer votre accès.'); return; }
    if (authLinkType === 'recovery') { showAuth('password', 'Choisissez un nouveau mot de passe.'); return; }
    await enterApp();
  }

  function bootDemo() {
    demo = buildDemo();
    setDemoAccount('fi_leader');
    $('#role').value = 'fi_leader';
    $('#role').onchange = e => {
      setDemoAccount(e.target.value);
      refresh();
      toast(`Aperçu : vous êtes ${state.displayName} (${e.target.selectedOptions[0].textContent}).`);
    };
    refresh().then(() => document.body.classList.remove('booting'));
  }

  addSparks($('.welcome'), 14);
  addSparks($('#auth'), 18);
  state.ready = true;
  if (LIVE) bootLive().catch(err => showAuth('login', friendlyError(err), true));
  else bootDemo();
})();
