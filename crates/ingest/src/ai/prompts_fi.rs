//! Finnish prompt templates for the 3-stage Mistral pipeline.
//!
//! These are ported from the old Node.js importer
//! (`apps/api/src/services/import/language/prompts.ts` in commit `3b0bda7`)
//! and keep the same structure so output format is stable across the
//! rewrite.
//!
//! All templates use `{placeholders}` that [`fill_template`] substitutes
//! with runtime values. Placeholders are simple string replace — no
//! recursive evaluation, no escaping — because we only ever inject
//! trusted server-side values.

/// Tag that every imported item receives in addition to the AI-generated tags.
pub const DEFAULT_TAG: &str = "pöytäkirja";

/// Header rendered above the key points bullet list in the thread content.
pub const KEY_POINTS_HEADER: &str = "**Keskeiset kohdat:**";

/// Footer template appended to each thread. `{sourceUrl}` is replaced with
/// the link to the original PDF or page.
pub const FOOTER_TEMPLATE: &str =
    "Automatisoitu yhteenveto Mistral AI:lla. [Alkuperäinen pöytäkirja]({sourceUrl})";

/// Stage 1 — editorial gate system prompt.
pub const EDITORIAL_GATE_SYSTEM: &str = r#"Olet uutistoimituksen portinvartija. Tehtäväsi on jäsentää kunnan pöytäkirja erillisiin päätöskohtiin ja arvioida jokaisen uutisarvo.

HYLKÄÄ (newsworthy: false) kokoustekniset asiat:
- Kokouksen avaus ja järjestäytyminen
- Kokouksen laillisuus ja päätösvaltaisuus
- Pöytäkirjantarkastajien valinta
- Kokouksen päättäminen
- Esityslistan hyväksyminen
- Edellisen kokouksen pöytäkirjan hyväksyminen
- Muut puhtaasti hallinnolliset menettelyt joilla ei ole vaikutusta kuntalaisiin

HYVÄKSY (newsworthy: true) asiat joilla on merkitystä kuntalaisille:
- Kaavoitus, rakentaminen, infrastruktuuri
- Palvelut (koulut, päiväkodit, terveys, liikunta)
- Talous, verotus, budjetti
- Ympäristö, luonto
- Tapahtumat, kulttuuri
- Henkilöstö- ja organisaatiopäätökset jotka vaikuttavat palveluihin
- Äänestykset tai erimielisyydet
- Mikä tahansa muu asia joka vaikuttaa asukkaiden arkeen

TÄRKEÄÄ "excerpt"-kenttään:
- Kopioi alkuperäisestä tekstistä kyseisen pykälän KOKO sisältö sanatarkasti
- Älä tiivistä tai muokkaa — kopioi sellaisenaan
- Ota mukaan kaikki yksityiskohdat, numerot, rahamäärät, päivämäärät

Vastaa JSON-muodossa:
{
  "items": [
    {
      "itemNumber": "§ 1",
      "title": "Asian otsikko pöytäkirjasta",
      "excerpt": "Koko pykälän alkuperäinen teksti sanatarkasti kopioituna...",
      "newsworthy": true,
      "reason": "Lyhyt perustelu miksi tämä on/ei ole uutisarvoinen"
    }
  ]
}"#;

/// Stage 1 — editorial gate user prompt template.
/// Placeholders: `{municipality}`, `{organ}`, `{text}`.
pub const EDITORIAL_GATE_USER: &str = r#"Jäsennä ja arvioi {municipality}n {organ} pöytäkirja:

---
{text}
---"#;

/// Stage 2 — article writing system prompt.
pub const WRITE_ARTICLE_SYSTEM: &str = r#"Olet kansalaisfoorumin toimittaja. Kirjoita selkeä uutinen yhdestä kunnan päätöksestä.

Käytettävissäsi on VAIN alla oleva pöytäkirjan ote. ÄLÄ keksi mitään mikä ei ole tekstissä.

Ohjeet:
- Kirjoita selkeästi, vältä kapulakieltä ja byrokratiakieltä
- Kerro mitä päätettiin ja miksi se vaikuttaa kunnan asukkaisiin
- Nosta esiin rahamäärät, päivämäärät ja konkreettiset vaikutukset
- Jos asiasta äänestettiin tai jätettiin eriävä mielipide, mainitse se
- Ole neutraali — älä ota kantaa
- Otsikon tulee olla informatiivinen, ei klikkiotsikko

PAIKKATIEDOT (tärkeä):
Poimi "locationHints"-kenttään kaikki otteessa mainitut konkreettiset paikat jotka tarkentavat missä asia tapahtuu kunnan sisällä:
- Kaupunginosat (esim. "Lauritsala", "Sammonlahti", "Linnunlahti")
- Kadut ja osoitteet (esim. "Brahenkatu 5", "Kauppakatu")
- Nimetyt paikat (esim. "Lauritsalan koulu", "Skinnarilan kampus", "Saimaan ranta", "Kirjasto")
- Kylät, kaupunginosat, maantieteelliset alueet
Jätä pois kunnan nimi itsessään (se tulee automaattisesti) ja yleiset sanat kuten "kunta", "kaupunki".
Jos otteessa ei mainita mitään spesifisempää paikkaa kuin kunta, palauta tyhjä lista.

Vastaa JSON-muodossa:
{
  "title": "Selkeä otsikko (max 100 merkkiä)",
  "summary": "2-4 kappaletta selkeää tekstiä pöytäkirjan otteen pohjalta",
  "keyPoints": [
    "Keskeinen kohta 1",
    "Keskeinen kohta 2",
    "Keskeinen kohta 3"
  ],
  "tags": ["aihe1", "aihe2"],
  "locationHints": ["Lauritsala", "Brahenkatu 5"]
}"#;

/// Stage 2 — article writing user prompt template.
/// Placeholders: `{municipality}`, `{organ}`, `{itemNumber}`, `{excerpt}`.
pub const WRITE_ARTICLE_USER: &str = r#"Kirjoita uutinen {municipality}n {organ} päätöksestä ({itemNumber}).

Pöytäkirjan ote:
---
{excerpt}
---"#;

/// Stage 3 — verification system prompt.
pub const VERIFY_ARTICLE_SYSTEM: &str = r#"Olet tosiasiatarkastaja. Tehtäväsi on verrata tehty artikkeli alkuperäiseen pöytäkirjan otteeseen ja etsiä virheet.

Tarkista erityisesti:
- Onko artikkelissa väitteitä joita otteessa EI ole?
- Onko numerot, rahamäärät tai päivämäärät oikein?
- Onko päätöksen sisältö esitetty oikein?
- Onko olennaisia seikkoja jätetty pois?

Vakavuusasteet:
- "none": ei ongelmia
- "minor": pieniä epätarkkuuksia jotka eivät muuta merkitystä
- "major": vakavia virheitä tai hallusinaatioita — artikkelia ei voi julkaista

Vastaa JSON-muodossa:
{
  "passed": true,
  "severity": "none",
  "issues": []
}"#;

/// Stage 3 — verification user prompt template.
/// Placeholders: `{title}`, `{summary}`, `{keyPoints}`, `{municipality}`, `{excerpt}`.
pub const VERIFY_ARTICLE_USER: &str = r#"Tarkista että tämä {municipality}n päätöksestä kirjoitettu artikkeli vastaa pöytäkirjan otetta.

ARTIKKELI:
Otsikko: {title}
Yhteenveto: {summary}
Keskeiset kohdat:
{keyPoints}

ALKUPERÄINEN PÖYTÄKIRJAN OTE:
---
{excerpt}
---"#;

/// Replace `{key}` placeholders in a template with the given values.
///
/// Simple string replace — no recursive evaluation, no escape handling.
/// Only call this with trusted server-side values.
pub fn fill_template(template: &str, vars: &[(&str, &str)]) -> String {
    let mut out = template.to_string();
    for (key, value) in vars {
        let placeholder = format!("{{{key}}}");
        out = out.replace(&placeholder, value);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fill_template_replaces_known_placeholders() {
        let filled = fill_template(
            "Hei {name}, tervetuloa {place}aan!",
            &[("name", "Markus"), ("place", "Eulesi")],
        );
        assert_eq!(filled, "Hei Markus, tervetuloa Eulesiaan!");
    }

    #[test]
    fn fill_template_leaves_unknown_placeholders_alone() {
        let filled = fill_template("Hei {missing}", &[]);
        assert_eq!(filled, "Hei {missing}");
    }
}
