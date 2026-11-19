/* FI espace — logique de l'application.
 *
 * Deux modes :
 *  - Démonstration : aucune configuration Supabase (ou ?demo dans l'URL). Données fictives en mémoire,
 *    le sélecteur de rôle sert d'aperçu et n'a aucune valeur de sécurité.
 *  - Connecté : Supabase Auth (invitation uniquement) + base PostgreSQL.
 *
 * Important : l'interface masque ce qu'un rôle ne peut pas faire, par confort. La sécurité réelle
 * est appliquée par la base (RLS + triggers, voir database/) et par la fonction serveur invite-user.
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

  const ROLE_LABELS = { admin: 'Administrateur', fi_leader: 'Responsable FI', deputy: 'Responsable adjoint' };
  const MEMBER_STATUS = { active: 'Actif', occasional: 'Occasionnel', to_contact: 'À recontacter', former: 'Ancien membre' };
  const FOLLOW_STATUS = { open: 'À planifier', planned: 'Planifié', done: 'Terminé' };
  const TASK_STATUS = { todo: 'À faire', in_progress: 'En cours', done: 'Terminé' };
  const VIEW_LABELS = { dashboard: 'Vue d’ensemble', members: 'Membres', attendance: 'Présences', followups: 'Suivis & contacts', calendar: 'Planning FI', tasks: 'Tâches', admin: 'Administration' };
  const DEPUTY_VIEWS = ['dashboard', 'calendar', 'tasks'];

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
  const state = {
    role: 'fi_leader', userId: null, email: '', displayName: '', orgId: null, orgName: '',
    memberships: [], people: [], members: [], events: [], attendance: [], followups: [], tasks: [],
    attEventId: null, view: 'dashboard', ready: false,
  };
  const isLeader = () => state.role === 'admin' || state.role === 'fi_leader';
  const isAdmin = () => state.role === 'admin';
  const allowedView = v => (v === 'admin' ? isAdmin() : state.role !== 'deputy' || DEPUTY_VIEWS.includes(v));

  // ───────────────────────── Données de démonstration (fictives) ─────────────────────────
  let demo = null;
  let demoSeq = 100;
  const DEMO_USERS = { admin: 'demo-admin', fi_leader: 'demo-marie', deputy: 'demo-thomas' };

  function buildDemo() {
    const today = startOfToday();
    const nextTue = new Date(today); nextTue.setDate(today.getDate() + ((2 - today.getDay() + 7) % 7));
    const at = (days, h = 19, m = 0) => { const d = new Date(nextTue); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d.toISOString(); };
    const day = n => { const d = new Date(today); d.setDate(d.getDate() + n); return isoDate(d); };
    const people = [
      { user_id: 'demo-admin', display_name: 'Admin (démo)', email: 'admin@exemple.test', role: 'admin', active: true },
      { user_id: 'demo-marie', display_name: 'Marie', email: 'marie@exemple.test', role: 'fi_leader', active: true },
      { user_id: 'demo-thomas', display_name: 'Thomas', email: 'thomas@exemple.test', role: 'deputy', active: true },
      { user_id: 'demo-lea', display_name: 'Léa', email: 'lea@exemple.test', role: 'deputy', active: true },
      { user_id: 'demo-hugo', display_name: 'Hugo', email: 'hugo@exemple.test', role: 'deputy', active: true },
    ];
    const members = [
      ['Camille Martin', 'Mardi soir · Week-end', 'active', 'demo-marie'],
      ['Hugo Bernard', 'Mardi soir', 'active', 'demo-marie'],
      ['Léa Petit', 'À confirmer', 'active', 'demo-thomas'],
      ['Noah Robert', 'Week-end', 'occasional', 'demo-thomas'],
      ['Sarah Moreau', 'Mardi soir · Week-end', 'active', 'demo-marie'],
      ['Elias Laurent', 'Mardi soir', 'to_contact', 'demo-marie'],
      ['Inès Simon', 'À confirmer', 'active', 'demo-thomas'],
    ].map(([display_name, availability, status, referent_user_id], i) => ({ id: `dm${i}`, display_name, availability, status, referent_user_id }));
    const events = [
      ['de-4', 'FI — rencontre hebdomadaire', at(-28), 'Salle habituelle'],
      ['de-3', 'FI — rencontre hebdomadaire', at(-21), 'Salle habituelle'],
      ['de-2', 'FI — rencontre hebdomadaire', at(-14), 'Salle habituelle'],
      ['de-1', 'FI — rencontre hebdomadaire', at(-7), 'Salle habituelle'],
      ['de0', 'FI — rencontre hebdomadaire', at(0), 'Salle habituelle'],
      ['de1', 'FI — rencontre hebdomadaire', at(7), 'Salle habituelle'],
      ['de2', 'Sortie FI — activité collective', at(11, 14), 'Lieu à confirmer'],
      ['de3', 'FI — rencontre hebdomadaire', at(14), 'Salle habituelle'],
      ['de4', 'FI — rencontre hebdomadaire', at(21), 'Salle habituelle'],
      ['de5', 'Temps convivial de fin d’année', at(25, 18, 30), 'Horaire à confirmer'],
    ].map(([id, title, starts_at, location]) => ({ id, title, starts_at, ends_at: null, location, notes: null }));
    const pattern = [[1, 1, 1, 1], [1, 0, 1, 1], [0, 1, 1, 0], [0, 0, 1, 0], [1, 1, 1, 1], [0, 0, 0, 0], [1, 1, 0, 1]];
    const attendance = [];
    ['de-4', 'de-3', 'de-2', 'de-1'].forEach((ev, j) => members.forEach((m, i) =>
      attendance.push({ event_id: ev, member_id: m.id, state: pattern[i][j] ? 'present' : 'absent' })));
    const followups = [
      ['Contact A.', 'Prendre des nouvelles et proposer un moment d’échange.', 'demo-marie', day(2), 'open'],
      ['Contact B.', 'Faire un suivi après la rencontre de groupe.', 'demo-thomas', day(5), 'planned'],
      ['Contact C.', 'Envoyer les informations pratiques demandées.', 'demo-marie', day(6), 'open'],
      ['Contact D.', 'Proposer une date pour reprendre contact.', 'demo-lea', day(9), 'open'],
    ].map(([contact_label, next_action, owner_user_id, due_at, status], i) => ({ id: `df${i}`, contact_label, next_action, owner_user_id, due_at, status }));
    const tasks = [
      ['Confirmer la salle pour mardi', 'demo-marie', day(2), 'in_progress'],
      ['Préparer le déroulé de la rencontre', 'demo-thomas', day(4), 'todo'],
      ['Accueillir les nouveaux à l’entrée', 'demo-thomas', day(5), 'todo'],
      ['Partager le rappel de la sortie FI', 'demo-lea', day(6), 'todo'],
      ['Mettre à jour la liste de présence', 'demo-marie', day(-2), 'done'],
      ['Vérifier le matériel de réunion', 'demo-hugo', day(-2), 'done'],
    ].map(([title, assigned_to, due_at, status], i) => ({ id: `dt${i}`, title, description: null, assigned_to, due_at, status }));
    return { people, members, events, attendance, followups, tasks };
  }

  function setDemoRole(role) {
    state.role = role;
    state.userId = DEMO_USERS[role];
    state.displayName = demo.people.find(p => p.user_id === state.userId).display_name;
    state.orgName = 'FI de démonstration';
  }

  // Reproduit en mémoire ce que la RLS laisse lire à chaque rôle.
  function loadDemo() {
    const leader = isLeader();
    state.events = clone(demo.events);
    state.tasks = clone(leader ? demo.tasks : demo.tasks.filter(t => t.assigned_to === state.userId));
    state.members = leader ? clone(demo.members) : [];
    state.attendance = leader ? clone(demo.attendance) : [];
    state.followups = leader ? clone(demo.followups) : [];
    state.people = leader ? clone(demo.people).map(p => (isAdmin() ? p : { ...p, email: null })).filter(p => p.active || isAdmin()) : [];
  }

  const DEMO_TABLES = { fi_members: 'members', fi_events: 'events', follow_ups: 'followups', tasks: 'tasks' };
  function demoDenied() { const e = new Error('Action refusée : votre rôle ne permet pas cette modification.'); e.demo = true; return e; }

  function demoSave(table, row) {
    const list = demo[DEMO_TABLES[table]];
    if (table === 'tasks' && row.id && !isLeader()) {
      const t = list.find(x => x.id === row.id);
      const onlyStatus = Object.keys(row).every(k => k === 'id' || k === 'status');
      if (!t || t.assigned_to !== state.userId || !onlyStatus) throw demoDenied();
    } else if (!isLeader()) throw demoDenied();
    if (row.id) Object.assign(list.find(x => x.id === row.id), row);
    else list.push({ ...row, id: `d${++demoSeq}` });
  }

  // ───────────────────────── Accès aux données ─────────────────────────
  function friendlyError(err) {
    const msg = String(err?.message || err || '');
    if (/row-level security|permission denied|42501/i.test(msg)) return 'Action refusée : votre rôle ne permet pas cette modification.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Connexion au serveur impossible. Vérifiez votre réseau.';
    if (/JWT|token.*expired/i.test(msg)) return 'Session expirée : reconnectez-vous.';
    if (/violates check constraint/i.test(msg)) return 'Texte trop long ou valeur invalide.';
    return msg || 'Une erreur est survenue.';
  }

  async function loadLive() {
    const org = state.orgId;
    const since = new Date(Date.now() - 120 * 864e5).toISOString();
    const reqs = {
      events: sb.from('fi_events').select('id,title,starts_at,ends_at,location,notes').eq('organization_id', org).gte('starts_at', since).order('starts_at'),
      tasks: sb.from('tasks').select('id,title,description,assigned_to,due_at,status').eq('organization_id', org).order('due_at', { ascending: true, nullsFirst: false }),
    };
    if (isLeader()) {
      reqs.members = sb.from('fi_members').select('id,display_name,status,availability,referent_user_id').eq('organization_id', org).order('display_name');
      reqs.followups = sb.from('follow_ups').select('id,contact_label,next_action,owner_user_id,due_at,status').eq('organization_id', org).order('due_at', { ascending: true, nullsFirst: false });
      reqs.people = sb.rpc('list_org_people', { target_org: org });
    }
    const keys = Object.keys(reqs);
    const results = await Promise.all(Object.values(reqs));
    const next = { members: [], followups: [], people: [], attendance: [] };
    results.forEach((r, i) => { if (r.error) throw r.error; next[keys[i]] = r.data || []; });
    if (isLeader() && next.events.length) {
      const { data, error } = await sb.from('attendance').select('event_id,member_id,state')
        .eq('organization_id', org).in('event_id', next.events.map(e => e.id));
      if (error) throw error;
      next.attendance = data || [];
    }
    Object.assign(state, next);
  }

  const api = {
    async load() { if (LIVE) await loadLive(); else loadDemo(); },

    async save(table, row) {
      if (!LIVE) return demoSave(table, row);
      const { id, ...fields } = row;
      const q = id
        ? sb.from(table).update(fields).eq('id', id).eq('organization_id', state.orgId).select('id')
        : sb.from(table).insert({ ...fields, organization_id: state.orgId }).select('id');
      const { data, error } = await q;
      if (error) throw error;
      if (!data || !data.length) throw new Error('Action refusée : votre rôle ne permet pas cette modification.');
    },

    async remove(table, id) {
      if (!LIVE) {
        if (!isLeader()) throw demoDenied();
        const key = DEMO_TABLES[table];
        demo[key] = demo[key].filter(x => x.id !== id);
        if (table === 'fi_members') demo.attendance = demo.attendance.filter(a => a.member_id !== id);
        if (table === 'fi_events') demo.attendance = demo.attendance.filter(a => a.event_id !== id);
        return;
      }
      const { data, error } = await sb.from(table).delete().eq('id', id).eq('organization_id', state.orgId).select('id');
      if (error) throw error;
      if (!data || !data.length) throw new Error('Suppression refusée.');
    },

    async saveAttendance(eventId, entries) {
      if (!LIVE) {
        if (!isLeader()) throw demoDenied();
        demo.attendance = demo.attendance.filter(a => a.event_id !== eventId).concat(entries.map(e => ({ ...e, event_id: eventId })));
        return;
      }
      const rows = entries.map(e => ({ ...e, event_id: eventId, organization_id: state.orgId }));
      const { error } = await sb.from('attendance').upsert(rows, { onConflict: 'event_id,member_id' });
      if (error) throw error;
    },

    async updateAccount(userId, patch) {
      if (!LIVE) {
        if (!isAdmin()) throw demoDenied();
        const p = demo.people.find(x => x.user_id === userId);
        const next = { ...p, ...patch };
        const otherAdmins = demo.people.filter(x => x.user_id !== userId && x.role === 'admin' && x.active).length;
        if (p.role === 'admin' && p.active && (next.role !== 'admin' || !next.active) && !otherAdmins)
          throw new Error('Impossible de retirer le dernier administrateur de l’organisation');
        Object.assign(p, patch);
        return;
      }
      const { data, error } = await sb.from('user_roles').update(patch)
        .eq('user_id', userId).eq('organization_id', state.orgId).select('user_id');
      if (error) throw error;
      if (!data || !data.length) throw new Error('Modification refusée.');
    },

    async invite({ email, display_name, role }) {
      if (!LIVE) {
        if (!isAdmin()) throw demoDenied();
        demo.people.push({ user_id: `demo-${++demoSeq}`, display_name, email, role, active: true });
        return { status: 'demo' };
      }
      const { data, error } = await sb.functions.invoke('invite-user', {
        body: { organization_id: state.orgId, email, display_name, role },
      });
      if (error) {
        let detail = '';
        try { detail = (await error.context.json()).error; } catch { /* réponse non JSON */ }
        throw new Error(detail || 'L’invitation n’a pas pu être envoyée.');
      }
      return data;
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

  // ───────────────────────── Rendu ─────────────────────────
  const personName = uid => {
    if (!uid) return 'Non attribué';
    const p = state.people.find(x => x.user_id === uid);
    if (p) return p.display_name;
    if (uid === state.userId) return state.displayName || 'Moi';
    return 'Responsable';
  };
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

  function datebox(e) {
    const d = eventDate(e);
    return `<div class="datebox"><b>${pad(d.getDate())}</b><small>${esc(fmtMon(d))}</small></div>`;
  }
  function eventTag(e) {
    const days = (eventDate(e) - Date.now()) / 864e5;
    if (days < 7) return '<span class="tag green">À venir</span>';
    return '<span class="tag">Prévue</span>';
  }
  function eventMeta(e) {
    return [fmtTime(eventDate(e)), e.location].filter(Boolean).map(esc).join(' · ');
  }

  function metric(label, icon, value, foot) {
    return `<div class="metric"><div class="metric-top">${esc(label)} <span class="metric-icon">${icon}</span></div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></div>`;
  }

  function renderDashboard() {
    const now = new Date();
    $('#dashEyebrow').textContent = `${cap(now.toLocaleDateString('fr-FR', { weekday: 'long' }))} · Espace de coordination`;
    $('#hello').textContent = `Bonjour, ${(state.displayName || '').split(' ')[0] || 'bienvenue'}`;
    $('#todayBadge').textContent = LIVE ? state.orgName : 'Données de démonstration';

    const openTasks = state.tasks.filter(t => t.status !== 'done');
    const weekEnd = isoDate(new Date(Date.now() + 7 * 864e5));
    const dueSoon = openTasks.filter(t => t.due_at && t.due_at <= weekEnd).length;
    const next30 = upcoming().filter(e => eventDate(e) - now < 30 * 864e5).length;
    let html;
    if (isLeader()) {
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
        + metric('Suivis à mener', '♡', openFollow, 'prochaine action à organiser')
        + metric('Tâches ouvertes', '☷', openTasks.length, `${dueSoon} échéance${dueSoon > 1 ? 's' : ''} cette semaine`);
    } else {
      const doneMine = state.tasks.filter(t => t.status === 'done').length;
      html = metric('Rencontres à venir', '▦', next30, 'dans les 30 prochains jours')
        + metric('Mes tâches ouvertes', '☷', openTasks.length, `${dueSoon} échéance${dueSoon > 1 ? 's' : ''} cette semaine`)
        + metric('Tâches terminées', '✓', doneMine, 'sur vos tâches attribuées')
        + metric('Prochaine rencontre', '⌂', upcoming()[0] ? `<span style="font-size:19px">${esc(fmtLongDay(eventDate(upcoming()[0])))}</span>` : '–', upcoming()[0] ? esc(eventMeta(upcoming()[0])) : 'aucune date prévue');
    }
    $('#metrics').innerHTML = html;

    $('#dashEvents').innerHTML = upcoming().slice(0, 3).map(e =>
      `<div class="event">${datebox(e)}<div class="event-info"><b>${esc(e.title)}</b><small>${eventMeta(e)}</small></div>${eventTag(e)}</div>`).join('')
      || '<div class="empty">Aucune rencontre prévue.</div>';

    $('#dashTasksTitle').textContent = isLeader() ? 'À faire cette semaine' : 'Mes tâches';
    $('#dashTasks').innerHTML = openTasks.slice(0, isLeader() ? 3 : 5).map(t =>
      `<div class="task"><input type="checkbox" class="check" data-task-done="${esc(t.id)}" ${canEditTask(t) ? '' : 'disabled'} aria-label="Marquer « ${esc(t.title)} » comme terminée"><div class="task-copy"><b>${esc(t.title)}</b><small>${esc(personName(t.assigned_to))} · ${esc(dueLabel(t.due_at))}</small></div></div>`).join('')
      || '<div class="empty">Rien d’urgent pour le moment.</div>';
    const done = state.tasks.length - openTasks.length;
    $('#progressText').textContent = state.tasks.length ? `${done} sur ${state.tasks.length}` : '–';
    $('#progressBar').style.width = state.tasks.length ? `${(done / state.tasks.length) * 100}%` : '0';
  }

  function renderMembers() {
    const q = $('#memberSearch').value.trim().toLowerCase();
    const last5 = pastRecorded().slice(0, 5);
    const rows = state.members.filter(m => m.display_name.toLowerCase().includes(q)).map(m => {
      const recs = last5.map(e => state.attendance.find(a => a.event_id === e.id && a.member_id === m.id)).filter(Boolean);
      const present = recs.filter(a => a.state === 'present').length;
      const tagClass = m.status === 'active' ? 'green' : m.status === 'to_contact' ? 'orange' : '';
      return `<tr><td><div class="person"><div class="mini-avatar">${esc(initials(m.display_name))}</div><div>${esc(m.display_name)}${LIVE ? '' : '<small>Données de démonstration</small>'}</div></div></td>`
        + `<td>${esc(m.availability || '—')}</td><td><span class="tag ${tagClass}">${esc(MEMBER_STATUS[m.status] || m.status)}</span></td>`
        + `<td>${recs.length ? `${present} / ${recs.length}` : '—'}</td><td>${esc(m.referent_user_id ? personName(m.referent_user_id) : '—')}</td>`
        + `<td><button class="row-btn leader-only" data-edit-member="${esc(m.id)}">Modifier</button></td></tr>`;
    });
    $('#memberRows').innerHTML = rows.join('')
      || `<tr><td colspan="6" class="empty">${state.members.length ? 'Aucun résultat.' : 'Aucun membre pour le moment.'}</td></tr>`;
  }

  function attendanceEvents() { return [...state.events].sort((a, b) => eventDate(b) - eventDate(a)); }

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
      return `<div class="attendance-person"><div class="mini-avatar">${esc(initials(m.display_name))}</div><b style="font-size:12px">${esc(m.display_name)}</b><span class="spacer"></span><span class="availability">${esc(m.availability || '')}</span><input class="check presence-check" type="checkbox" data-member="${esc(m.id)}" ${rec?.state === 'present' ? 'checked' : ''} ${isLeader() ? '' : 'disabled'} aria-label="${esc(m.display_name)} présent"></div>`;
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
    const open = list.filter(f => f.status !== 'done').length;
    $('#followTag').textContent = `${open} à mener`;
    $('#followRows').innerHTML = list.map(f => {
      const tag = f.status === 'done' ? 'green' : 'orange';
      return `<div class="follow-card ${f.status === 'done' ? 'done' : ''}"><div><h4>${esc(f.contact_label)} <span class="tag ${tag}">${esc(FOLLOW_STATUS[f.status])}</span></h4><p>${esc(f.next_action)}</p>`
        + `<small>Référent : ${esc(personName(f.owner_user_id))} · Prochaine étape : ${esc(f.due_at ? fmtDayMonth(parseDay(f.due_at)) : 'à définir')}</small></div>`
        + `<div class="follow-actions leader-only">${f.status !== 'done' ? `<button class="row-btn" data-follow-done="${esc(f.id)}">✓ Fait</button>` : ''}<button class="row-btn" data-edit-follow="${esc(f.id)}">Modifier</button></div></div>`;
    }).join('') || '<div class="empty">Aucun suivi en cours.</div>';
  }

  function renderCalendar() {
    $('#calendarRows').innerHTML = upcoming().map(e =>
      `<div class="calendar-item">${datebox(e)}<div><h3>${esc(e.title)}</h3><p>${esc(cap(eventDate(e).toLocaleDateString('fr-FR', { weekday: 'long' })))} · ${eventMeta(e)}</p>${e.notes ? `<p style="margin-top:6px">${esc(e.notes)}</p>` : ''}`
      + `${eventTag(e).replace('class="tag', 'style="display:inline-block;margin-top:10px" class="tag')}<button class="row-btn leader-only" data-edit-event="${esc(e.id)}">Modifier</button></div></div>`).join('')
      || '<div class="panel empty">Aucune date à venir.</div>';
  }

  const canEditTask = t => isLeader() || t.assigned_to === state.userId;

  function renderTasks() {
    const order = { in_progress: 0, todo: 1, done: 2 };
    const list = [...state.tasks].sort((a, b) => order[a.status] - order[b.status] || String(a.due_at || '9').localeCompare(String(b.due_at || '9')));
    $('#taskTag').textContent = isLeader() ? `${list.filter(t => t.status !== 'done').length} ouvertes` : 'Mes tâches';
    $('#taskRows').innerHTML = list.map(t => {
      const can = canEditTask(t);
      const tag = t.status === 'done' ? 'green' : t.status === 'in_progress' ? 'orange' : '';
      const control = can
        ? `<select class="status-select" data-task-status="${esc(t.id)}" aria-label="Avancement">${Object.entries(TASK_STATUS).map(([v, l]) => `<option value="${v}" ${v === t.status ? 'selected' : ''}>${l}</option>`).join('')}</select>`
        : `<span class="tag ${tag}">${esc(TASK_STATUS[t.status])}</span>`;
      return `<div class="task ${t.status === 'done' ? 'done' : ''}"><input type="checkbox" class="check" data-task-done="${esc(t.id)}" ${t.status === 'done' ? 'checked' : ''} ${can ? '' : 'disabled'} aria-label="Marquer « ${esc(t.title)} » comme terminée">`
        + `<div class="task-copy"><b>${esc(t.title)}</b><small>${esc(personName(t.assigned_to))} · ${esc(dueLabel(t.due_at))}</small>${t.description ? `<small>${esc(t.description)}</small>` : ''}</div>`
        + `<div class="task-actions">${control}<button class="row-btn leader-only" data-edit-task="${esc(t.id)}">Modifier</button></div></div>`;
    }).join('') || `<div class="empty">${isLeader() ? 'Aucune tâche pour le moment.' : 'Aucune tâche attribuée pour le moment.'}</div>`;
  }

  function renderAdmin() {
    if (!isAdmin()) { $('#peopleRows').innerHTML = ''; return; }
    $('#peopleRows').innerHTML = state.people.map(p => {
      const self = p.user_id === state.userId;
      return `<div class="people-row ${p.active ? '' : 'inactive'}"><div class="mini-avatar">${esc(initials(p.display_name))}</div><div class="people-info"><b>${esc(p.display_name)}${self ? ' · vous' : ''}</b><small>${esc(p.email || '')}</small></div>`
        + `<select class="status-select" data-role-user="${esc(p.user_id)}" ${self ? 'disabled' : ''} aria-label="Rôle de ${esc(p.display_name)}">${Object.entries(ROLE_LABELS).map(([v, l]) => `<option value="${v}" ${v === p.role ? 'selected' : ''}>${l}</option>`).join('')}</select>`
        + `<label class="switch"><input type="checkbox" class="check" data-active-user="${esc(p.user_id)}" ${p.active ? 'checked' : ''} ${self ? 'disabled' : ''}> Actif</label></div>`;
    }).join('') || '<div class="empty">Aucun compte.</div>';
  }

  function applyRoleUI() {
    const leader = isLeader();
    document.body.dataset.role = state.role;
    $('#adminNav').style.display = isAdmin() ? 'flex' : 'none';
    $$('.nav button').forEach(b => { if (b.id !== 'adminNav') b.style.display = allowedView(b.dataset.view) ? 'flex' : 'none'; });
    $$('.leader-only').forEach(b => { b.style.display = leader ? '' : 'none'; });
    $('#avatar').textContent = initials(state.displayName || ROLE_LABELS[state.role]);
    $('#avatar').title = state.displayName;
    $('#roleBadge').textContent = ROLE_LABELS[state.role] || '';
    $('#orgLabel').textContent = state.orgName || 'Espace connecté';
    if (!allowedView(state.view)) showView('dashboard', true);
  }

  function renderAll() {
    renderDashboard(); renderMembers(); renderAttendance(); renderFollowups(); renderCalendar(); renderTasks(); renderAdmin();
    applyRoleUI();
  }

  // ───────────────────────── Navigation ─────────────────────────
  function showView(id, silent) {
    if (!allowedView(id)) { if (!silent) toast('Cette rubrique n’est pas accessible avec votre rôle.'); return; }
    state.view = id;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === id));
    $$('.nav button').forEach(b => b.classList.toggle('active', b.dataset.view === id));
    $('#crumb').textContent = VIEW_LABELS[id];
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
    let input;
    if (f.type === 'select') {
      input = `<select ${common}>${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea ${common} rows="3" placeholder="${esc(f.placeholder || '')}">${esc(val)}</textarea>`;
    } else {
      input = `<input type="${f.type || 'text'}" ${common} value="${esc(val)}" placeholder="${esc(f.placeholder || '')}" autocomplete="${f.autocomplete || 'off'}">`;
    }
    return `<label class="field" for="${id}"><span>${esc(f.label)}${f.required ? ' *' : ''}</span>${input}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</label>`;
  }

  function openForm({ title, fields, submitLabel = 'Enregistrer', onSubmit, onDelete }) {
    $('#modalTitle').textContent = title;
    $('#modalFields').innerHTML = fields.map(fieldHtml).join('');
    $('#modalSubmit').textContent = submitLabel;
    $('#modalDelete').hidden = !onDelete;
    $('#modalError').textContent = '';
    modalSubmit = onSubmit; modalDelete = onDelete || null;
    $('#modal').showModal();
    $('#modalFields').querySelector('input,select,textarea')?.focus();
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
    [['', emptyLabel], ...state.people.filter(p => p.active).map(p => [p.user_id, `${p.display_name} · ${ROLE_LABELS[p.role]}`])];

  function memberForm(m = {}) {
    openForm({
      title: m.id ? 'Modifier le membre' : 'Ajouter un membre',
      fields: [
        { name: 'display_name', label: 'Nom affiché', value: m.display_name, required: true, maxlength: 80, hint: 'Un prénom et une initiale suffisent.' },
        { name: 'availability', label: 'Disponibilité générale', value: m.availability, maxlength: 80, placeholder: 'Mardi soir · Week-end' },
        { name: 'status', label: 'Statut', type: 'select', value: m.status || 'active', options: Object.entries(MEMBER_STATUS) },
        { name: 'referent_user_id', label: 'Référent', type: 'select', value: m.referent_user_id || '', options: peopleOptions('Aucun') },
      ],
      onSubmit: d => api.save('fi_members', { id: m.id, display_name: d.display_name, availability: nn(d.availability), status: d.status, referent_user_id: nn(d.referent_user_id) }),
      onDelete: m.id ? () => api.remove('fi_members', m.id) : null,
    });
  }

  function eventForm(e = {}) {
    const d = e.starts_at ? new Date(e.starts_at) : null;
    openForm({
      title: e.id ? 'Modifier la date' : 'Ajouter une date',
      fields: [
        { name: 'title', label: 'Intitulé', value: e.title || 'FI — rencontre hebdomadaire', required: true, maxlength: 120 },
        { name: 'date', label: 'Date', type: 'date', value: d ? isoDate(d) : '', required: true },
        { name: 'time', label: 'Heure', type: 'time', value: d ? fmtTime(d) : '19:00', required: true },
        { name: 'location', label: 'Lieu', value: e.location, maxlength: 120, placeholder: 'Salle habituelle' },
        { name: 'notes', label: 'Note pratique', type: 'textarea', value: e.notes, maxlength: 200, hint: 'Informations d’organisation uniquement.' },
      ],
      onSubmit: f => api.save('fi_events', { id: e.id, title: f.title, starts_at: new Date(`${f.date}T${f.time}`).toISOString(), location: nn(f.location), notes: nn(f.notes) }),
      onDelete: e.id ? () => api.remove('fi_events', e.id) : null,
    });
  }

  function followForm(f = {}) {
    openForm({
      title: f.id ? 'Modifier le suivi' : 'Nouveau suivi',
      fields: [
        { name: 'contact_label', label: 'Contact', value: f.contact_label, required: true, maxlength: 60, hint: 'Libellé court (ex. « Contact A. ») — pas de détails personnels.' },
        { name: 'next_action', label: 'Prochaine action', value: f.next_action, required: true, maxlength: 160 },
        { name: 'owner_user_id', label: 'Responsable désigné', type: 'select', value: f.owner_user_id || state.userId, options: peopleOptions() },
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

  function inviteForm() {
    openForm({
      title: 'Inviter un responsable',
      submitLabel: LIVE ? 'Envoyer l’invitation' : 'Simuler l’invitation',
      fields: [
        { name: 'display_name', label: 'Nom affiché', required: true, maxlength: 80 },
        { name: 'email', label: 'Adresse e-mail', type: 'email', required: true, maxlength: 254, hint: 'Un e-mail d’invitation permettra de choisir un mot de passe.' },
        { name: 'role', label: 'Rôle', type: 'select', value: 'deputy', options: Object.entries(ROLE_LABELS) },
      ],
      onSubmit: async d => {
        const r = await api.invite(d);
        toast(r?.status === 'existing' ? 'Compte existant : rôle attribué.' : LIVE ? 'Invitation envoyée.' : 'Invitation simulée (démo) : aucun e-mail envoyé.');
      },
    });
  }

  $('#modalForm').addEventListener('submit', e => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.reportValidity()) return;
    const data = {};
    new FormData(form).forEach((v, k) => { data[k] = typeof v === 'string' ? v.trim() : v; });
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
    else if (ds.followDone) act(() => api.save('follow_ups', { id: ds.followDone, status: 'done' }), 'Suivi marqué comme fait.');
  });

  document.addEventListener('change', e => {
    const t = e.target;
    const ds = t.dataset;
    if (ds.taskDone) act(() => api.save('tasks', { id: ds.taskDone, status: t.checked ? 'done' : 'todo' }));
    else if (ds.taskStatus) act(() => api.save('tasks', { id: ds.taskStatus, status: t.value }));
    else if (ds.roleUser) act(() => api.updateAccount(ds.roleUser, { role: t.value }), 'Rôle mis à jour.');
    else if (ds.activeUser) act(() => api.updateAccount(ds.activeUser, { active: t.checked }), t.checked ? 'Compte réactivé.' : 'Accès retiré.');
    else if (t.classList.contains('presence-check')) updatePresentCount();
  });

  $('#addMember').onclick = () => memberForm();
  $('#addEvent').onclick = () => eventForm();
  $('#addFollow').onclick = () => followForm();
  $('#addTask').onclick = () => taskForm();
  $('#inviteBtn').onclick = () => inviteForm();
  $('#memberSearch').oninput = renderMembers;
  $('#menu').onclick = () => $('#sidebar').classList.toggle('open');
  $('#attEvent').onchange = e => { state.attEventId = e.target.value; renderAttendance(); };
  $('#saveAttendance').onclick = () => {
    if (!state.attEventId) return;
    const entries = $$('.presence-check').map(b => ({ member_id: b.dataset.member, state: b.checked ? 'present' : 'absent' }));
    act(() => api.saveAttendance(state.attEventId, entries), 'Présences enregistrées.');
  };

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
    Object.assign(state, { people: [], members: [], events: [], attendance: [], followups: [], tasks: [], memberships: [], orgId: null, userId: null });
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
    state.role = m.role;
    state.orgName = m.organizations?.name || 'FI';
    state.displayName = m.display_name || state.email.split('@')[0];
    state.attEventId = null;
  }

  async function enterApp() {
    const { data: { user }, error } = await sb.auth.getUser(); // vérifié auprès du serveur
    if (error || !user) { showAuth('login'); return; }
    const { data, error: rolesErr } = await sb.from('user_roles')
      .select('organization_id, role, display_name, organizations(name)')
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
    setDemoRole('fi_leader');
    $('#role').value = 'fi_leader';
    $('#role').onchange = e => {
      setDemoRole(e.target.value);
      refresh();
      toast(state.role === 'deputy' ? 'Aperçu adjoint : planning et tâches attribuées.' : state.role === 'admin' ? 'Aperçu administrateur activé.' : 'Aperçu responsable FI activé.');
    };
    refresh().then(() => document.body.classList.remove('booting'));
  }

  state.ready = true;
  if (LIVE) bootLive().catch(err => showAuth('login', friendlyError(err), true));
  else bootDemo();
})();
