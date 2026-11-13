import {
  creerTraduire,
  NIVEAUX_DIPLOME_AO,
  NIVEAUX_LANGUE_AO,
  type Langue,
  type NiveauDiplomeAo,
  type NiveauLangueAo,
} from "@missionpilot/shared";
import { saisieNiveauDiplome } from "./banque-ao-libelles";
import { champs, EN_COURS, lignes, MOIS } from "./banque-ao-saisie-base";
import type { ContenuCv, DiplomeSaisi, ExperienceSaisie, LangueSaisie } from "./banque-ao-types";
import { texteOuNull, decouperListe, type Resultat } from "./saisie";

/** « bac+5 », « Bac + 5 », « master », « doctorat » → niveau ; null si inconnu. */
export function lireNiveauDiplome(v: string): NiveauDiplomeAo | null {
  const t = v.toLowerCase().replace(/\s+/g, "").replace("+", "_");
  const alias: Record<string, NiveauDiplomeAo> = {
    licence: "bac_3",
    master: "bac_5",
    masters: "bac_5",
    bachelor: "bac_3",
    doctorate: "doctorat",
    doctorat: "doctorat",
    phd: "doctorat",
    bts: "bac_2",
    dut: "bac_2",
  };
  if (alias[t]) return alias[t];
  return (NIVEAUX_DIPLOME_AO as readonly string[]).includes(t) ? (t as NiveauDiplomeAo) : null;
}

export function lireNiveauLangue(v: string): NiveauLangueAo | null {
  const t = v.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (t === "langue maternelle") return "maternelle";
  const alias: Record<string, NiveauLangueAo> = {
    basic: "notions",
    fluent: "courant",
    bilingual: "bilingue",
    native: "maternelle",
  };
  if (alias[t]) return alias[t];
  return (NIVEAUX_LANGUE_AO as readonly string[]).includes(t) ? (t as NiveauLangueAo) : null;
}

/**
 * Expériences, une par ligne : « début | fin ou en cours | intitulé | employeur | pays |
 * secteurs séparés par ; | bailleur ». Mois au format AAAA-MM.
 */
export function lireExperiences(
  v: string,
  langue: Langue = "fr",
): { ok: true; valeur: ExperienceSaisie[] } | { ok: false; erreur: string } {
  const t = creerTraduire(langue);
  const ligneN = (i: number) => t(`Ligne ${i + 1} : `, `Line ${i + 1}: `);
  const sortie: ExperienceSaisie[] = [];
  for (const [i, l] of lignes(v).entries()) {
    const [
      debut = "",
      fin = "",
      intitule = "",
      employeur = "",
      pays = "",
      secteurs = "",
      bailleur = "",
    ] = champs(l);
    const finLue = EN_COURS.has(fin.toLowerCase()) ? null : fin;
    if (!MOIS.test(debut) || (finLue !== null && !MOIS.test(finLue))) {
      return {
        ok: false,
        erreur:
          ligneN(i) + t("mois au format AAAA-MM attendus.", "months in YYYY-MM format expected."),
      };
    }
    if (finLue !== null && finLue < debut) {
      return {
        ok: false,
        erreur: ligneN(i) + t("la fin précède le début.", "the end precedes the start."),
      };
    }
    if (intitule === "" || employeur === "") {
      return {
        ok: false,
        erreur:
          ligneN(i) +
          t("intitulé et employeur sont obligatoires.", "title and employer are required."),
      };
    }
    if (pays !== "" && !/^[A-Za-z]{2}$/.test(pays)) {
      return {
        ok: false,
        erreur:
          ligneN(i) +
          t(
            "pays en code ISO à deux lettres (CI, SN…).",
            "country as a two-letter ISO code (CI, SN…).",
          ),
      };
    }
    sortie.push({
      intitule,
      employeur,
      pays: pays === "" ? null : pays.toUpperCase(),
      debut,
      fin: finLue,
      secteurs: decouperListe(secteurs.replace(/;/g, ",")),
      bailleur: texteOuNull(bailleur),
    });
  }
  return { ok: true, valeur: sortie };
}

/** Diplômes, un par ligne : « année | niveau (bac+5, master…) | intitulé | domaine | établissement ». */
export function lireDiplomes(
  v: string,
  langue: Langue = "fr",
): { ok: true; valeur: DiplomeSaisi[] } | { ok: false; erreur: string } {
  const t = creerTraduire(langue);
  const ligneN = (i: number) => t(`Ligne ${i + 1} : `, `Line ${i + 1}: `);
  const sortie: DiplomeSaisi[] = [];
  for (const [i, l] of lignes(v).entries()) {
    const [annee = "", niveau = "", intitule = "", domaine = "", etablissement = ""] = champs(l);
    const a = Number(annee);
    const n = lireNiveauDiplome(niveau);
    if (!/^\d{4}$/.test(annee) || a < 1950 || a > 2100) {
      return {
        ok: false,
        erreur: ligneN(i) + t("année sur quatre chiffres attendue.", "four-digit year expected."),
      };
    }
    if (!n) {
      return {
        ok: false,
        erreur:
          ligneN(i) +
          t("niveau inconnu (bac, bac+2… doctorat).", "unknown level (bac, bac+2… doctorate)."),
      };
    }
    if (intitule === "" || domaine === "") {
      return {
        ok: false,
        erreur:
          ligneN(i) + t("intitulé et domaine sont obligatoires.", "title and field are required."),
      };
    }
    sortie.push({
      annee: a,
      niveau: n,
      intitule,
      domaine,
      etablissement: texteOuNull(etablissement),
    });
  }
  return { ok: true, valeur: sortie };
}

/** Langues, une par ligne : « langue : niveau » (notions, courant, bilingue, maternelle). */
export function lireLangues(
  v: string,
  langue: Langue = "fr",
): { ok: true; valeur: LangueSaisie[] } | { ok: false; erreur: string } {
  const t = creerTraduire(langue);
  const sortie: LangueSaisie[] = [];
  for (const [i, l] of lignes(v).entries()) {
    const [nomLangue = "", niveau = ""] = l.split(":").map((x) => x.trim());
    const n = lireNiveauLangue(niveau);
    if (nomLangue === "" || !n) {
      return {
        ok: false,
        erreur: t(
          `Ligne ${i + 1} : « langue : niveau » attendu.`,
          `Line ${i + 1}: “language: level” expected.`,
        ),
      };
    }
    sortie.push({ langue: nomLangue, niveau: n });
  }
  return { ok: true, valeur: sortie };
}

export interface SaisieCv {
  nom: string;
  titre: string;
  nationalite: string;
  resume: string;
  secteurs: string;
  competences: string;
  experiences: string;
  diplomes: string;
  langues: string;
}

type ChampCv = keyof SaisieCv;

/** Formulaire du CV → contenu attendu par l'API. */
export function lireCv(
  s: SaisieCv,
  langue: Langue = "fr",
): Resultat<{ nom: string; contenu: ContenuCv }, ChampCv> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampCv, string>> = {};
  const nom = s.nom.trim();
  const titre = s.titre.trim();
  if (nom === "")
    erreurs.nom = t("Le nom de l'expert est obligatoire.", "The expert's name is required.");
  if (titre === "")
    erreurs.titre = t("Le titre ou poste est obligatoire.", "The title or position is required.");
  const experiences = lireExperiences(s.experiences, langue);
  if (!experiences.ok) erreurs.experiences = experiences.erreur;
  const diplomes = lireDiplomes(s.diplomes, langue);
  if (!diplomes.ok) erreurs.diplomes = diplomes.erreur;
  const langues = lireLangues(s.langues, langue);
  if (!langues.ok) erreurs.langues = langues.erreur;
  if (Object.keys(erreurs).length > 0 || !experiences.ok || !diplomes.ok || !langues.ok) {
    return { ok: false, erreurs };
  }
  return {
    ok: true,
    charge: {
      nom,
      contenu: {
        titre,
        nationalite: texteOuNull(s.nationalite),
        resume: texteOuNull(s.resume),
        secteurs: decouperListe(s.secteurs),
        competences: decouperListe(s.competences),
        experiences: experiences.valeur,
        diplomes: diplomes.valeur,
        langues: langues.valeur,
      },
    },
  };
}

/** Contenu de l'API → champs du formulaire (nouvelle version). */
export function saisieDepuisCv(nom: string, c: ContenuCv): SaisieCv {
  return {
    nom,
    titre: c.titre,
    nationalite: c.nationalite ?? "",
    resume: c.resume ?? "",
    secteurs: c.secteurs.join(", "),
    competences: c.competences.join(", "),
    experiences: c.experiences
      .map((e) =>
        [
          e.debut,
          e.fin ?? "en cours",
          e.intitule,
          e.employeur,
          e.pays ?? "",
          e.secteurs.join(" ; "),
          e.bailleur ?? "",
        ].join(" | "),
      )
      .join("\n"),
    diplomes: c.diplomes
      .map((d) =>
        [
          String(d.annee),
          saisieNiveauDiplome(d.niveau),
          d.intitule,
          d.domaine,
          d.etablissement ?? "",
        ].join(" | "),
      )
      .join("\n"),
    langues: c.langues.map((l) => `${l.langue} : ${l.niveau}`).join("\n"),
  };
}
