import {
  NIVEAUX_DIPLOME_AO,
  NIVEAUX_LANGUE_AO,
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
  return (NIVEAUX_LANGUE_AO as readonly string[]).includes(t) ? (t as NiveauLangueAo) : null;
}

/**
 * Expériences, une par ligne : « début | fin ou en cours | intitulé | employeur | pays |
 * secteurs séparés par ; | bailleur ». Mois au format AAAA-MM.
 */
export function lireExperiences(
  v: string,
): { ok: true; valeur: ExperienceSaisie[] } | { ok: false; erreur: string } {
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
      return { ok: false, erreur: `Ligne ${i + 1} : mois au format AAAA-MM attendus.` };
    }
    if (finLue !== null && finLue < debut) {
      return { ok: false, erreur: `Ligne ${i + 1} : la fin précède le début.` };
    }
    if (intitule === "" || employeur === "") {
      return { ok: false, erreur: `Ligne ${i + 1} : intitulé et employeur sont obligatoires.` };
    }
    if (pays !== "" && !/^[A-Za-z]{2}$/.test(pays)) {
      return { ok: false, erreur: `Ligne ${i + 1} : pays en code ISO à deux lettres (CI, SN…).` };
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
): { ok: true; valeur: DiplomeSaisi[] } | { ok: false; erreur: string } {
  const sortie: DiplomeSaisi[] = [];
  for (const [i, l] of lignes(v).entries()) {
    const [annee = "", niveau = "", intitule = "", domaine = "", etablissement = ""] = champs(l);
    const a = Number(annee);
    const n = lireNiveauDiplome(niveau);
    if (!/^\d{4}$/.test(annee) || a < 1950 || a > 2100) {
      return { ok: false, erreur: `Ligne ${i + 1} : année sur quatre chiffres attendue.` };
    }
    if (!n) return { ok: false, erreur: `Ligne ${i + 1} : niveau inconnu (bac, bac+2… doctorat).` };
    if (intitule === "" || domaine === "") {
      return { ok: false, erreur: `Ligne ${i + 1} : intitulé et domaine sont obligatoires.` };
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
): { ok: true; valeur: LangueSaisie[] } | { ok: false; erreur: string } {
  const sortie: LangueSaisie[] = [];
  for (const [i, l] of lignes(v).entries()) {
    const [langue = "", niveau = ""] = l.split(":").map((x) => x.trim());
    const n = lireNiveauLangue(niveau);
    if (langue === "" || !n) {
      return { ok: false, erreur: `Ligne ${i + 1} : « langue : niveau » attendu.` };
    }
    sortie.push({ langue, niveau: n });
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
export function lireCv(s: SaisieCv): Resultat<{ nom: string; contenu: ContenuCv }, ChampCv> {
  const erreurs: Partial<Record<ChampCv, string>> = {};
  const nom = s.nom.trim();
  const titre = s.titre.trim();
  if (nom === "") erreurs.nom = "Le nom de l'expert est obligatoire.";
  if (titre === "") erreurs.titre = "Le titre ou poste est obligatoire.";
  const experiences = lireExperiences(s.experiences);
  if (!experiences.ok) erreurs.experiences = experiences.erreur;
  const diplomes = lireDiplomes(s.diplomes);
  if (!diplomes.ok) erreurs.diplomes = diplomes.erreur;
  const langues = lireLangues(s.langues);
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
