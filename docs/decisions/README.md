# Arhitekturne odluke (ADR)

Ovdje hvatamo **zašto** je nešto odlučeno — znanje koje se inače izgubi i koje ni kod ni README ne čuvaju. Kad za 6 mjeseci netko pita "zašto OpenRouter, a ne direktno OpenAI?", odgovor je ovdje.

## Kako dodati novu odluku
1. Kopiraj [0000-template.md](0000-template.md).
2. Nazovi ga `NNNN-kratki-naslov.md` (sljedeći redni broj).
3. Popuni Kontekst → Odluka → Posljedice. Kratko je dovoljno.
4. Status ostaje `Prihvaćeno` dok ga kasnija odluka ne zamijeni (tada `Zamijenjeno s NNNN`).

ADR se **ne mijenja** nakon donošenja — ako se odluka promijeni, piše se novi koji zamjenjuje stari. Tako ostaje povijest razmišljanja.

## Popis
- [0001-openrouter-umjesto-direct-openai.md](0001-openrouter-umjesto-direct-openai.md) — Zašto OpenRouter kao LLM gateway
- [0002-bez-preusmjeravanja-na-kontakt-tijekom-razgovora.md](0002-bez-preusmjeravanja-na-kontakt-tijekom-razgovora.md) — Zašto bot ne šalje na mail/telefon dok razgovor traje
