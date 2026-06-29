
create table public.specs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  file_type text not null default 'txt',
  content text not null,
  created_at timestamptz not null default now()
);
alter table public.specs enable row level security;
create policy "public read specs" on public.specs for select using (true);
create policy "public insert specs" on public.specs for insert with check (true);
create policy "public delete specs" on public.specs for delete using (true);

create table public.scenarios (
  id uuid primary key default gen_random_uuid(),
  spec_id uuid references public.specs(id) on delete set null,
  title text not null,
  area text,
  preconditions text,
  steps jsonb not null default '[]'::jsonb,
  expected_result text,
  priority text not null default 'medium',
  type text not null default 'functional',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.scenarios enable row level security;
create policy "public read scenarios" on public.scenarios for select using (true);
create policy "public insert scenarios" on public.scenarios for insert with check (true);
create policy "public update scenarios" on public.scenarios for update using (true) with check (true);
create policy "public delete scenarios" on public.scenarios for delete using (true);

create or replace function public.tg_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger scenarios_touch before update on public.scenarios
for each row execute function public.tg_touch_updated_at();

create table public.scenario_changes (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid references public.scenarios(id) on delete cascade,
  new_spec_id uuid references public.specs(id) on delete cascade,
  reason text not null,
  proposed jsonb not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
alter table public.scenario_changes enable row level security;
create policy "public read changes" on public.scenario_changes for select using (true);
create policy "public insert changes" on public.scenario_changes for insert with check (true);
create policy "public update changes" on public.scenario_changes for update using (true) with check (true);
create policy "public delete changes" on public.scenario_changes for delete using (true);
