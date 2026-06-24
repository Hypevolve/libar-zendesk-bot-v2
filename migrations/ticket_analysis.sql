-- Migracija: analiza Zendesk ticketa (konverzacije, top teme, KB rupe).
-- Puni se preko ticketAnalysisService (LLM analiza po ticketu), čita preko analyticsStore.
-- Primijeniti ručno u Supabase SQL editoru.

create table if not exists ticket_analysis (
  ticket_id          bigint primary key,
  channel            text,
  created_at         timestamptz,
  subject            text,
  requester_masked   text,                 -- maskirano (bez sirovih osobnih podataka)
  status             text,
  handled_by         text,                 -- 'bot' | 'human' | 'mixed'
  language           text,
  topic              text,                 -- LLM: tema razgovora
  intent             text,                 -- LLM: namjera korisnika
  bot_answered       boolean,
  bot_quality        text,                 -- 'good' | 'partial' | 'bad' | 'na'
  is_kb_gap          boolean default false,
  kb_gap_reason      text,
  suggested_kb_topic text,
  summary            text,                 -- kratki sažetak (maskiran)
  model_used         text,
  analyzed_at        timestamptz default now()
);

create index if not exists idx_ticket_analysis_kb_gap   on ticket_analysis (is_kb_gap);
create index if not exists idx_ticket_analysis_topic    on ticket_analysis (topic);
create index if not exists idx_ticket_analysis_created  on ticket_analysis (created_at desc);

-- Stanje inkrementalnog synca (jedan red).
create table if not exists analysis_sync_state (
  id          int primary key default 1 check (id = 1),
  last_cursor timestamptz,
  updated_at  timestamptz default now()
);

insert into analysis_sync_state (id, last_cursor) values (1, null)
  on conflict (id) do nothing;
