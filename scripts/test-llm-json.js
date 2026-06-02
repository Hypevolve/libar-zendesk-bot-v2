require("dotenv").config();
const https = require("https");

const queries = [
  {text: "Koliko kosta dostava?", group: "dostava"},
  {text: "Kako funkcionira otkup knjiga?", group: "otkup"},
  {text: "Gdje se nalazite?", group: "lokacija"},
];

const prompt = `Ti si analiticar korisnicke podrske. Analiziraj sljedece STVARNE korisnicke upite iz Zendesk ticketa.

ZADATAK:
1. Grupiraj upite po temama: otkup, dostava, narudzba, povrat, kontakt, placanje, ostalo
2. Za svaku grupu izdvoji 3-5 tipicnih pitanja (generalizirane verzije, bez osobnih podataka)
3. Za svako pitanje navedi 2-3 kljucne tocke koje AI treba spomenuti u odgovoru
4. Oznaci koja pitanja zahtijevaju eskalaciju na ljudskog agenta

UPITI:
${queries.map((q, i) => `${i + 1}. ${q.text.slice(0, 180)}`).join("\n")}

Odgovori SAMO u JSON formatu (bez markdown, bez objasnjenja prije i poslije):
{"otkup": [{"q": "pitanje", "points": ["tocka1", "tocka2"], "escalate": false}], "dostava": [...], "narudzba": [...], "povrat": [...], "kontakt": [...], "placanje": [...], "ostalo": [...]}`;

const body = JSON.stringify({
  model: process.env.OPENROUTER_MODEL,
  messages: [{ role: "user", content: prompt }],
  max_tokens: 3000,
  temperature: 0.1
});

const req = https.request({
  hostname: "openrouter.ai",
  path: "/api/v1/chat/completions",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
    "HTTP-Referer": "https://antikvarijat-libar.com",
    "X-Title": "Libar Test Generator"
  }
}, (res) => {
  let data = "";
  res.on("data", (c) => { data += c; });
  res.on("end", () => {
    try {
      const parsed = JSON.parse(data);
      const content = parsed.choices?.[0]?.message?.content?.trim() || "";
      console.log("=== RAW CONTENT ===");
      console.log(content);
      console.log("=== END ===");
      
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        console.log("=== JSON EXTRACT ===");
        console.log(match[0].slice(0, 200));
      } else {
        console.log("No JSON match found");
      }
    } catch(e) {
      console.log("Error:", e.message);
      console.log(data.slice(0, 500));
    }
  });
});
req.on("error", (err) => console.log("Error:", err.message));
req.setTimeout(30000, () => { req.destroy(); console.log("Timeout"); });
req.write(body);
req.end();
