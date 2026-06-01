/**
 * Auto-generated e2e tests from real Zendesk tickets
 * Generated: 2026-06-01T22:02:17.862Z
 * Source: 200 tickets from last 60 days
 */
const GENERATED_SCENARIOS = [
  {
    id: "GEN-01", group: "otkup", query: "Kako procijeniti vrijednost knjiga ako šaljem samo fotografije bez opisa?",
    expected: { shouldContain: ["Zatražiti jasne fotografije naslovnice, hrpta, nekoliko unutarnjih stranica i ISBN-a; bez opisa procjena je okvirna", "Navesti kako i gdje poslati fotografije te minimalne kriterije otkupa (stanje, izdanje, potražnja)", "Napomenuti da je konačna ponuda moguća tek nakon fizičke provjere"] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-02", group: "otkup", query: "Kada mogu očekivati uplatu za poslane udžbenike (otkup)?",
    expected: { shouldContain: ["Navesti standardne rokove isplate nakon zaprimanja i obrade pošiljke", "Pojašnjenje kanala isplate (npr. bankovni transfer) i provjera točnosti podataka primatelja"] },
    checkRetrieval: true
  },
  {
    id: "GEN-03", group: "otkup", query: "Uplata kasni i knjige su kod vas već dulje vrijeme – možete provjeriti status?",
    expected: { shouldContain: ["Zatražiti identifikatore (ime, e‑pošta, broj otkupa/pošiljke) za provjeru", "Provjeriti je li pošiljka zaprimljena i u kojoj je fazi obrade te dati procijenjeni rok isplate", "Ponuditi eskalaciju ako je interni rok prekoračen"] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-04", group: "otkup", query: "Kako poslati fotografije/privitke za ponudu otkupa?",
    expected: { shouldContain: ["Upute za slanje privitaka putem obrasca ili e‑pošte te ograničenja formata/veličine", "Preporučiti da se uz fotografije navede popis naslova/ISBN, količina i stanje"] },
    checkRetrieval: true
  },
  {
    id: "GEN-05", group: "otkup", query: "Zašto je otkupna cijena niža od iznosa koji sam platio/la prošle godine?",
    expected: { shouldContain: ["Cijena ovisi o potražnji, izdanju i stanju; nije vezana uz prvotnu maloprodajnu cijenu.", "Nova izdanja/kurikularne promjene snižavaju vrijednost starijih kompleta.", "Otkupne cijene variraju sezonski i prema zalihama."] },
    checkRetrieval: true
  },
  {
    id: "GEN-06", group: "otkup", query: "Imam nove/nekorištene knjige koje se ne prikazuju u sustavu za otkup – što napraviti?",
    expected: { shouldContain: ["Ako naslov nije u kalkulatoru, trenutačno ga ne otkupljujemo ili je pauziran.", "Pošaljite popis/ISBN i fotografije stanja za ručnu provjeru.", "Ako bude prihvaćen, dodamo ga i javimo ponudu/korake za otkup."] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-07", group: "otkup", query: "Koliko mogu dobiti za konkretan udžbenik?",
    expected: { shouldContain: ["Provjerite ISBN u online kalkulatoru otkupa za aktualnu ponudu.", "Iznos ovisi o izdanju i stanju; konačna cijena potvrđuje se nakon pregleda.", "Ako se naslov ne prikazuje, trenutačno ga ne otkupljujemo."] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-08", group: "otkup", query: "Koje knjige trenutačno otkupljujete i po kojim cijenama?",
    expected: { shouldContain: ["Ažurirani popis i cijene dostupni su u kalkulatoru/na stranici otkupa.", "Ponude su informativne i mogu se promijeniti do zaprimanja i pregleda knjiga.", "Filtriranje po razredu/izdavaču pomaže u brzom pregledu."] },
    checkRetrieval: true
  },
  {
    id: "GEN-09", group: "otkup", query: "Otkupljujete li knjige i udžbenike (uključujući za srednju školu)?",
    expected: { shouldContain: ["Jasno navesti otkupljujemo/ne otkupljujemo i koje kategorije (osnovna/srednja/fakultet).", "Navesti osnovne uvjete: izdanje (godina kurikula), stanje (bez oštećenja, potpisa, podcrtavanja).", "Uputiti kako poslati popis za provjeru (obrazac/e-mail) i rok odgovora."] },
    checkRetrieval: true
  },
  {
    id: "GEN-10", group: "otkup", query: "Koje naslove i izdanja prihvaćate za otkup?",
    expected: { shouldContain: ["Istaknuti ograničenja po izdanju/godini i potražnji.", "Opisati prihvatljivo stanje primjerka i što diskvalificira knjigu.", "Napomenuti da se lista prihvatljivih naslova periodično mijenja."] },
    checkRetrieval: true
  },
  {
    id: "GEN-11", group: "otkup", query: "Kako izgleda proces otkupa (koraci, preuzimanje i isplata)?",
    expected: { shouldContain: ["Objasniti korake: slanje popisa → ponuda → dostava/preuzimanje → provjera → isplata.", "Navesti opcije isplate (npr. na račun/vaučer) i okvirne rokove obrade.", "Opisati logistiku preuzimanja/slanja i eventualne troškove."] },
    checkRetrieval: true
  },
  {
    id: "GEN-12", group: "otkup", query: "Možete li procijeniti vrijednost mojih knjiga po popisu ili fotografijama?",
    expected: { shouldContain: ["Zatražiti potrebne podatke (naslov, autor, izdanje/ISBN, stanje, fotografije).", "Naglasiti da konačna ponuda ovisi o provjeri stanja i potražnji.", "Naznačiti okvirni rok za povratnu informaciju."] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-13", group: "otkup", query: "Otkupljujete li ove knjige/udžbenike?",
    expected: { shouldContain: ["Gdje provjeriti listu/politiku otkupa i kriterije (izdanje, stanje, potražnja)", "Prihvatljivi uvjeti: cjelovitost kompleta, bez većih oštećenja/označavanja", "Kako poslati popis (ISBN) ili fotografije za provjeru"] },
    checkRetrieval: true
  },
  {
    id: "GEN-14", group: "otkup", query: "Koliko nudite za ove udžbenike?",
    expected: { shouldContain: ["Cijena ovisi o izdanju, stanju i potražnji za predmetnim razredom/naslovom", "Za točnu ponudu pošaljite ISBN-e i/ili jasne fotografije ili ispunite online obrazac", "Okvirni rok za izradu ponude nakon zaprimanja podataka"] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-15", group: "otkup", query: "Mogu li prodati nove/nekorištene knjige?",
    expected: { shouldContain: ["Prihvaćamo aktualna izdanja s liste otkupa; novo/nekorišteno stanje obično donosi višu cijenu", "Knjige moraju biti bez upisa, naljepnica i oštećenja", "Kako prijaviti naslove za procjenu (obrazac/poruka s ISBN-ovima)"] },
    checkRetrieval: true
  },
  {
    id: "GEN-16", group: "otkup", query: "Kako dodati još knjiga u već poslanu/kreiranu ponudu za otkup?",
    expected: { shouldContain: ["Ako ponuda nije potvrđena, moguće je urediti i dodati naslove", "Ako je već poslana, otvorite novu prijavu i napomenite da se spoji s postojećom", "Ako imate tehničke poteškoće s unosom, javite se podršci"] },
    checkRetrieval: true
  },
  {
    id: "GEN-17", group: "otkup", query: "Koje knjige trenutno otkupljujete?",
    expected: { shouldContain: ["Pogledajte ažuriranu listu otkupa i uvjete prihvata", "Kriteriji: izdanje, potražnja, sezonske potrebe, stanje", "Lista se periodično mijenja (posebno u sezoni udžbenika)"] },
    checkRetrieval: true
  },
  {
    id: "GEN-18", group: "dostava", query: "Kako mogu pratiti status svoje narudžbe/pošiljke?",
    expected: { shouldContain: ["Broj/link za praćenje šaljemo e‑poštom/SMS‑om nakon otpreme; vidi i u korisničkom računu.", "Status se ažurira kad paket preuzme kurir; ako nema pomaka 24–48 h, javite se podršci."] },
    checkRetrieval: true
  },
  {
    id: "GEN-19", group: "dostava", query: "Naručeno je više artikala, a dio nije stigao – što sada?",
    expected: { shouldContain: ["Moguće su djelomične isporuke (druga pošiljka slijedi) ako artikli idu iz različitih skladišta ili kasne.", "Provjerite potvrdu otpreme/račun za popis poslanih artikala; ostali su na čekanju ili stornirani uz povrat."] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-20", group: "dostava", query: "Mogu li birati dostavnu službu (npr. GLS)?",
    expected: { shouldContain: ["Standardno šaljemo preko ugovorenih partnera; izbor kurira nije uvijek moguć.", "Posebne zahtjeve bilježimo kao napomenu, ali ne možemo jamčiti i može utjecati na rok isporuke."] },
    checkRetrieval: true
  },
  {
    id: "GEN-21", group: "dostava", query: "Koliko traje dostava?",
    expected: { shouldContain: ["Rok isporuke računa se od otpreme i ovisi o adresi i dostupnosti artikala.", "Artikli na zalihi šalju se brzo; naručeni od dobavljača šalju se po zaprimanju."] },
    checkRetrieval: true
  },
  {
    id: "GEN-22", group: "dostava", query: "Koliko košta dostava?",
    expected: { shouldContain: ["Ovisi o težini/količini, adresi i načinu plaćanja (pouzeće može imati dodatnu naknadu).", "Konačan iznos dostave prikazuje se u košarici prije potvrde; akcije/prag za besplatnu dostavu primjenjuju se automatski."] },
    checkRetrieval: true
  },
  {
    id: "GEN-23", group: "dostava", query: "Koliko košta dostava?",
    expected: { shouldContain: ["Navesti standardne cijene i kriterije (težina/iznos košarice/odredište).", "Istaknuti prag za besplatnu dostavu, ako postoji.", "Uputiti gdje se konačna cijena prikazuje (košarica/blagajna)."] },
    checkRetrieval: true
  },
  {
    id: "GEN-24", group: "dostava", query: "Koliko košta dostava za više udžbenika na adresu u određenom gradu?",
    expected: { shouldContain: ["Objasniti da cijena ovisi o težini paketa i poštanskom broju.", "Uputiti na provjeru točne cijene dodavanjem artikala u košaricu i unosom adrese.", "Navesti okvirne rokove isporuke za regiju."] },
    checkRetrieval: true
  },
  {
    id: "GEN-25", group: "dostava", query: "Koja je cijena dostave kada je plaćanje pouzećem?",
    expected: { shouldContain: ["Navesti postoji li dodatna naknada za pouzeće i kako se obračunava.", "Pojašnjenje gdje se naknada vidi (blagajna/sažetak narudžbe).", "Predložiti alternativne metode plaćanja bez naknade, ako ih ima."] },
    checkRetrieval: true
  },
  {
    id: "GEN-26", group: "dostava", query: "Možete li izračunati točnu cijenu dostave za moju narudžbu i adresu?",
    expected: { shouldContain: ["Zatražiti detalje (artikli/težina, adresa/poštanski broj, način plaćanja).", "Ponuditi procjenu ili uputiti na izračun u blagajni.", "Napomenuti moguće varijacije zbog kurirske zone ili doplata."] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-27", group: "dostava", query: "Dostavljate li na cijelo područje RH (uključujući otoke) i koji su rokovi?",
    expected: { shouldContain: ["Potvrditi pokrivenost dostave i eventualne iznimke/duže rokove.", "Navesti tipične rokove isporuke i kada počinje teći rok (po obradi).", "Spomenuti praćenje pošiljke i obavijesti kurira."] },
    checkRetrieval: true
  },
  {
    id: "GEN-28", group: "dostava", query: "Koliko traje dostava?",
    expected: { shouldContain: ["Navesti standardni rok isporuke (izražen u radnim danima) i od kada se računa", "Napomenuti da rok varira prema adresi, dostupnosti artikla i dostavnoj službi", "Uputiti gdje će korisnik dobiti ili pronaći link za praćenje pošiljke"] },
    checkRetrieval: true
  },
  {
    id: "GEN-29", group: "dostava", query: "Koji je očekivani rok isporuke za moju konkretno napravljenu narudžbu?",
    expected: { shouldContain: ["Provjeriti status narudžbe i je li već otpremljena prije davanja procjene", "Ako je otpremljeno, navesti preostali procijenjeni rok i pružiti/pronaći tracking", "Upozoriti na moguća kašnjenja (blagdani, vremenske neprilike, udaljene lokacije)"] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-30", group: "dostava", query: "Od kada se računa rok dostave – od potvrde narudžbe ili od otpreme?",
    expected: { shouldContain: ["Pojašnjenje da se rok tipično računa od trenutka otpreme", "Napomenuti da vrijeme obrade/pripreme paketa prethodi otpremi", "Iznimke: pre-order ili personalizirani artikli mogu imati duži rok"] },
    checkRetrieval: true
  },
  {
    id: "GEN-31", group: "narudzba", query: "Nedostaje artikl u paketu – tražim rješenje",
    expected: { shouldContain: ["Zatražiti broj narudžbe, popis zaprimljenih artikala i fotografije ambalaže/računa", "Ponuditi provjeru skladišta i opcije rješenja (doslanje, povrat novca/umanjenje) prema politici"] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-32", group: "narudzba", query: "Mogu li spojiti dvije odvojene narudžbe u jednu dostavu?",
    expected: { shouldContain: ["Spajanje je moguće samo dok su obje narudžbe u pripremi i nisu otpremljene.", "Pošaljite brojeve narudžbi što prije; trošak dostave ovisi o statusu i mogućnosti spajanja."] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-33", group: "narudzba", query: "Kako izmijeniti ili otkazati narudžbu nakon što je poslana?",
    expected: { shouldContain: ["Nakon otpreme izmjene/otkaz najčešće nisu mogući; možemo pokušati presretanje/zaustavu kod kurira.", "Alternativa je odbiti paket ili zatražiti povrat po primitku prema uvjetima povrata."] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-34", group: "narudzba", query: "Jesu li dostupni svi naslovi za određeni razred i mogu li ih naručiti odjednom?",
    expected: { shouldContain: ["Filtrirajte po razredu/programu; komplet je moguće dodati u košaricu ako je dostupan.", "Ako neki naslov nedostaje, vjerojatno je privremeno nedostupan ili izlazi novo izdanje; možemo ponuditi alternativu/obavijest."] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-35", group: "narudzba", query: "Jesu li dostupni svi naslovi za određeni razred (npr. 3. razred gimnazije)?",
    expected: { shouldContain: ["Provjeriti dostupnost po naslovu/izdanju jer se zalihe mogu razlikovati.", "Navesti rokove isporuke za dostupne i nedostupne (preorder/backorder) artikle.", "Uputiti na stranicu razreda ili zatražiti popis naslova za provjeru."] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-36", group: "narudzba", query: "Možete li potvrditi dostupnost konkretnog udžbenika?",
    expected: { shouldContain: ["Zatražiti ISBN/izdanje i nakladnika za točnu provjeru.", "Provjeriti stanje zaliha i očekivani rok isporuke.", "Predložiti zamjensko izdanje ili obavijest kada stigne, ako nije dostupno."] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-37", group: "narudzba", query: "Kako naručiti sve potrebne udžbenike za odabrani razred odjednom?",
    expected: { shouldContain: ["Uputiti na kategorije po razredu i filtere (predmet, nakladnik, izdanje).", "Savjetovati provjeru izdanja i kompatibilnosti s kurikulumom škole.", "Objasniti kako dodati sve artikle u košaricu i nastaviti na blagajnu."] },
    checkRetrieval: true
  },
  {
    id: "GEN-38", group: "povrat", query: "Kada i kako ću dobiti povrat novca?",
    expected: { shouldContain: ["Navesti rokove obrade povrata nakon zaprimanja i odobrenja", "Pojašnjenje da se povrat vrši istom metodom plaćanja i da banke mogu kasniti s knjiženjem"] },
    checkRetrieval: true
  },
  {
    id: "GEN-39", group: "povrat", query: "Tko snosi trošak povrata i kako dobijem povratnu naljepnicu?",
    expected: { shouldContain: ["Objasniti politiku troška povrata i moguće iznimke", "Upute kako generirati ili zatražiti povratnu naljepnicu te uvjete (rokovi, stanje artikla)"] },
    checkRetrieval: true
  },
  {
    id: "GEN-40", group: "povrat", query: "Kako pokrenuti povrat ili reklamaciju?",
    expected: { shouldContain: ["Navesti korake: prijava kroz račun/obrazac, rokovi za prijavu i potrebni podaci/dokazi", "Opis daljnjeg tijeka: odobrenje, slanje, pregled i opcije rješenja (zamjena/povrat novca)"] },
    checkRetrieval: true
  },
  {
    id: "GEN-41", group: "povrat", query: "Stigla je oštećena/mokra knjiga – želim zamjenu",
    expected: { shouldContain: ["Pošaljite fotografije oštećenja i ambalaže te broj narudžbe što prije.", "Organiziramo zamjenu i novu isporuku bez dodatnih troškova nakon odobrenja reklamacije."] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-42", group: "povrat", query: "Stigla je oštećena/mokra knjiga – želim povrat novca",
    expected: { shouldContain: ["Zatražit ćemo dokaz (fotografije) i podatke narudžbe za otvaranje reklamacije.", "Po odobrenju vraćamo iznos istom metodom plaćanja ili prema dogovoru."] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-43", group: "povrat", query: "Kako prijaviti i dokumentirati oštećenje pošiljke?",
    expected: { shouldContain: ["Sačuvajte ambalažu; fotografirajte vanjsku i unutarnju štetu te naljepnice.", "Prijavite preko obrasca/e‑pošte podrške u najkraćem roku radi otvaranja zahtjeva kod dostavne službe."] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-44", group: "povrat", query: "Poslali ste mi pogrešne knjige — kako napraviti zamjenu?",
    expected: { shouldContain: ["Zatražiti broj narudžbe i fotografije pogrešno primljenih artikala", "Organiziramo povrat/zamjenu o našem trošku i šaljemo ispravan naslov", "Koraci: potvrda, preuzimanje/etiketa, rokovi slanja zamjene"] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-45", group: "povrat", query: "Koliko traje postupak zamjene/povrata pogrešno isporučenih knjiga?",
    expected: { shouldContain: ["Vrijeme obrade nakon preuzimanja povrata i slanje zamjene", "Moguće slanje zamjene odmah ako je dostupna zaliha", "Praćenje pošiljke i obavijesti o statusu"] },
    checkRetrieval: true
  },
  {
    id: "GEN-46", group: "povrat", query: "Tko snosi trošak dostave kod pogrešno poslanih artikala?",
    expected: { shouldContain: ["Trošak snosi trgovac u slučaju naše pogreške", "Kupac dobiva unaprijed plaćenu naljepnicu ili organiziramo kurira", "Upute kako pripremiti paket za povrat"] },
    checkRetrieval: true
  },
  {
    id: "GEN-47", group: "kontakt", query: "Kako vas mogu kontaktirati (e‑pošta, telefon, radno vrijeme)?",
    expected: { shouldContain: ["Navesti dostupne kanale, radno vrijeme i očekivani rok odgovora", "Uputiti na FAQ/bazu znanja za brže samostalno rješavanje"] },
    checkRetrieval: true
  },
  {
    id: "GEN-48", group: "kontakt", query: "Moj upit je prekinut ili nerazumljiv – možete li mi pomoći?",
    expected: { shouldContain: ["Zamoliti korisnika da pošalje upit ponovno ili razjasni što treba", "Potvrditi da ćemo nastaviti komunikaciju u istom tiketu i da prethodna poruka nije bila potpuna"] },
    checkRetrieval: true
  },
  {
    id: "GEN-49", group: "kontakt", query: "Kako poslati fotografije/privitke uz upit?",
    expected: { shouldContain: ["Pojasniti kako dodati privitke putem obrasca/e‑pošte i prihvatljive formate/veličine", "Savjetovati da fotografije budu jasne te priložiti osnovne podatke (broj narudžbe/otkupa)"] },
    checkRetrieval: true
  },
  {
    id: "GEN-50", group: "kontakt", query: "Poslao/la sam poruku bez detalja – koje informacije trebate da biste pomogli?",
    expected: { shouldContain: ["Zatražiti ključne podatke: broj narudžbe/otkupa, kontakt, opis problema i fotografije ako je primjenjivo", "Objasniti da potpuni podaci ubrzavaju rješavanje zahtjeva"] },
    checkRetrieval: true
  },
  {
    id: "GEN-51", group: "kontakt", query: "Kako mogu stupiti u kontakt s agentom korisničke podrške?",
    expected: { shouldContain: ["Dostupni kanali (e-mail/telefon/chat) i radno vrijeme", "Očekivano vrijeme odgovora", "Pripremiti broj narudžbe/ponude i osnovne podatke"] },
    checkRetrieval: true
  },
  {
    id: "GEN-52", group: "kontakt", query: "Imam općenito pitanje — kako započeti razgovor?",
    expected: { shouldContain: ["Kratko opisati potrebu (otkup, povrat, informacija) i cilj", "Navesti ključne podatke (ISBN, naslovi, broj narudžbe/ponude)", "Privatne podatke slati samo preko sigurnih kanala"] },
    checkRetrieval: true
  },
  {
    id: "GEN-53", group: "kontakt", query: "Kako vam mogu poslati fotografije knjiga ili druge priloge?",
    expected: { shouldContain: ["Podržani formati/veličine i savjet za jasne fotografije (naslovnica/ISBN)", "Alternativa: poslati e-mail ako upload u obrascu ne radi", "Uključiti kratki popis naslova i razrede/godine"] },
    checkRetrieval: true
  },
  {
    id: "GEN-54", group: "kontakt", query: "Kako započeti razgovor s korisničkom podrškom?",
    expected: { shouldContain: ["Navesti dostupne kanale (chat, e‑mail, telefon) i gdje ih pronaći", "Preporučiti pripremu podataka (broj narudžbe, e‑mail, opis problema)", "Naznačiti radno vrijeme podrške i očekivano vrijeme odgovora"] },
    checkRetrieval: true
  },
  {
    id: "GEN-55", group: "kontakt", query: "Možete li me spojiti s agentom uživo?",
    expected: { shouldContain: ["Potvrditi mogućnost spajanja i opisati korake za kontaktiranje agenta", "Upozoriti na moguće vrijeme čekanja", "Zatražiti osnovne informacije radi bržeg rješavanja upita"] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-56", group: "kontakt", query: "Trebam pomoć – kako da krenemo?",
    expected: { shouldContain: ["Predložiti slanje kratkog opisa problema i relevantnih detalja", "Uputiti na FAQ/centre pomoći za brze odgovore", "Dati opciju kontakta ako je situacija hitna"] },
    checkRetrieval: true
  },
  {
    id: "GEN-57", group: "placanje", query: "Koje načine plaćanja prihvaćate pri kupnji?",
    expected: { shouldContain: ["Nabrojiti podržane metode (npr. kartice, bankovni prijenos, e‑novčanici, pouzeće ako postoji)", "Istaknuti sigurnost plaćanja i kada se naplata izvršava"] },
    checkRetrieval: true
  },
  {
    id: "GEN-58", group: "placanje", query: "Prihvaćate li plaćanje pouzećem i postoji li dodatna naknada?",
    expected: { shouldContain: ["Potvrditi dostupnost pouzeća i iznos/detalje dodatne naknade ako postoji", "Navesti eventualna ograničenja (iznos, lokacija) i način naplate kod dostave"] },
    checkRetrieval: true
  },
  {
    id: "GEN-59", group: "placanje", query: "Nudite li plaćanje pouzećem i kolika je naknada?",
    expected: { shouldContain: ["Pouzeće je dostupno uz dostavu kurirskom službom.", "Naknada za pouzeće (fiksna ili postotak) prikazuje se prije potvrde narudžbe i može je naplatiti kurir."] },
    checkRetrieval: true
  },
  {
    id: "GEN-60", group: "placanje", query: "Kolika je ukupna cijena s dostavom i naknadom za pouzeće?",
    expected: { shouldContain: ["Ukupno = artikli + dostava + (eventualna) naknada za pouzeće; sve je vidljivo u košarici.", "Za točan izračun unesite adresu i odaberite način plaćanja; sustav automatski računa."] },
    checkRetrieval: true
  },
  {
    id: "GEN-61", group: "placanje", query: "Kako se plaća pouzeće (gotovina/kartica) i kome?",
    expected: { shouldContain: ["Plaća se pri preuzimanju; dostupni načini ovise o kuriru (gotovina/kartica).", "Ako kartice nisu podržane, pripremite točan iznos; račun stiže e‑poštom ili je u paketu."] },
    checkRetrieval: true
  },
  {
    id: "GEN-62", group: "placanje", query: "Prihvaćate li plaćanje pouzećem?",
    expected: { shouldContain: ["Potvrditi dostupnost pouzeća i način naplate (gotovina/kartica kod dostave, ako podržano).", "Navesti postoji li dodatna naknada i gdje je vidljiva.", "Spomenuti eventualna ograničenja (iznos, lokacija)."] },
    checkRetrieval: true
  },
  {
    id: "GEN-63", group: "placanje", query: "Postoji li dodatna naknada za plaćanje pouzećem i kolika je?",
    expected: { shouldContain: ["Objasniti je li naknada fiksna ili postotna i kako se dodaje na dostavu.", "Reći gdje se točno prikazuje (blagajna/sažetak).", "Predložiti metode bez naknade (npr. kartično/bankovna uplata), ako postoje."] },
    checkRetrieval: true
  },
  {
    id: "GEN-64", group: "placanje", query: "Koje načine plaćanja su dostupne prilikom online kupnje?",
    expected: { shouldContain: ["Nabrojati podržane metode (kartice, bankovna uplata, e-novčanici) bez navođenja nepostojećih.", "Uputiti na stranicu s detaljima o plaćanju za ažurne informacije.", "Napomenuti sigurnosne mjere (3D Secure/SSL), ako su relevantne."] },
    checkRetrieval: true
  },
  {
    id: "GEN-65", group: "placanje", query: "Kada mogu očekivati uplatu nakon što sam poslao/la knjige?",
    expected: { shouldContain: ["Isplata slijedi nakon zaprimanja i pregleda stanja (u pravilu X radnih dana od primitka)", "Uplata ide na IBAN naveden u prijavi", "Ako je rok prošao, javite se sa svojim podacima za provjeru statusa"] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-66", group: "placanje", query: "Poslao/la sam udžbenik početkom tjedna, ali uplata nije stigla — možete li provjeriti status?",
    expected: { shouldContain: ["Potrebni podaci za provjeru: broj ponude/pošiljke, ime i IBAN", "Provjeravamo datum primitka i očekivani termin isplate", "Mogući razlozi kašnjenja (vikendi/blagdani/kompletiranje pregleda)"] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-67", group: "placanje", query: "Prodala sam udžbenik prije nekoliko dana, ali isplata kasni — trebate li dodatne podatke?",
    expected: { shouldContain: ["Dostaviti ime/prezime, e-mail, IBAN i broj ponude ako postoji", "Provjeravamo je li pošiljka zaprimljena i IBAN ispravno evidentiran", "Podatke poslati odgovorom na ovaj tiket ili kroz službeni obrazac"] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-68", group: "placanje", query: "Na koji način vršite isplatu za otkup (gotovina ili uplata na račun)?",
    expected: { shouldContain: ["Standardno isplaćujemo na IBAN iz prijave; gotovina moguća u poslovnici (ako dostupno)", "Rok isplate nakon pregleda pristiglih knjiga", "Važnost točnih podataka za nesmetanu isplatu"] },
    checkRetrieval: true
  },
  {
    id: "GEN-69", group: "ostalo", query: "Najavljujem prijavu inspekciji / pravnu pritužbu",
    expected: { shouldContain: ["Potvrditi zaprimanje i objasniti formalan proces rješavanja pritužbi s kontaktom nadležnog tima", "Zatražiti relevantne podatke/dokaze i ponuditi rješenje u skladu s uvjetima poslovanja"] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "GEN-70", group: "ostalo", query: "Imam opće pitanje za administratora stranice",
    expected: { shouldContain: ["Zamoliti za pojašnjenje teme (tehnička podrška, prijedlog, sigurnost) i usmjeriti prema odgovarajućem kanalu", "Navesti gdje prijaviti tehničke probleme ili poslati prijedloge/pohvale"] },
    checkRetrieval: true
  },
  {
    id: "GEN-71", group: "ostalo", query: "Poslao/la sam poruku bez teksta ili se slika/prilog ne otvara — što da radim?",
    expected: { shouldContain: ["Zamoliti ponovno slanje s kratkim opisom problema/sadržaja", "Provjeriti veličinu/format priloga i stabilnost veze", "Ponuditi alternativni kanal (e-mail/obrazac) za slanje"] },
    checkRetrieval: true
  },
  {
    id: "GEN-72", group: "ostalo", query: "Duplicirao/la sam upit — hoće li to usporiti odgovor?",
    expected: { shouldContain: ["Spajamo duple tikete kako bismo zadržali povijest komunikacije", "Odgovarat ćemo u jednom threadu; nema potrebe za novim tiketima", "Procijenjeno vrijeme odgovora ostaje isto"] },
    checkRetrieval: true
  },
  {
    id: "GEN-73", group: "ostalo", query: "Greškom sam poslao/la samo pozdrav — trebam li opet pisati?",
    expected: { shouldContain: ["Da, pošaljite konkretno pitanje i relevantne detalje", "Agent ne može pomoći bez osnovnih informacija", "Prazni tiketi se mogu zatvoriti nakon kraćeg vremena neaktivnosti"] },
    checkRetrieval: true
  },
  {
    id: "GEN-74", group: "ostalo", query: "Možete li mi reći više o vašem loyalty (programu vjernosti)?",
    expected: { shouldContain: ["Objasniti kako program funkcionira (skupljanje bodova/razine/pogodnosti)", "Kako se prijaviti i gdje upravljati računom/podacima", "Navesti osnovne uvjete i moguće iznimke primjene pogodnosti"] },
    checkRetrieval: true
  },
  {
    id: "GEN-75", group: "ostalo", query: "Kako se učlaniti u loyalty program?",
    expected: { shouldContain: ["Koraci registracije (online ili u trgovini) i potrebni podaci", "Kada se benefiti aktiviraju i kako se bilježe bodovi", "Napomena o privatnosti i načinu odjave iz programa"] },
    checkRetrieval: true
  },
  {
    id: "GEN-76", group: "ostalo", query: "Kako iskoristiti bodove ili popuste iz loyalty programa?",
    expected: { shouldContain: ["Objasniti primjenu bodova/popusta u košarici ili na blagajni", "Gdje provjeriti stanje bodova i rok važenja", "Koga kontaktirati u slučaju problema s prikazom bodova"] },
    checkRetrieval: true
  }
];

module.exports = { GENERATED_SCENARIOS };
