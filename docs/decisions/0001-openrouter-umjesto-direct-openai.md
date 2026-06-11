# 0001. OpenRouter kao LLM gateway umjesto direktnog OpenAI API-ja

- **Status:** Prihvaćeno
- **Datum:** 2026-06-11

> Primjer ADR-a — provjeri i dopuni stvarnim razlozima iz projekta prije nego ga smatraš finalnim.

## Kontekst
Botu treba LLM za generiranje odgovora i embeddings za RAG. Opcije: direktno OpenAI API, ili gateway poput OpenRoutera koji nudi više modela kroz jedan API. Bitno nam je da možemo mijenjati modele bez prepisivanja koda i imati fallback ako primarni model padne ili poskupi.

## Odluka
Koristimo **OpenRouter** kao jedinstveni gateway. Primarni i fallback model konfiguriraju se kroz env (`OPENROUTER_MODEL`, `OPENROUTER_FALLBACK_MODEL`), pa promjena modela ne traži izmjenu koda. Koristi se OpenAI SDK (kompatibilan API), pa je migracija s/na direktni OpenAI niska po trošku.

## Posljedice
- **+** Lako mijenjanje modela i automatski fallback bez deploya.
- **+** Pristup modelima više providera kroz isti integracijski sloj.
- **−** Dodatni posrednik (ovisnost o dostupnosti OpenRoutera, dodatna latencija/marža).
- **Paziti:** cijene modela mijenjaju se kod providera — admin panel prikazuje cijene pa ih treba povremeno uskladiti.
