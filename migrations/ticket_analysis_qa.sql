-- Dopuna: stvarni sadržaj razgovora (pitanje kupca + zadnji odgovor), maskirano.
-- Primijeniti u Supabase SQL editoru nakon ticket_analysis.sql.

alter table ticket_analysis add column if not exists first_question text;
alter table ticket_analysis add column if not exists last_reply     text;
