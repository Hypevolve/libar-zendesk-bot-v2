const {
  stripHtml: sharedStripHtml,
  normalizeForSearch
} = require("./textUtils");

function stripHtml(html = "") {
  return sharedStripHtml(html);
}

function normalizeText(text = "") {
  return normalizeForSearch(text);
}

const STOP_WORDS = new Set([
  "a",
  "ali",
  "bi",
  "da",
  "do",
  "ga",
  "i",
  "ih",
  "ili",
  "iz",
  "je",
  "li",
  "me",
  "mi",
  "na",
  "ne",
  "od",
  "po",
  "sam",
  "se",
  "sto",
  "su",
  "te",
  "to",
  "u",
  "uz",
  "vam",
  "vas",
  "za"
]);

const QUERY_ANALYSIS_CACHE = new Map();
const MAX_QUERY_ANALYSIS_CACHE_SIZE = 600;

const QUERY_ALIASES = [
  {
    pattern: /\b(radno vrijeme|kad radite|otvoreni|radite li|working hours)\b/,
    terms: ["radno vrijeme", "otvoreni", "ponedjeljak", "subota"]
  },
  {
    pattern: /\b(adresa|gdje ste|gdje se nalazite|lokacija|kontakt|telefon|telefonom|broj telefona|email)\b/u,
    terms: ["adresa", "lokacija", "kontakt", "telefon", "email"]
  },
  {
    pattern: /\b(adresa|gdje|lokacija).*\b(otkup\w*|poslovnic\w*|osobn\w*|fizick\w*)\b|\b(otkup\w*|poslovnic\w*|osobn\w*|fizick\w*).*\b(adresa|gdje|lokacija)\b/u,
    terms: ["zupanijska 17", "osijek", "fizicki otkup", "osobni dolazak", "poslovnica"]
  },
  {
    pattern: /\b(dostava|dostavn\w*|isporuka|pošiljka|posiljka|kurir|rok dostave|poštarina|postarina|cijena dostave|tro[sš]ak dostave)\b/u,
    terms: ["dostava", "isporuka", "pošiljka", "rok dostave", "kurir", "gls", "mbe", "boxnow", "5 97 eur", "3 50 eur"]
  },
  {
    pattern: /\b(naru[cč]iti|naruciti|kupiti|kupovina|kupnja|kupi).*\b(knjig\w*|udzben\w*|udžben\w*)\b|\b(knjig\w*|udzben\w*|udžben\w*)\b.*\b(naru[cč]iti|naruciti|kupiti|kupovina|kupnja|kupi)\b/u,
    terms: [
      "kako naruciti udzbenike",
      "udzbenike mozete kupiti putem webshopa",
      "kupi udzbenike",
      "pretrazivanje po sifri artikla",
      "pretrazivanje po nazivu knjige",
      "dodajte ga u kosaricu",
      "dostava rokovi troskovi pracenje"
    ]
  },
  {
    pattern: /\b(stanje zaliha|na stanju|po trgovin\w*|u trgovin\w*)\b|\b(knjig\w*|udzben\w*|udžben\w*|artikal|artikl\w*|naslov)\b.{0,50}\b(dostupnost|dostupn\w*|nedostup\w*)\b|\b(dostupnost|dostupn\w*|nedostup\w*)\b.{0,50}\b(knjig\w*|udzben\w*|udžben\w*|artikal|artikl\w*|naslov)\b/u,
    terms: [
      "knjiga nije dostupna sto napraviti",
      "provjerite dostupnost na webu",
      "pretraga na webu prikazuje stanje zaliha",
      "stanje zaliha u stvarnom vremenu",
      "ako knjiga nije dostupna",
      "zalihe se mijenjaju"
    ]
  },
  {
    pattern: /\b(zavr[sš]iti kupnju|kako zavr[sš]iti|dodati u ko(?:[sš]|\s*)aricu|ubacim u ko(?:[sš]|\s*)aricu|ubaciti u ko(?:[sš]|\s*)aricu|ne vidim ko(?:[sš]|\s*)aricu|ko(?:[sš]|\s*)aric\w*|kosaric\w*)\b/u,
    terms: [
      "kako naruciti udzbenike",
      "iz rezultata odaberite zeljeni naslov",
      "dodajte ga u kosaricu",
      "pretrazivanje funkcionira",
      "sifra artikla",
      "naziv knjige",
      "isbn"
    ]
  },
  {
    pattern: /\b(bar\s*kod|barkod|isbn).*\b(nedostup\w*|ne mogu dodati|ko[sš]ar\w*|kupiti|naruciti|naru[cč]iti)\b|\b(nedostup\w*|ne mogu dodati|ko[sš]ar\w*|kupiti|naruciti|naru[cč]iti)\b.*\b(bar\s*kod|barkod|isbn)\b/u,
    terms: [
      "knjiga nije dostupna sto napraviti",
      "provjerite dostupnost na webu",
      "pretraga na webu prikazuje stanje zaliha",
      "kako naruciti udzbenike",
      "sifra artikla",
      "isbn"
    ]
  },
  {
    pattern: /\b(fotografij\w*|slik\w*|privitak|privitku|upload|ubacim sliku|poslati sliku|posaljem sliku)\b/u,
    terms: [
      "posaljite fotografiju",
      "fotografiju racuna",
      "fotografiju sporne knjige",
      "info antikvarijat libar",
      "fb messenger",
      "putem chata"
    ]
  },
  {
    pattern: /\b(dostavn\w*\s+opcij\w*|opcij\w*\s+dostav\w*)\b/u,
    terms: [
      "dostava",
      "opcije dostave",
      "dostava na kucnu adresu",
      "boxnow paketomat",
      "osobno preuzimanje",
      "gls",
      "mbe"
    ]
  },
  {
    pattern: /\b(kucnu adresu|kućnu adresu|doma|na adresu)\b.*\b(dostava|slanje|kupnja|narudzba|narudžba)\b|\b(dostava|slanje|kupnja|narudzba|narudžba)\b.*\b(kucnu adresu|kućnu adresu|doma|na adresu)\b/u,
    terms: ["dostava na kucnu adresu", "gls", "mbe", "5 97 eur"]
  },
  {
    pattern: /\b(za koliko dana stize|za koliko dana stiže|koliko traje dostava|rok dostave|kada stize narudzba|kada stiže narudžba)\b/u,
    terms: ["1 do 2 radna dana", "gls", "mbe", "boxnow", "narudzbe saljemo iduci radni dan"]
  },
  {
    pattern: /\b(gls|boxnow|paketomat|tisak paket|overseas)\b/,
    terms: ["gls", "boxnow", "paketomat", "dostava", "isporuka", "cijena dostave"]
  },
  {
    pattern: /\b(3 knjige|tri knjige|3 udzbenika|tri udzbenika|manje od 4 knjige|manje od četiri knjige)\b/,
    terms: ["3 ili manje knjiga", "2 70 eur", "dostava", "online otkup"]
  },
  {
    pattern: /\b(samo tri knjige|jednu do tri knjige|3 knjige na otkup|manje od 4 knjige)\b/u,
    terms: ["3 ili manje knjiga", "2 70 eur", "dostava pri online otkupu"]
  },
  {
    pattern: /\b(cetiri knjige|četiri knjige|4\+ knjige|4 ili vise knjiga|4 ili više knjiga|besplatna dostava)\b/u,
    terms: ["4 ili vise knjiga", "dostava je besplatna", "mi pokrivamo trosak slanja", "online otkup"]
  },
  {
    pattern: /\b(dostava besplatna|besplatna kod online otkupa|online otkup besplatan)\b/u,
    terms: ["4 ili vise knjiga", "dostava je besplatna", "mi pokrivamo trosak slanja", "online otkup"]
  },
  {
    pattern: /\b(isplat\w*|ispla[cć]\w*|uplat\w*|upla[cć]\w*|novac|koliko cekam|koliko čekam|kad dobivam|kada dobivam)\b.{0,100}\b(online otkup|otkup\w*|posalj\w*.{0,30}knjig\w*|pošalj\w*.{0,30}knjig\w*|salj\w*.{0,30}knjig\w*|šalj\w*.{0,30}knjig\w*|primitku paket|primite paket|posiljk\w*|pošiljk\w*)\b|\b(online otkup|otkup\w*|posalj\w*.{0,30}knjig\w*|pošalj\w*.{0,30}knjig\w*|salj\w*.{0,30}knjig\w*|šalj\w*.{0,30}knjig\w*|primitku paket|primite paket|posiljk\w*|pošiljk\w*)\b.{0,100}\b(isplat\w*|ispla[cć]\w*|uplat\w*|upla[cć]\w*|novac|koliko cekam|koliko čekam|kad dobivam|kada dobivam)\b/u,
    terms: ["isplata kod online otkupa", "isti dan po primitku paketa", "sljedeci radni dan", "iznimnim slucajevima"]
  },
  {
    pattern: /\b(od koliko knjiga|koliko knjiga treba).*\b(besplatna|pokrivate dostavu|online otkup)\b|\b(besplatna|pokrivate dostavu|online otkup)\b.*\b(od koliko knjiga|koliko knjiga treba)\b/u,
    terms: ["4 ili vise knjiga", "dostava je besplatna", "mi pokrivamo trosak slanja", "online otkup"]
  },
  {
    pattern: /\b(što trebam donijeti|sto trebam donijeti|što donijeti|sto donijeti|fizick\w*\s+otkup|osobn\w*\s+dolazak)\b/u,
    terms: [
      "sto donijeti sa sobom",
      "knjige koje zelite prodati",
      "slozene i ciste",
      "oib ili broj osobne",
      "otkupni blok",
      "fizicki otkup",
      "osobni dolazak"
    ]
  },
  {
    pattern: /\b(dokument|osobna|osobnu|oib).*\b(poslovnic\w*|otkup\w*|knjige)\b|\b(poslovnic\w*|otkup\w*|knjige).*\b(dokument|osobna|osobnu|oib)\b/u,
    terms: [
      "sto donijeti sa sobom",
      "oib ili broj osobne",
      "otkupni blok",
      "knjige koje zelite prodati"
    ]
  },
  {
    pattern: /\b(kad|kada).*\b(novac|isplata|gotovina)\b.*\b(fizick\w*|poslovnic\w*|osobn\w*)\b|\b(fizick\w*|poslovnic\w*|osobn\w*)\b.*\b(kad|kada).*\b(novac|isplata|gotovina)\b/u,
    terms: [
      "fizicki otkup",
      "odmah gotovina na blagajni",
      "isplata je odmah u gotovini",
      "odmah pri predaji"
    ]
  },
  {
    pattern: /\b(isti\w*\s+knjig|isti\w*\s+udzbenik|puno istih knjiga|vise istih knjiga|više istih knjiga)\b/u,
    terms: [
      "20 istog udzbenika",
      "20+ istog udzbenika",
      "odobrenje direktora"
    ]
  },
  {
    pattern: /\b(hrpu istih udzbenika|hrpu istih knjiga|puno istih udzbenika|vise od 20 istih|više od 20 istih|20\+|20 istih|20 istog)\b/u,
    terms: ["20+ istog udzbenika", "odobrenje direktora"]
  },
  {
    pattern: /\b(narudžb\w*|narudzb\w*|status narudžbe|status narudzbe|broj narudžbe|broj narudzbe|order|otkazati narudžbu|otkazati narudzbu|stornirati)\b/u,
    terms: ["narudžba", "status", "broj narudžbe", "otkazivanje narudzbe", "storniranje narudzbe"]
  },
  {
    pattern: /\b(reklamacija|povrat|refund|oštećen|ostecen|kriva knjiga|pogresan udzbenik|pogrešan udžbenik|pogresna knjiga|pogrešna knjiga|vratiti|vracam|vraćam|zamjena)\b/u,
    terms: ["reklamacija", "povrat", "zamjena", "unutar 2 tjedna", "fotografiju racuna", "kriva knjiga"]
  },
  {
    pattern: /\b(otkup\w*|procjena|procjenu|vrednovanje|prodati knjige|buyback|pomoc oko otkupa|pomoć oko otkupa)\b/u,
    terms: ["otkup", "procjena", "vrednovanje", "prodati knjige", "bonus"]
  },
  {
    pattern: /\b(koje\s+sve\s+knjige|koje\s+knjige|sto\s+otkupljujete|što\s+otkupljujete|otkupljujete li|radne\s+bilje[zž]nice|gimnazij\w*|strukovn\w*|osnovn\w*\s+[sš]kol\w*|osnovno[sš]kol\w*)\b.{0,90}\b(otkup|otkupljuj|prodati|prodajem|prodaja|kupujete|primate)\b|\b(otkup|otkupljuj|prodati|prodajem|prodaja|kupujete|primate)\b.{0,90}\b(koje\s+sve\s+knjige|koje\s+knjige|sto\s+otkupljujete|što\s+otkupljujete|radne\s+bilje[zž]nice|gimnazij\w*|strukovn\w*|osnovn\w*\s+[sš]kol\w*|osnovno[sš]kol\w*)\b/u,
    terms: [
      "koje knjige otkupljujemo",
      "koje knjige ne otkupljujemo",
      "rabljene udzbenike za srednju skolu",
      "knjige za osnovnu skolu ne otkupljujemo",
      "romane beletristiku ne otkupljujemo",
      "radne biljeznice ne otkupljujemo"
    ]
  },
  {
    pattern: /\b(kupon\w*|bonus\w*|popust\w*|kampanj\w*)\b.{0,80}\b(otkup|otkupu|prodaj|prodati)\b|\b(otkup|otkupu|prodaj|prodati)\b.{0,80}\b(kupon\w*|bonus\w*|popust\w*|kampanj\w*)\b/u,
    terms: [
      "otkupne kampanje",
      "dodatni bonus na standardnu otkupnu cijenu",
      "aktivnim kampanjama obavjestavamo",
      "newsletter",
      "facebook instagram"
    ]
  },
  {
    pattern: /\b(na koji način|koje opcije|kako mogu predati|predati knjige|donijeti osobno|poslati knjige)\b/u,
    terms: [
      "na koji nacin mozete predati knjige",
      "fizicki otkup",
      "online otkup",
      "donosite knjige osobno",
      "knjige saljete kurirskom sluzbom"
    ]
  },
  {
    pattern: /\b(osnovn\w*\s+škol|osnovn\w*\s+skol|fakultet\w*|beletristik\w*|roman\w*)\b/u,
    terms: [
      "osnovna skola",
      "ne otkupljujemo",
      "knjige za osnovnu skolu",
      "fakultet",
      "beletristika",
      "romani"
    ]
  },
  {
    pattern: /\b(plaćanje|placanje|platiti|kartica|gotovina|pouzeće|pouzece|rate|rata)\b/u,
    terms: ["plaćanje", "kartica", "gotovina", "pouzeće", "2 do 6 rata", "pbz", "zaba"]
  },
  {
    pattern: /\b(r1|racun za firmu|račun za firmu|podaci tvrtke|podatke tvrtke)\b/u,
    terms: ["r1 racun", "nije automatski", "podaci tvrtke", "naziv oib adresa", "info@antikvarijat-libar.com"]
  },
  {
    pattern: /\b(aircash)\b/,
    terms: ["aircash", "isplata na aircash nije dostupna", "ne vrsimo isplatu"]
  },
  {
    pattern: /\b(dostavljac nije dosao|dostavljač nije došao|kurir nije dosao|kurir nije došao|nije pokupio paket|nije dosao po paket|nije došao po paket)\b/u,
    terms: ["sto ako dostavljac ne dode", "preuzimanje potvrdeno u sustavu", "kontaktirajte nas", "novi termin preuzimanja"]
  },
  {
    pattern: /\b(naljepnic\w*|etiket\w*|pisati adresu|pisem adresu|pišem adresu|pisati podatke|pisem podatke|pišem podatke|podatke na paket|adresa na paket|adresu na paket|sam pisati|sama pisati|sami pisati|dostavljac s gotovom|dostavljač s gotovom)\b/u,
    terms: ["dostavljac donosi gotovu naljepnicu", "vi nista ne pisete na paket", "ne morate traziti adresu za slanje", "kompletnim podacima posiljatelja i primatelja"]
  },
  {
    pattern: /\b(sam odnijeti|sama odnijeti|sami odnijeti|osobno predati|osobno odnijeti|predati paket).{0,80}\b(paketomat|gls|boxnow|online otkup)\b|\b(paketomat|gls|boxnow|online otkup)\b.{0,80}\b(sam odnijeti|sama odnijeti|sami odnijeti|osobno predati|osobno odnijeti|predati paket)\b/u,
    terms: ["mogu li sami odnijeti paket", "gls boxnow paketomat", "za sada nemamo tu opciju otkupa", "paket predajete dostavljacu"]
  },
  {
    pattern: /\b(kontakt|kontakti|telefon|email|mail|odgovarate|rok odgovora)\b/u,
    terms: ["telefon", "031 201 230", "email", "odgovaramo u roku 1 radnog dana"]
  },
  {
    pattern: /\b(povrat|zamjena|vratiti|vracam|vraćam|krivi udzbenik|krivi udžbenik|racun za povrat|račun za povrat)\b/u,
    terms: ["povrat i zamjena", "unutar 2 tjedna", "predocenje racuna", "fotografiju racuna"]
  },
  {
    pattern: /\b(loyalty|lojalnost|vjern\w*\s+kup\w*|nagrade|popusti za vjerne|popust\w* za vjern\w*|5,\s*8 ili 11|5\s+8\s+ili\s+11|prodam vise udzbenika|prodam više udžbenika)\b/u,
    terms: ["loyalty program", "5 udzbenika", "ukupno 8 udzbenika", "ukupno 11 udzbenika", "5 popusta", "10 popusta", "besplatna dostava", "sjedi 5"]
  },
  {
    pattern: /\b(sjedi\s*5|sjedi\s*pet|program vjernosti|program\s+vjern\w*)\b/u,
    terms: ["sjedi 5", "program vjernosti", "5 udzbenika besplatna dostava", "8 udzbenika 5 popusta", "11 udzbenika 10 popusta", "loyalty program"]
  },
  {
    pattern: /\b(14 dana|rok za povrat|rok povrata|jednostrani raskid|raskid ugovora|raskid kupnje|odustajanje|odustajem)\b/u,
    terms: ["14 dana od primitka robe", "jednostrani raskid", "trosak povrata snosi kupac", "povrat novca", "raskid online kupnje"]
  },
  {
    pattern: /\b(fizick\w*\s+otkup|osobn\w*\s+otkup|otkup\s+u\s+poslovnic|otkup\s+osobno)\b.{0,60}\b(isplat\w*|gotovina|novac|odmah)\b|\b(isplat\w*|gotovina|novac|odmah)\b.{0,60}\b(fizick\w*\s+otkup|osobn\w*\s+otkup|otkup\s+u\s+poslovnic|otkup\s+osobno)\b/u,
    terms: ["fizicki otkup", "odmah gotovina na blagajni", "isplata je odmah u gotovini", "odmah pri predaji", "oib ili broj osobne"]
  },
  {
    pattern: /\b(jednostrani raskid online kupnje|odustati od kupnje|odustajanje od kupnje|vracanje robe|vraćanje robe)\b/u,
    terms: ["14 dana od primitka robe", "jednostrani raskid", "trosak povrata snosi kupac", "povrat robe"]
  },
  {
    pattern: /\b(besplatna\s+dostava|besplatna\s+isporuka|koliko\s+knjiga\s+besplatno)\b.*\b(otkup|prodaja|isporuka)\b/u,
    terms: ["besplatna dostava kod otkupa", "4 ili vise knjiga", "dostava iznosi 2 70 eur"]
  },
  {
    pattern: /\b(na\s+stanju|dostupnost|zaliha|provjeri\s+stanje|je\s+li\s+dostupno)\b/u,
    terms: ["pretrazivanje po sifri artikla", "pretrazite na webu", "dostupnost na webu", "provjera zaliha"]
  },
  {
    pattern: /\b(oštećen\w*|oštećenje|šteta|neispravna|kriva\s+knjiga)\b/u,
    terms: ["reklamacija", "povrat", "fotografiju racuna", "unutar 2 tjedna", "kontakt info antikvarijat libar"]
  }
];

function isAircashPayoutQuery(normalized = "") {
  return /\baircash\b/.test(normalized) && (
    /\b(otkup|isplat\w*|novac|dobiti|uplat\w*|racun|račun)\b/.test(normalized) ||
    /\bne vrsimo isplatu\b/.test(normalized)
  );
}

function isOnlineBuybackPayoutTimingQuery(normalized = "") {
  const hasPayoutLanguage =
    /\b(isplat\w*|isplac\w*|uplat\w*|uplac\w*|novac|racun|iban)\b/.test(normalized) ||
    /\b(koliko cekam|kada dobivam|kad dobivam|kada sjeda|kad sjeda)\b/.test(normalized);

  if (!hasPayoutLanguage) {
    return false;
  }

  return /\b(online otkup|otkup\w*|posalj\w*.{0,30}knjig\w*|salj\w*.{0,30}knjig\w*|primitku paket|primite paket|posiljk\w*)\b/.test(normalized);
}

function isAcknowledgementOrGreetingQuery(normalized = "") {
  return /^(ne\s+)?(hvala|hvala puno|hvala vam|ok hvala|ok|okej|u redu|pozdrav|dobar dan|postovani|poštovani|takoder|takodjer|također|i vama takoder|i vama također|ugodan dan)[.!?\s]*$/.test(normalized);
}

function isLikelyBookSearchQuery(normalized = "") {
  if (!normalized || isAcknowledgementOrGreetingQuery(normalized)) {
    return false;
  }

  if (/(administrator|ignore all previous|listu svih kupaca|buyers|osobni podaci|private data)/.test(normalized)) {
    return false;
  }

  if (/(narudzb|reklamacij|povrat|refund|vratiti|vracam|vraćam|zamjena|pogresan|pogrešan|gdje mi je|nisam .*dobi|niste odgovorili|otkazat|otkaziv|dostav|isporuk|postarina|poštarina|paketomat|gls|boxnow|kurir|otkup|otkupu|kupujete|primate|prodajem|prodati|prodaja|loyalty|lojalnost|vjern\w*\s+kup\w*|nagrade|popust|donijeti\s+knjig|donesem\s+knjig|donesete\s+knjig|knjig.{0,30}bez najave|gotovin|radno vrijeme|kontakt|adresa|poslovnic|telefon|email|mail|placanj|plaćanj|platiti|rate|rata|kartic|r1|racun za firmu|račun za firmu|pricati|pričati|razgovarati|link|gmail|best selling|top 10|^i\s+(sta|što|kaj)\b)/.test(normalized)) {
    return false;
  }

  const bookSearchSignals =
    /(imate li|imate|dali imate|da li imate|ima li|imas li|imaš li|trazim|tražim|trebam|treba mi|trebala bi|trebao bih|zanima me|knjig|udzben|udzžben|udzben|us[zž]ben|radn\w*\s+bilje|isbn|autor|nakladnik|izdavac|izdava[cč]|lager|ponudi|na stanju|dostupn|kupiti|kupi)/.test(normalized);
  const schoolSignals =
    /(razred|gimnazij|strukovn|trogodisnj|trogodišnj|cetverogodisnj|četverogodišnj|srednj|skol|škol|komercijalist|hotelijer|turistick|ugostitelj)/.test(normalized);
  const subjectOrSeriesSignals =
    /(hrvatsk|matematik|englesk|povijest|geografij|\bgeo\b|kemij|fizik|biologij|informatik|vjeronauk|citank|čitank|focus|fokus|putokazi|headway|insight|solutions|fon fon|tragom teksta|dodi i vidi|dođi i vidi|knjizevn|književn|umrezi rijeci|umreži riječi|gospodarska|mehanika|daktilografija|zdravstvene njege|tehnologija|likovna umjetnost|online practice|edition)/.test(normalized);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const hasDigit = /\d/.test(normalized);
  const hasIsbnLikeNumber = /\b(?:97[89]\s*)?\d(?:\s*\d){8,12}[\dx]?\b/.test(normalized);
  const startsAsGeneralQuestion = /^(kako|koliko|gdje|kad|kada|sto|što|zasto|zašto|mozes li|možeš li|what|can)\b/.test(normalized);
  const broadTitleLike =
    !startsAsGeneralQuestion &&
    !/^(da|ne|a)\b/.test(normalized) &&
    tokens.length >= 2 &&
    tokens.length <= 14 &&
    (tokens.some((token) => token.length >= 5) || normalized.length >= 8);
  const singleTitleLike =
    tokens.length === 1 &&
    tokens[0].length >= 6 &&
    !/^(hvala|pozdrav|postovani|poštovani|takoder|također|takodjer)$/.test(tokens[0]);

  return (
    bookSearchSignals ||
    hasIsbnLikeNumber ||
    (schoolSignals && subjectOrSeriesSignals) ||
    (hasDigit && !startsAsGeneralQuestion && tokens.length <= 6) ||
    (hasDigit && subjectOrSeriesSignals && tokens.length <= 16) ||
    (subjectOrSeriesSignals && tokens.length >= 1 && tokens.length <= 30) ||
    broadTitleLike ||
    singleTitleLike
  );
}

function uniqueNormalizedTerms(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeText(value))
    .filter(Boolean))];
}

function tokenize(text = "") {
  return normalizeText(text)
    .split(" ")
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function expandQueryTerms(text = "") {
  const normalized = normalizeText(text);
  const expansions = [];
  const aircashPayoutQuery = isAircashPayoutQuery(normalized);

  if (isLikelyBookSearchQuery(normalized)) {
    expansions.push(
      "kako naruciti udzbenike",
      "pretrazivanje po nazivu knjige",
      "pretrazivanje po autoru",
      "pretrazivanje po isbn",
      "sifra artikla",
      "dodajte ga u kosaricu",
      "knjiga nije dostupna sto napraviti"
    );
  }

  for (const alias of QUERY_ALIASES) {
    if (aircashPayoutQuery && alias.terms.includes("knjiga nije dostupna sto napraviti")) {
      continue;
    }

    if (alias.pattern.test(normalized)) {
      expansions.push(...alias.terms);
    }
  }

  return uniqueNormalizedTerms(expansions);
}

function buildSearchLexicon(query = "") {
  const baseTerms = tokenize(query);
  const expandedTerms = expandQueryTerms(query);
  return uniqueNormalizedTerms([...baseTerms, ...expandedTerms]);
}

function getQueryAnalysis(query = "") {
  const cacheKey = String(query || "");
  const cached = QUERY_ANALYSIS_CACHE.get(cacheKey);

  if (cached) {
    return cached;
  }

  const analysis = {
    normalizedQuery: normalizeText(query),
    queryTokens: buildSearchLexicon(query),
    expandedTerms: expandQueryTerms(query)
  };

  if (QUERY_ANALYSIS_CACHE.size >= MAX_QUERY_ANALYSIS_CACHE_SIZE) {
    const oldestKey = QUERY_ANALYSIS_CACHE.keys().next().value;
    QUERY_ANALYSIS_CACHE.delete(oldestKey);
  }

  QUERY_ANALYSIS_CACHE.set(cacheKey, analysis);
  return analysis;
}

function truncateText(text, maxLength = 1800) {
  if (!text || text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trim()}...`;
}

function preprocessSearchQuery(query = "", options = {}) {
  const conversationFacts = Array.isArray(options.conversationFacts)
    ? options.conversationFacts.map((fact) => String(fact || "").trim()).filter(Boolean)
    : [];
  const retrievalHints = Array.isArray(options.retrievalHints)
    ? options.retrievalHints.map((hint) => String(hint || "").trim()).filter(Boolean)
    : [];
  const baseQuery = String(query)
    .replace(/\r/g, " ")
    .replace(/^(pozdrav|bok|dobar dan|lijep pozdrav|hello|hi|hey)[,!.:\s-]*/i, "")
    .replace(/\b(zanima me|molim vas|molim|možete li mi reći|mozete li mi reci|imam pitanje|htio bih pitati|htjela bih pitati|hvala unaprijed|unaprijed hvala)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const expandedHints = expandQueryTerms(baseQuery);
  const suffixParts = [...conversationFacts, ...retrievalHints, ...expandedHints];

  if (suffixParts.length === 0) {
    return baseQuery;
  }

  return `${baseQuery} ${suffixParts.join(" ")}`.trim();
}

function scoreSearchText(text = "", query = "") {
  const { normalizedQuery, queryTokens, expandedTerms } = getQueryAnalysis(query);
  const searchableText = normalizeText(text);

  if (!normalizedQuery || queryTokens.length === 0 || !searchableText) {
    return 0;
  }

  let score = 0;

  if (searchableText.includes(normalizedQuery)) {
    score += 18;
  }

  for (const token of queryTokens) {
    if (!searchableText.includes(token)) {
      continue;
    }

    score += token.length >= 7 ? 3 : 1;

    if (token.length >= 10) {
      score += 1;
    }
  }

  const tokenCoverage = queryTokens.filter((token) => searchableText.includes(token)).length / queryTokens.length;
  score += Math.round(tokenCoverage * 6);

  const exactPhraseBonuses = expandedTerms.filter((term) => searchableText.includes(term));
  score += exactPhraseBonuses.length * 8;

  if (/(3|tri).*(knjig|udzbenik).*(otkup)|otkup.*(3|tri).*(knjig|udzbenik)/.test(normalizedQuery) &&
      /(3 ili manje knjiga|2 70 eur)/.test(searchableText)) {
    score += 18;
  }

  if (/(20\+|20 istih|20 istog|vise od 20 istih|više od 20 istih|puno istih|hrpu istih|odobrenje)/.test(normalizedQuery) &&
      /(20\+ istog udzbenika|odobrenje direktora)/.test(searchableText)) {
    score += 120;
  }

  if (/(4|\bcetiri\b).*(knjig|udzbenik).*(otkup)|otkup.*(4|\bcetiri\b).*(knjig|udzbenik)|besplatna dostava/.test(normalizedQuery) &&
      /(4 ili vise knjiga|dostava je besplatna|mi pokrivamo trosak slanja)/.test(searchableText)) {
    score += 18;
  }

  if (/(povrat|zamjena|vratiti|vracam|pogresan|pogrešan|krivi|netocan|netočan)/.test(normalizedQuery) && /(rok|kada|do kada|koliko|koliki)/.test(normalizedQuery) &&
      /2 tjedna/.test(searchableText)) {
    score += 220;
  }

  if (/(kontakt|telefon|email|mail)/.test(normalizedQuery) && /(odgovarate|rok|kada)/.test(normalizedQuery) &&
      /(1 radnog dana|031 201 230)/.test(searchableText)) {
    score += 14;
  }

  if (/(radno vrijeme|kad radite|kada radite|radnim danom|preko tjedna|subotom|otvoreni|poslovnica radi)/.test(normalizedQuery) &&
      /(radno vrijeme poslovnice|ponedjeljak|petak|subota|08:00|20:00|13:00)/.test(searchableText)) {
    score += 220;
  }

  if (/r1/.test(normalizedQuery) && /r1 racun/.test(searchableText)) {
    score += 220;
  }

  if (/(pbz|zaba)/.test(normalizedQuery) && /(pbz|zaba)/.test(searchableText)) {
    score += 18;
  }

  if (/(platiti|placanje|plaćanje|rate|rata)/.test(normalizedQuery) &&
      /(2 do 6 rata|pbz|zaba|kartica|gotovina|pouzece|pouzeće)/.test(searchableText)) {
    score += 28;
  }

  if (isAircashPayoutQuery(normalizedQuery) && /\baircash\b/.test(searchableText)) {
    score += 36;

    if (/(isplata na aircash nije dostupna|ne vrsimo isplatu|isplata|isplate|hp uplatnic|revolut|iban)/.test(searchableText)) {
      score += 18;
    }
  }

  if (isOnlineBuybackPayoutTimingQuery(normalizedQuery) &&
      /(isti dan po primitku paketa|sljedeci radni dan|sljedeći radni dan|iznimnim slucajevima|iznimnim slučajevima)/.test(searchableText)) {
    score += 100;
  }

  if (/(gdje mi je paket|pratiti posiljku|tracking|link za pracenje)/.test(normalizedQuery) &&
      /(tracking broj|link za pracenje)/.test(searchableText)) {
    score += 18;
  }

  if (/(postarina|cijena dostave|trosak dostave|trošak dostave)/.test(normalizedQuery) &&
      /(5 97 eur|5,97 eur|3 50 eur|3,50 eur|gls|mbe|boxnow|osobno preuzimanje)/.test(searchableText)) {
    score += 22;
  }

  if (/(kako naruciti|naru[cč]iti|kupiti|kupnja|kupovina|kupi udzbenike|dodati u kosaricu|dodati u košaricu|dodati u ko\s*aricu|zavrsiti kupnju|završiti kupnju|ko\s*aric\w*)/.test(normalizedQuery) &&
      /(kako naruciti udzbenike|udžbenike mozete kupiti putem webshopa|udzbenike mozete kupiti putem webshopa|dodajte ga u kosaricu|dodajte ga u košaricu|pretrazivanje funkcionira|pretraživanje funkcionira)/.test(searchableText)) {
    score += 20;
  }

  if (isLikelyBookSearchQuery(normalizedQuery) &&
      /(kako naruciti udzbenike|pretrazivanje funkcionira|pretraživanje funkcionira|pretrazivanje po nazivu knjige|sifra artikla|šifra artikla|isbn|dodajte ga u kosaricu|knjiga nije dostupna)/.test(searchableText)) {
    score += 22;
  }

  if (/(koje knjige|koje sve knjige|radne biljeznice|radne bilježnice|sto otkupljujete|što otkupljujete|otkupljujete li|osnovn\w*\s+skol|osnovnoškol|osnovnoskol).{0,90}(otkup|otkupljuj|prodati|prodajem|prodaja|kupujete|primate)|(otkup|otkupljuj|prodati|prodajem|prodaja|kupujete|primate).{0,90}(koje knjige|koje sve knjige|radne biljeznice|radne bilježnice|sto otkupljujete|što otkupljujete|otkupljujete li|osnovn\w*\s+skol|osnovnoškol|osnovnoskol)/.test(normalizedQuery) &&
      /(koje knjige otkupljujemo|rabljene udzbenike za srednju skolu|ne otkupljujemo|romane|beletristiku|radne biljeznice|osnovu skolu|osnovnu skolu)/.test(searchableText)) {
    score += 24;
  }

  if (/(donijeti|donijem|doci|doći).{0,60}(knjig|udzben).{0,60}(bez najave|najav)|(knjig|udzben).{0,60}(bez najave|najav)/.test(normalizedQuery) &&
      /ne zahtijeva prethodnu najavu/.test(searchableText)) {
    score += 120;
  }

  if (/(donijeti|donijem|doci|doći).{0,60}(knjig|udzben)|(knjig|udzben).{0,60}(donijeti|donijem|doci|doći)/.test(normalizedQuery) &&
      /(zupanijska 17|osijek|fizicki otkup|fizički otkup|donosite knjige osobno)/.test(searchableText)) {
    score += 50;
  }

  if (/(gotovin|odmah|donesem|donesete|donijeti).{0,80}(knjig|udzben)|(knjig|udzben).{0,80}(gotovin|odmah|donesem|donesete|donijeti)/.test(normalizedQuery) &&
      /(odmah|gotovina na blagajni|na licu mjesta|fizicki otkup|fizički otkup)/.test(searchableText)) {
    score += 120;
  }

  if (/(na koji nacin|na koje nacine|kako mogu predati|kako mogu prodati|kako sve mogu prodati|predati knjige|donijeti osobno|poslati knjige|predati paket)/.test(normalizedQuery) &&
      /(fizicki otkup|fizički otkup|online otkup|donosite knjige osobno|knjige saljete kurirskom sluzbom|knjige šaljete kurirskom službom)/.test(searchableText)) {
    score += 80;
  }

  if (/(kupon|bonus|popust|kampanj).{0,80}(otkup|otkupu|prodaj|prodati)|(otkup|otkupu|prodaj|prodati).{0,80}(kupon|bonus|popust|kampanj)/.test(normalizedQuery) &&
      /(otkupne kampanje|dodatnim bonusom|aktivnim kampanjama|newsletter|facebook|instagram)/.test(searchableText)) {
    score += 20;
  }

  if (/(loyalty|lojalnost|vjern\w*\s+kup\w*|nagrade|popust\w* za vjern\w*|prodam vise udzbenika|prodam više udžbenika|5,\s*8 ili 11|5\s+8\s+ili\s+11|5.{0,20}8.{0,20}11)/.test(normalizedQuery) &&
      /(loyalty program|5 udzbenika|5 udžbenika|ukupno 8 udzbenika|ukupno 8 udžbenika|ukupno 11 udzbenika|ukupno 11 udžbenika|besplatna dostava|5% popusta|10% popusta|sjedi 5)/.test(searchableText)) {
    score += 260;
  }

  if (!isAircashPayoutQuery(normalizedQuery) &&
      /(stanje zaliha|na stanju|po trgovin|u trgovin|knjig.{0,50}(dostup|nedostup)|udzben.{0,50}(dostup|nedostup)|artikal.{0,50}(dostup|nedostup)|artikl.{0,50}(dostup|nedostup)|naslov.{0,50}(dostup|nedostup)|(dostup|nedostup).{0,50}(knjig|udzben|artikal|artikl|naslov))/.test(normalizedQuery) &&
      /(knjiga nije dostupna|provjerite dostupnost na webu|pretraga na webu prikazuje stanje zaliha|stanje zaliha u stvarnom vremenu|zalihe se mijenjaju)/.test(searchableText)) {
    score += 20;
  }

  if (/(bar kod|barkod|isbn).*(nedostup|kosar|košar|kupiti|naruciti|naručiti)|(?:nedostup|kosar|košar|kupiti|naruciti|naručiti).*(bar kod|barkod|isbn)/.test(normalizedQuery) &&
      /(knjiga nije dostupna|provjerite dostupnost na webu|stanje zaliha|sifra artikla|šifra artikla|isbn)/.test(searchableText)) {
    score += 18;
  }

  if (/(slik|fotograf|privitak|upload|ubacim sliku|poslati sliku|posaljem sliku)/.test(normalizedQuery) &&
      /(posaljite fotografiju|pošaljite fotografiju|fotografiju racuna|fotografiju sporne knjige|info@antikvarijat-libar\.com|fb messenger|putem chata)/.test(searchableText)) {
    score += 16;
  }

  if (/(naljepnic|etiket|pisati adresu|pisem adresu|pisati podatke|pisem podatke|podatke na paket|adresa na paket|adresu na paket|sam pisati|sama pisati|sami pisati|traziti adresu|tražiti adresu)/.test(normalizedQuery) &&
      /(naljepnic|vi nista ne pisete na paket|vi ništa ne pišete na paket|ne morate nista pisati|ne morate ništa pisati|ne morate traziti adresu|ne morate tražiti adresu|kompletnim podacima posiljatelja|kompletnim podacima pošiljatelja)/.test(searchableText)) {
    score += 180;
  }

  if (/(sam odnijeti|sama odnijeti|sami odnijeti|osobno predati|osobno odnijeti|predati paket).{0,80}(paketomat|gls|boxnow|online otkup)|(paketomat|gls|boxnow|online otkup).{0,80}(sam odnijeti|sama odnijeti|sami odnijeti|osobno predati|osobno odnijeti|predati paket)/.test(normalizedQuery) &&
      /(mogu li sami odnijeti paket|gls ili boxnow paketomat|za sada nemamo tu opciju|nemamo tu opciju otkupa)/.test(searchableText)) {
    score += 220;
  }

  if (/(kamo|gdje).*(dodem|dođem|osobno)|nosim osobno/.test(normalizedQuery) &&
      /(zupanijska 17|osijek)/.test(searchableText)) {
    score += 16;
  }

  if (/(adresa|gdje|lokacija).{0,80}(poslovnic|osobn|fizick|fizičk|otkup)|(poslovnic|osobn|fizick|fizičk|otkup).{0,80}(adresa|gdje|lokacija)/.test(normalizedQuery) &&
      /(zupanijska 17|adresa i radno vrijeme|osijek|fizicki otkup|fizički otkup)/.test(searchableText)) {
    score += 160;
  }

  if (/(sto trebam donijeti|što trebam donijeti|sto donijeti|što donijeti|donijeti sa sobom|koje podatke|podatke trebate|osobn\w* otkup)/.test(normalizedQuery) &&
      /(oib|broj osobne|knjige koje zelite prodati|knjige koje želite prodati|otkupni blok)/.test(searchableText)) {
    score += 160;
  }

  if (/^sadrzaj\b/.test(searchableText) || (searchableText.match(/clanak\s+\d+/g) || []).length >= 3) {
    score -= 8;
  }

  if (/(sjedi\s*5|sjedi\s*pet|program vjernosti|program\s+vjern\w*)/.test(normalizedQuery) &&
      /(sjedi 5|5 udzbenika|5 udžbenika|ukupno 8|ukupno 11|besplatna dostava|5% popusta|10% popusta|program vjernosti)/.test(searchableText)) {
    score += 260;
  }

  if (/(14 dana|rok za povrat|rok povrata|jednostrani raskid|raskid kupnje|odustati od kupnje|odustajanje)/.test(normalizedQuery) &&
      /(14 dana|jednostrani raskid|trosak povrata snosi kupac|trošak povrata snosi kupac|primitka robe)/.test(searchableText)) {
    score += 220;
  }

  if (/(fizick\w*\s+otkup|osobn\w*\s+otkup|otkup\s+u\s+poslovnic|otkup\s+osobno).{0,60}(isplat|gotovina|novac|odmah)|(isplat|gotovina|novac|odmah).{0,60}(fizick\w*\s+otkup|osobn\w*\s+otkup|otkup\s+u\s+poslovnic|otkup\s+osobno)/.test(normalizedQuery) &&
      /(odmah|gotovina na blagajni|na licu mjesta|fizicki otkup|fizički otkup|isplata je odmah)/.test(searchableText)) {
    score += 160;
  }

  return score;
}

function splitIntoSegments(text = "") {
  const plainText = stripHtml(text);

  if (!plainText) {
    return [];
  }

  const paragraphSegments = plainText
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const baseSegments = paragraphSegments.length > 0 ? paragraphSegments : [plainText];

  return baseSegments.flatMap((segment) => {
    if (segment.length <= 420) {
      return [segment];
    }

    const lineSegments = segment
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lineSegments.length > 1) {
      return lineSegments;
    }

    return segment
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
  });
}

function findBestExcerpt(text = "", query = "", maxLength = 900) {
  const segments = splitIntoSegments(text);

  if (segments.length === 0) {
    return "";
  }

  const rankedSegments = segments
    .map((segment, index) => ({
      segment,
      index,
      score: scoreSearchText(segment, query)
    }))
    .sort((left, right) => right.score - left.score);

  const topSegment = rankedSegments[0];

  if (!topSegment || topSegment.score <= 0) {
    return truncateText(stripHtml(text), maxLength);
  }

  let startIndex = topSegment.index;
  let endIndex = topSegment.index;
  let excerpt = topSegment.segment;
  let previousSegmentsAdded = 0;
  let nextSegmentsAdded = 0;

  // Expand around the best hit so short heading/table fragments keep
  // the nearby factual lines they depend on. Prefer following lines first:
  // KB exports often put exceptions, prices, or footnotes immediately after
  // the row that matched the query.
  while (endIndex < segments.length - 1 && nextSegmentsAdded < 14) {
    const candidate = segments[endIndex + 1];
    const nextExcerpt = `${excerpt} ${candidate}`.replace(/\s+/g, " ").trim();

    if (nextExcerpt.length > maxLength) {
      break;
    }

    endIndex += 1;
    nextSegmentsAdded += 1;
    excerpt = nextExcerpt;
  }

  while (startIndex > 0 && previousSegmentsAdded < 8) {
    const candidate = segments[startIndex - 1];
    const nextExcerpt = `${candidate} ${excerpt}`.replace(/\s+/g, " ").trim();

    if (nextExcerpt.length > maxLength) {
      break;
    }

    startIndex -= 1;
    previousSegmentsAdded += 1;
    excerpt = nextExcerpt;
  }

  return truncateText(excerpt, maxLength);
}

module.exports = {
  buildSearchLexicon,
  expandQueryTerms,
  findBestExcerpt,
  normalizeText,
  preprocessSearchQuery,
  scoreSearchText,
  stripHtml,
  tokenize,
  truncateText
};
