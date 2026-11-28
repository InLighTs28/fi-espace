-- FI Espace — vérification des droits (RLS + triggers), après les migrations 001 à 005.
-- Utilisation : Supabase → SQL Editor, coller ce fichier et exécuter.
-- Tout se passe dans une transaction annulée à la fin (ROLLBACK) : rien n'est conservé.
-- Le script s'arrête sur la première erreur « ÉCHEC : … ». Sinon la dernière ligne affiche « TOUS LES TESTS RLS SONT PASSÉS ».
-- Comptes et données fictifs.
--
-- Comptes : 01 admin A · 02 responsable FI A · 03 adjoint A · 04 adjoint A (reçoit un rôle personnalisé)
--           05 admin B · 06 sans organisation · 07 révoqué A · 08 compte membre A (lié au membre A1)

begin;

-- ───────── Données fictives ─────────
insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'admin.a@exemple.test'),
  ('a0000000-0000-4000-8000-000000000002', 'responsable.a@exemple.test'),
  ('a0000000-0000-4000-8000-000000000003', 'adjoint.a@exemple.test'),
  ('a0000000-0000-4000-8000-000000000004', 'adjoint2.a@exemple.test'),
  ('a0000000-0000-4000-8000-000000000005', 'admin.b@exemple.test'),
  ('a0000000-0000-4000-8000-000000000006', 'externe@exemple.test'),
  ('a0000000-0000-4000-8000-000000000007', 'revoque.a@exemple.test'),
  ('a0000000-0000-4000-8000-000000000008', 'membre.a@exemple.test'),
  ('a0000000-0000-4000-8000-000000000009', 'boot@exemple.test');

-- Le déclencheur crée automatiquement les 4 rôles par défaut de chaque organisation.
insert into public.organizations (id, name) values
  ('aa000000-0000-4000-8000-0000000000aa', 'FI test A (fictive)'),
  ('bb000000-0000-4000-8000-0000000000bb', 'FI test B (fictive)');

insert into public.user_roles (user_id, organization_id, display_name, email, active) values
  ('a0000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Admin A', 'admin.a@exemple.test', true),
  ('a0000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-0000000000aa', 'Responsable A', 'responsable.a@exemple.test', true),
  ('a0000000-0000-4000-8000-000000000003', 'aa000000-0000-4000-8000-0000000000aa', 'Adjoint A', 'adjoint.a@exemple.test', true),
  ('a0000000-0000-4000-8000-000000000004', 'aa000000-0000-4000-8000-0000000000aa', 'Adjoint 2 A', 'adjoint2.a@exemple.test', true),
  ('a0000000-0000-4000-8000-000000000007', 'aa000000-0000-4000-8000-0000000000aa', 'Révoqué A', 'revoque.a@exemple.test', false),
  ('a0000000-0000-4000-8000-000000000008', 'aa000000-0000-4000-8000-0000000000aa', 'Membre A1', 'membre.a@exemple.test', true),
  ('a0000000-0000-4000-8000-000000000005', 'bb000000-0000-4000-8000-0000000000bb', 'Admin B', 'admin.b@exemple.test', true);

insert into public.account_roles (user_id, organization_id, role_id)
select u.user_id, u.org, r.id
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'aa000000-0000-4000-8000-0000000000aa'::uuid, 'admin'),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'aa000000-0000-4000-8000-0000000000aa'::uuid, 'fi_leader'),
  ('a0000000-0000-4000-8000-000000000003'::uuid, 'aa000000-0000-4000-8000-0000000000aa'::uuid, 'deputy'),
  ('a0000000-0000-4000-8000-000000000004'::uuid, 'aa000000-0000-4000-8000-0000000000aa'::uuid, 'deputy'),
  ('a0000000-0000-4000-8000-000000000007'::uuid, 'aa000000-0000-4000-8000-0000000000aa'::uuid, 'deputy'),
  ('a0000000-0000-4000-8000-000000000008'::uuid, 'aa000000-0000-4000-8000-0000000000aa'::uuid, 'member'),
  ('a0000000-0000-4000-8000-000000000005'::uuid, 'bb000000-0000-4000-8000-0000000000bb'::uuid, 'admin')
) as u(user_id, org, key)
join public.org_roles r on r.organization_id = u.org and r.system_key = u.key;

insert into public.fi_members (id, organization_id, display_name, user_id) values
  ('c1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Membre A1', 'a0000000-0000-4000-8000-000000000008'),
  ('c1000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-0000000000aa', 'Membre A2', null),
  ('c2000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-0000000000bb', 'Membre B1', null);

-- Événements A : ouvert à tous / équipe seulement / ciblé avec A1 / ciblé avec A2. Événement B : ouvert à tous.
insert into public.fi_events (id, organization_id, title, starts_at, audience) values
  ('e1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'FI ouverte', now() + interval '2 days', 'all'),
  ('e1000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-0000000000aa', 'Réunion équipe', now() + interval '3 days', 'team'),
  ('e1000000-0000-4000-8000-000000000003', 'aa000000-0000-4000-8000-0000000000aa', 'Sortie A1', now() + interval '4 days', 'selected'),
  ('e1000000-0000-4000-8000-000000000004', 'aa000000-0000-4000-8000-0000000000aa', 'Sortie A2', now() + interval '5 days', 'selected'),
  ('e2000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-0000000000bb', 'FI B', now() + interval '2 days', 'all');
insert into public.event_participants (event_id, member_id, organization_id) values
  ('e1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa'),
  ('e1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-0000000000aa');

insert into public.follow_ups (id, organization_id, contact_label, next_action) values
  ('f1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Contact A.', 'Prendre des nouvelles');

insert into public.tasks (id, organization_id, title, assigned_to) values
  ('d1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Tâche adjoint', 'a0000000-0000-4000-8000-000000000003'),
  ('d2000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Tâche adjoint 2', 'a0000000-0000-4000-8000-000000000004'),
  ('d3000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Tâche responsable', 'a0000000-0000-4000-8000-000000000002'),
  ('d4000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Tâche membre', 'a0000000-0000-4000-8000-000000000008');

insert into public.reminder_log (organization_id, kind, ref_key, user_id)
  values ('aa000000-0000-4000-8000-0000000000aa', 'test', 'fixture', 'a0000000-0000-4000-8000-000000000002');
insert into storage.objects (bucket_id, name) values
  ('member-photos', 'aa000000-0000-4000-8000-0000000000aa/c1000000-0000-4000-8000-000000000001.jpg'),
  ('member-photos', 'bb000000-0000-4000-8000-0000000000bb/c2000000-0000-4000-8000-000000000001.jpg');

-- Création du premier administrateur (exécutée en tant que propriétaire, comme dans le SQL Editor).
do $$
declare org uuid;
begin
  if (select count(*) from public.org_roles where organization_id = 'aa000000-0000-4000-8000-0000000000aa') <> 4 then
    raise exception 'ÉCHEC : les 4 rôles par défaut ne sont pas créés'; end if;
  org := public.bootstrap_first_admin('Boot@Exemple.test', 'FI test C (fictive)', 'Boot');
  if not exists (select 1 from public.account_roles ar join public.org_roles r on r.id = ar.role_id
                 where ar.user_id = 'a0000000-0000-4000-8000-000000000009' and r.organization_id = org and r.system_key = 'admin') then
    raise exception 'ÉCHEC : bootstrap_first_admin n''a pas créé l''administrateur'; end if;
end $$;

-- ───────── Responsable adjoint (rôle par défaut : voir tous les événements) ─────────
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n int;
begin
  if (select count(*) from public.fi_members) <> 0 then raise exception 'ÉCHEC : un adjoint lit les membres'; end if;
  if (select count(*) from public.follow_ups) <> 0 then raise exception 'ÉCHEC : un adjoint lit les suivis'; end if;
  if (select count(*) from public.attendance) <> 0 then raise exception 'ÉCHEC : un adjoint lit les présences'; end if;
  if (select count(*) from public.user_roles) <> 1 then raise exception 'ÉCHEC : un adjoint lit les comptes des autres'; end if;
  if (select count(*) from public.account_roles) <> 1 then raise exception 'ÉCHEC : un adjoint lit les rôles attribués aux autres'; end if;
  if (select count(*) from public.org_roles) <> 4 then raise exception 'ÉCHEC : un adjoint doit voir les 4 rôles de sa FI uniquement'; end if;
  if (select count(*) from public.organizations) <> 1 then raise exception 'ÉCHEC : un adjoint voit une autre organisation'; end if;
  if (select count(*) from public.fi_events) <> 4 then raise exception 'ÉCHEC : un adjoint doit voir les 4 événements de sa FI'; end if;
  if (select count(*) from public.tasks) <> 1 then raise exception 'ÉCHEC : un adjoint doit lire uniquement ses tâches'; end if;
  if (select count(*) from public.list_org_people('aa000000-0000-4000-8000-0000000000aa')) <> 0 then
    raise exception 'ÉCHEC : un adjoint lit l''annuaire'; end if;
  if (select count(*) from storage.objects where bucket_id = 'member-photos') <> 0 then
    raise exception 'ÉCHEC : un adjoint voit les photos'; end if;
  if public.current_fi_role('aa000000-0000-4000-8000-0000000000aa') <> 'staff' then raise exception 'ÉCHEC : current_fi_role adjoint'; end if;

  update public.tasks set status = 'done' where id = 'd1000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ÉCHEC : un adjoint ne peut pas avancer sa tâche'; end if;
  update public.tasks set status = 'done' where id = 'd2000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'ÉCHEC : un adjoint modifie la tâche d''un autre'; end if;
  update public.org_roles set permissions = array['administrator'] where organization_id = 'aa000000-0000-4000-8000-0000000000aa';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'ÉCHEC : un adjoint modifie les permissions des rôles'; end if;

  begin
    insert into public.account_roles (user_id, organization_id, role_id)
      select 'a0000000-0000-4000-8000-000000000003', organization_id, id from public.org_roles where system_key = 'admin';
    raise exception 'ÉCHEC : un adjoint s''attribue le rôle administrateur';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    insert into public.org_roles (organization_id, name, permissions) values ('aa000000-0000-4000-8000-0000000000aa', 'Pirate', array['administrator']);
    raise exception 'ÉCHEC : un adjoint crée un rôle';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    update public.tasks set title = 'Renommée' where id = 'd1000000-0000-4000-8000-000000000001';
    raise exception 'ÉCHEC : un adjoint renomme sa tâche';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    insert into public.tasks (organization_id, title) values ('aa000000-0000-4000-8000-0000000000aa', 'Nouvelle');
    raise exception 'ÉCHEC : un adjoint crée une tâche';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    insert into public.fi_events (organization_id, title, starts_at) values ('aa000000-0000-4000-8000-0000000000aa', 'X', now());
    raise exception 'ÉCHEC : un adjoint crée un événement';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
end $$;
reset role;

do $$ begin
  if (select completed_at from public.tasks where id = 'd1000000-0000-4000-8000-000000000001') is null then
    raise exception 'ÉCHEC : completed_at non renseigné'; end if;
end $$;

-- ───────── Compte membre (lié au membre A1) ─────────
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000008","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n int;
begin
  if (select string_agg(title, ',' order by title) from public.fi_events) is distinct from 'FI ouverte,Sortie A1' then
    raise exception 'ÉCHEC : un membre doit voir uniquement les événements ouverts à tous et ceux où il est invité (vu : %)',
      (select string_agg(title, ',' order by title) from public.fi_events); end if;
  if (select count(*) from public.fi_members) <> 1 then raise exception 'ÉCHEC : un membre doit voir uniquement sa propre fiche'; end if;
  if (select count(*) from public.event_participants) <> 1 then raise exception 'ÉCHEC : un membre voit les invitations des autres'; end if;
  if (select count(*) from public.tasks) <> 1 then raise exception 'ÉCHEC : un membre doit voir uniquement ses tâches'; end if;
  if (select count(*) from public.follow_ups) + (select count(*) from public.attendance) <> 0 then raise exception 'ÉCHEC : un membre lit suivis ou présences'; end if;
  if public.current_fi_role('aa000000-0000-4000-8000-0000000000aa') <> 'member' then raise exception 'ÉCHEC : current_fi_role membre'; end if;
  update public.tasks set status = 'in_progress' where id = 'd4000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ÉCHEC : un membre ne peut pas avancer sa tâche'; end if;
  insert into public.notification_prefs (user_id, organization_id, weekly_digest)
    values ('a0000000-0000-4000-8000-000000000008', 'aa000000-0000-4000-8000-0000000000aa', false);
  begin
    update public.fi_members set display_name = 'Autre nom' where id = 'c1000000-0000-4000-8000-000000000001';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'ÉCHEC : un membre modifie sa fiche'; end if;
  end;
  begin
    insert into public.event_participants (event_id, member_id, organization_id)
      values ('e1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa');
    raise exception 'ÉCHEC : un membre s''invite à un événement';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
end $$;
reset role;

-- ───────── Responsable FI (rôle par défaut) ─────────
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n int; who uuid;
begin
  if (select count(*) from public.fi_members) <> 2 then raise exception 'ÉCHEC : le responsable doit lire les membres de sa seule FI'; end if;
  if (select count(*) from public.tasks) <> 4 then raise exception 'ÉCHEC : le responsable doit lire toutes les tâches de sa FI'; end if;
  if (select count(*) from public.fi_events) <> 4 then raise exception 'ÉCHEC : le responsable doit voir tous les événements de sa FI'; end if;
  if (select count(*) from public.list_org_people('aa000000-0000-4000-8000-0000000000aa')) <> 5 then
    raise exception 'ÉCHEC : annuaire attendu = 5 comptes actifs'; end if;
  if exists (select 1 from public.list_org_people('aa000000-0000-4000-8000-0000000000aa') where email is not null) then
    raise exception 'ÉCHEC : un responsable non admin voit les e-mails'; end if;
  if (select member_id from public.list_org_people('aa000000-0000-4000-8000-0000000000aa') where user_id = 'a0000000-0000-4000-8000-000000000008')
     <> 'c1000000-0000-4000-8000-000000000001' then raise exception 'ÉCHEC : lien compte ↔ membre absent de l''annuaire'; end if;
  if (select count(*) from public.reminder_log) <> 0 then raise exception 'ÉCHEC : un responsable non admin lit le journal'; end if;
  if (select count(*) from storage.objects where bucket_id = 'member-photos') <> 1 then
    raise exception 'ÉCHEC : le responsable doit voir uniquement les photos de sa FI'; end if;

  insert into public.fi_members (organization_id, display_name, tutor_user_id)
    values ('aa000000-0000-4000-8000-0000000000aa', 'Nouveau membre', 'a0000000-0000-4000-8000-000000000003');
  insert into public.tasks (organization_id, title, assigned_to, created_by)
    values ('aa000000-0000-4000-8000-0000000000aa', 'Tâche créée', 'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001')
    returning created_by into who;
  if who <> 'a0000000-0000-4000-8000-000000000002' then raise exception 'ÉCHEC : created_by falsifiable'; end if;
  insert into public.attendance (organization_id, event_id, member_id, state)
    values ('aa000000-0000-4000-8000-0000000000aa', 'e1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'present');
  insert into public.event_participants (event_id, member_id, organization_id)
    values ('e1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa');
  delete from public.event_participants where event_id = 'e1000000-0000-4000-8000-000000000004' and member_id = 'c1000000-0000-4000-8000-000000000001';
  insert into storage.objects (bucket_id, name) values ('member-photos', 'aa000000-0000-4000-8000-0000000000aa/nouveau.jpg');

  update public.user_roles set active = false where user_id = 'a0000000-0000-4000-8000-000000000003';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'ÉCHEC : un responsable désactive un compte'; end if;

  begin
    update public.fi_members set user_id = 'a0000000-0000-4000-8000-000000000003' where id = 'c1000000-0000-4000-8000-000000000002';
    raise exception 'ÉCHEC : un responsable non admin lie un compte à un membre';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    insert into public.account_roles (user_id, organization_id, role_id)
      select 'a0000000-0000-4000-8000-000000000003', organization_id, id from public.org_roles where system_key = 'fi_leader';
    raise exception 'ÉCHEC : un responsable attribue un rôle';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    insert into public.fi_members (organization_id, display_name) values ('bb000000-0000-4000-8000-0000000000bb', 'Intrus');
    raise exception 'ÉCHEC : un responsable écrit dans une autre FI';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    insert into public.tasks (organization_id, title, assigned_to)
      values ('aa000000-0000-4000-8000-0000000000aa', 'X', 'a0000000-0000-4000-8000-000000000007');
    raise exception 'ÉCHEC : tâche attribuée à un compte révoqué';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    insert into public.event_participants (event_id, member_id, organization_id)
      values ('e2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa');
    raise exception 'ÉCHEC : participant lié à un événement d''une autre FI';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('member-photos', 'bb000000-0000-4000-8000-0000000000bb/intrus.jpg');
    raise exception 'ÉCHEC : photo déposée dans le dossier d''une autre FI';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    update public.fi_members set photo_path = 'bb000000-0000-4000-8000-0000000000bb/c2000000-0000-4000-8000-000000000001.jpg'
      where id = 'c1000000-0000-4000-8000-000000000001';
    raise exception 'ÉCHEC : un membre pointe vers la photo d''une autre FI';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
end $$;
reset role;

-- ───────── Administrateur : rôles personnalisés façon Discord ─────────
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n int; rid uuid;
begin
  if (select count(*) from public.user_roles) <> 6 then raise exception 'ÉCHEC : l''admin doit voir les 6 comptes de sa FI'; end if;
  if (select count(*) from public.reminder_log) <> 1 then raise exception 'ÉCHEC : l''admin doit lire le journal des rappels'; end if;

  insert into public.org_roles (organization_id, name, color, position, permissions)
    values ('aa000000-0000-4000-8000-0000000000aa', 'Gestion des présences', '#7a5cc4', 25, array['manage_attendance'])
    returning id into rid;
  insert into public.account_roles (user_id, organization_id, role_id)
    values ('a0000000-0000-4000-8000-000000000004', 'aa000000-0000-4000-8000-0000000000aa', rid);
  perform set_config('test.custom_role', rid::text, true);

  update public.fi_members set user_id = null where id = 'c1000000-0000-4000-8000-000000000001';
  update public.fi_members set user_id = 'a0000000-0000-4000-8000-000000000008' where id = 'c1000000-0000-4000-8000-000000000001';
  update public.user_roles set active = false where user_id = 'a0000000-0000-4000-8000-000000000003';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ÉCHEC : l''admin ne peut pas retirer un accès'; end if;

  delete from public.org_roles where system_key = 'member' and organization_id = 'aa000000-0000-4000-8000-0000000000aa';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'ÉCHEC : un rôle système a été supprimé'; end if;

  begin
    delete from public.account_roles where user_id = 'a0000000-0000-4000-8000-000000000001';
    raise exception 'ÉCHEC : le dernier admin peut se retirer son rôle';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    update public.org_roles set permissions = array['view_stats'] where system_key = 'admin' and organization_id = 'aa000000-0000-4000-8000-0000000000aa';
    raise exception 'ÉCHEC : on peut retirer la permission administrateur au dernier admin';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    update public.user_roles set active = false where user_id = 'a0000000-0000-4000-8000-000000000001';
    raise exception 'ÉCHEC : le dernier admin peut se désactiver';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    update public.org_roles set system_key = null where system_key = 'member' and organization_id = 'aa000000-0000-4000-8000-0000000000aa';
    raise exception 'ÉCHEC : la clé d''un rôle système est modifiable';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    insert into public.org_roles (organization_id, name, permissions) values ('aa000000-0000-4000-8000-0000000000aa', 'Faux', array['tout_faire']);
    raise exception 'ÉCHEC : permission inconnue acceptée';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    insert into public.account_roles (user_id, organization_id, role_id)
      values ('a0000000-0000-4000-8000-000000000003', 'aa000000-0000-4000-8000-0000000000aa',
              (select id from public.org_roles where organization_id = 'bb000000-0000-4000-8000-0000000000bb' and system_key = 'admin'));
    raise exception 'ÉCHEC : rôle d''une autre FI attribué';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    update public.fi_members set user_id = 'a0000000-0000-4000-8000-000000000005' where id = 'c1000000-0000-4000-8000-000000000002';
    raise exception 'ÉCHEC : membre lié à un compte d''une autre FI';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  update public.fi_members set display_name = 'Pirate' where organization_id = 'bb000000-0000-4000-8000-0000000000bb';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'ÉCHEC : un admin modifie une autre organisation'; end if;
end $$;
reset role;

-- ───────── Rôle personnalisé « Gestion des présences » (adjoint 2) ─────────
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.fi_members) <> 3 then raise exception 'ÉCHEC : le rôle présences doit pouvoir lire les membres'; end if;
  insert into public.attendance (organization_id, event_id, member_id, state)
    values ('aa000000-0000-4000-8000-0000000000aa', 'e1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'absent');
  if (select count(*) from public.follow_ups) <> 0 then raise exception 'ÉCHEC : le rôle présences lit les suivis'; end if;
  begin
    insert into public.fi_members (organization_id, display_name) values ('aa000000-0000-4000-8000-0000000000aa', 'X');
    raise exception 'ÉCHEC : le rôle présences crée un membre';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('member-photos', 'aa000000-0000-4000-8000-0000000000aa/x.jpg');
    raise exception 'ÉCHEC : le rôle présences dépose une photo';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    insert into public.notification_prefs (user_id, organization_id)
      values ('a0000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-0000000000aa');
    raise exception 'ÉCHEC : modification des préférences d''un autre';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    insert into public.reminder_log (organization_id, kind, ref_key, user_id)
      values ('aa000000-0000-4000-8000-0000000000aa', 'test', 'x', 'a0000000-0000-4000-8000-000000000004');
    raise exception 'ÉCHEC : un utilisateur écrit dans le journal des rappels';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
end $$;
reset role;

-- ───────── Comptes révoqué, sans FI, admin d'une autre FI ─────────
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.fi_events) + (select count(*) from public.tasks) + (select count(*) from public.organizations) <> 0 then
    raise exception 'ÉCHEC : un compte désactivé lit encore des données'; end if;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000006","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.fi_events) + (select count(*) from public.tasks) + (select count(*) from public.fi_members)
     + (select count(*) from public.organizations) + (select count(*) from public.user_roles) + (select count(*) from public.org_roles) <> 0 then
    raise exception 'ÉCHEC : un compte sans FI lit des données'; end if;
  begin
    perform public.bootstrap_first_admin('externe@exemple.test', 'Pirate', null);
    raise exception 'ÉCHEC : bootstrap_first_admin appelable depuis le site';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.fi_members) <> 1 or (select count(*) from public.fi_events) <> 1 then
    raise exception 'ÉCHEC : l''admin B doit voir uniquement la FI B'; end if;
end $$;
reset role;

-- ───────── Abonnement d'agenda (migration 005) ─────────
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000008","role":"authenticated"}', true);
set local role authenticated;
do $$
declare t1 uuid; t2 uuid; t3 uuid;
begin
  t1 := public.my_calendar_token('aa000000-0000-4000-8000-0000000000aa');
  t2 := public.my_calendar_token('aa000000-0000-4000-8000-0000000000aa');
  if t1 is null or t1 <> t2 then raise exception 'ÉCHEC : le lien d''agenda doit rester stable'; end if;
  t3 := public.my_calendar_token('aa000000-0000-4000-8000-0000000000aa', true);
  if t3 = t1 then raise exception 'ÉCHEC : le renouvellement doit changer le lien'; end if;
  perform set_config('test.member_token', t3::text, true);
  begin
    perform public.my_calendar_token('bb000000-0000-4000-8000-0000000000bb');
    raise exception 'ÉCHEC : lien d''agenda obtenu pour une autre FI';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    perform * from public.calendar_feed_events(t3);
    raise exception 'ÉCHEC : la fonction du flux d''agenda est appelable depuis le site';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
declare t uuid;
begin
  t := public.my_calendar_token('aa000000-0000-4000-8000-0000000000aa');
  perform set_config('test.leader_token', t::text, true);
  if (select count(*) from public.calendar_tokens) <> 1 then raise exception 'ÉCHEC : un compte voit les liens d''agenda des autres'; end if;
end $$;
reset role;

do $$
declare member_titles text; leader_count int;
begin
  select string_agg(title, ',' order by title) into member_titles
    from public.calendar_feed_events(current_setting('test.member_token')::uuid);
  if member_titles is distinct from 'FI ouverte,Sortie A1' then
    raise exception 'ÉCHEC : le flux d''agenda du membre doit contenir uniquement ses événements (vu : %)', member_titles; end if;
  select count(*) into leader_count from public.calendar_feed_events(current_setting('test.leader_token')::uuid);
  if leader_count <> 4 then raise exception 'ÉCHEC : le flux du responsable doit contenir les 4 événements de sa FI'; end if;
  if (select count(*) from public.calendar_feed_events('00000000-0000-4000-8000-000000000000')) <> 0 then
    raise exception 'ÉCHEC : un lien inconnu renvoie des événements'; end if;
  update public.user_roles set active = false where user_id = 'a0000000-0000-4000-8000-000000000008';
  if (select count(*) from public.calendar_feed_events(current_setting('test.member_token')::uuid)) <> 0 then
    raise exception 'ÉCHEC : le flux d''un compte désactivé renvoie encore des événements'; end if;
  update public.user_roles set active = true where user_id = 'a0000000-0000-4000-8000-000000000008';
end $$;

-- ───────── Visiteur non connecté ─────────
select set_config('request.jwt.claims', '', true);
set local role anon;
do $$ begin
  begin
    perform 1 from public.fi_members;
    raise exception 'ÉCHEC : un visiteur anonyme interroge les membres';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    perform 1 from public.org_roles;
    raise exception 'ÉCHEC : un visiteur anonyme interroge les rôles';
  exception when others then if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
end $$;
reset role;

select 'TOUS LES TESTS RLS SONT PASSÉS' as resultat;
rollback;
