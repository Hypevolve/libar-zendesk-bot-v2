-- ============================================================================
-- Libar Bot — Hybrid Search Migration (Skill §8 — Vector + Full-Text + RRF)
--
-- Adds Postgres full-text search to kb_chunks and a hybrid retrieval RPC that
-- fuses semantic (pgvector cosine) and lexical (ts_rank) rankings via
-- Reciprocal Rank Fusion — all over the SAME canonical corpus.
--
-- Croatian note: Postgres ships no Croatian dictionary, so we use the `simple`
-- configuration + `unaccent` for diacritics-insensitive matching (no stemming).
--
-- Run this ONCE on the Supabase SQL editor. Idempotent / safe to re-run.
-- After running, trigger a vector re-sync so search_tsv is populated.
-- ============================================================================

create extension if not exists unaccent;
create extension if not exists vector;

-- ── 1. Full-text column (regular column populated by trigger) ───────────────
-- A generated column can't use unaccent() (not IMMUTABLE), so we use a trigger.
alter table kb_chunks add column if not exists search_tsv tsvector;

create or replace function kb_chunks_tsv_refresh()
returns trigger
language plpgsql
as $$
begin
  new.search_tsv := to_tsvector(
    'simple',
    unaccent(coalesce(new.title, '') || ' ' || coalesce(new.body, ''))
  );
  return new;
end;
$$;

drop trigger if exists kb_chunks_tsv_update on kb_chunks;
create trigger kb_chunks_tsv_update
  before insert or update of title, body on kb_chunks
  for each row execute function kb_chunks_tsv_refresh();

-- Backfill existing rows
update kb_chunks
set search_tsv = to_tsvector(
  'simple',
  unaccent(coalesce(title, '') || ' ' || coalesce(body, ''))
)
where search_tsv is null;

create index if not exists kb_chunks_search_tsv_idx
  on kb_chunks using gin (search_tsv);

-- ── 2. Vector-only retrieval RPC (fallback) ──────────────────────────────
-- Drop first because changing OUT/return types requires a full recreate.
drop function if exists match_knowledge_chunks(vector,integer,double precision,text,text);
drop function if exists match_knowledge_chunks;

create or replace function match_knowledge_chunks(
  query_embedding vector(1536),
  match_count int default 8,
  match_threshold float default 0.5,
  filter_source text default null,
  filter_domain text default null
)
returns table (
  id uuid,
  chunk_id uuid,
  document_id uuid,
  title text,
  body text,
  domain text,
  url text,
  similarity float
)
language sql
stable
as $$
  select
    kc.id,
    kc.id as chunk_id,
    kc.document_id,
    kc.title,
    kc.body,
    kc.domain,
    kc.url,
    1 - (kc.embedding <=> query_embedding) as similarity
  from kb_chunks kc
  where kc.embedding is not null
    and (filter_source is null or kc.source = filter_source)
    and (filter_domain is null or kc.domain = filter_domain)
    and (1 - (kc.embedding <=> query_embedding)) >= match_threshold
  order by kc.embedding <=> query_embedding
  limit match_count;
$$;

-- ── 3. Hybrid retrieval RPC ─────────────────────────────────────────────────
drop function if exists hybrid_match_knowledge_chunks(vector,text,integer,double precision,text,text,integer,double precision,double precision);
drop function if exists hybrid_match_knowledge_chunks;

create or replace function hybrid_match_knowledge_chunks(
  query_embedding vector(1536),
  query_text text,
  match_count int default 8,
  match_threshold float default 0.5,
  filter_source text default null,
  filter_domain text default null,
  rrf_k int default 50,
  semantic_weight float default 1.0,
  full_text_weight float default 1.0
)
returns table (
  id uuid,
  chunk_id uuid,
  document_id uuid,
  title text,
  body text,
  domain text,
  url text,
  similarity float,
  lexical_rank float,
  rrf_score float
)
language sql
stable
as $$
  with q as (
    select plainto_tsquery('simple', unaccent(coalesce(query_text, ''))) as tsq
  ),
  semantic as (
    select
      kc.id,
      1 - (kc.embedding <=> query_embedding) as similarity,
      row_number() over (order by kc.embedding <=> query_embedding) as rank
    from kb_chunks kc
    where kc.embedding is not null
      and (filter_source is null or kc.source = filter_source)
      and (filter_domain is null or kc.domain = filter_domain)
      and (1 - (kc.embedding <=> query_embedding)) >= match_threshold
    order by kc.embedding <=> query_embedding
    limit match_count * 2
  ),
  lexical as (
    select
      kc.id,
      ts_rank(kc.search_tsv, q.tsq) as lex,
      row_number() over (order by ts_rank(kc.search_tsv, q.tsq) desc) as rank
    from kb_chunks kc, q
    where kc.search_tsv is not null
      and q.tsq is not null
      and kc.search_tsv @@ q.tsq
      and (filter_source is null or kc.source = filter_source)
      and (filter_domain is null or kc.domain = filter_domain)
    order by ts_rank(kc.search_tsv, q.tsq) desc
    limit match_count * 2
  ),
  fused as (
    select
      coalesce(s.id, l.id) as id,
      coalesce(semantic_weight / (rrf_k + s.rank), 0.0)
        + coalesce(full_text_weight / (rrf_k + l.rank), 0.0) as rrf_score,
      s.similarity as similarity,
      coalesce(l.lex, 0.0) as lexical_rank
    from semantic s
    full outer join lexical l on s.id = l.id
  )
  select
    kc.id,
    kc.id as chunk_id,
    kc.document_id,
    kc.title,
    kc.body,
    kc.domain,
    kc.url,
    coalesce(f.similarity, 1 - (kc.embedding <=> query_embedding)) as similarity,
    f.lexical_rank,
    f.rrf_score
  from fused f
  join kb_chunks kc on kc.id = f.id
  order by f.rrf_score desc
  limit match_count;
$$;
