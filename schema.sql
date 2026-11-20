-- À exécuter une seule fois dans Supabase > SQL Editor.

create table if not exists public.settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.usage (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  model      text not null,
  ok         boolean not null,
  status     int,
  chars      int,
  ip_hash    text
);
create index if not exists usage_created_at_idx on public.usage (created_at desc);

-- Sécurité : RLS activé SANS aucune politique = personne n'a accès via les clés publiques.
-- Seul le Worker (clé secrète / service_role) peut lire et écrire.
alter table public.settings enable row level security;
alter table public.usage    enable row level security;
revoke all on public.settings from anon, authenticated;
revoke all on public.usage    from anon, authenticated;
