/**
 * Redressement, onglet « Financement » : de la saisie d'un formulaire au corps d'API (nouvelle
 * version de covenants, nouvelle version du plan de financement, pré-remplissage depuis la
 * proposition). Contrôles de forme avec messages en français ; l'API revalide tout. Aucun calcul
 * métier : pas de total, pas de solde. Logique pure, testée dans
 * `redressement-financement-saisie.test.ts`.
 */
import {
  RED_COVENANT_FREQUENCES,
  RED_COVENANT_OPERATEURS,
  RED_COVENANT_RATIOS,
  RED_COVENANT_SEUIL_PB_MAX,
  RED_COVENANTS_PAR_VERSION_MAX,
  RED_FINANCEMENT_EMPLOIS,
  RED_FINANCEMENT_LIGNES_MAX,
  RED_FINANCEMENT_ORIGINE_LIBELLES,
  RED_FINANCEMENT_PERIODES_MAX,
  RED_FINANCEMENT_RESSOURCES,
  RED_FINANCEMENT_TYPES_PERIODE,
  type RedCovenantFrequence,
  type RedCovenantOperateur,
  type RedCovenantRatio,
  type RedCovenantsVersionCreation,
  type RedCovenantsVersionVue,
  type RedFinancementOrigine,
  type RedFinancementPropositionVue,
  type RedFinancementSens,
  type RedFinancementTypePeriode,
  type RedFinancementVersionCreation,
  type RedFinancementVersionVue,
} from "@missionpilot/shared";
import type { Devise } from "./format";
import { formeCovenant } from "./redressement-financement";
import { dateValide } from "./periode";
import { lireEntier, lireMontantRed, montantVersTexte } from "./redressement-saisie";
import { lireNombre, texteOuNull, type Resultat } from "./saisie";

type Erreurs<K extends string> = Partial<Record<K, string>>;

let compteur = 0;
const nouvelleCle = (prefixe: string) => `${prefixe}-${++compteur}`;

const MSG_MOTIF = "Le motif compte 500 caractères au plus.";

// --- Covenants ----------------------------------------------------------------------------------------

export interface SaisieCovenant {
  cle: string;
  ratio: RedCovenantRatio;
  operateur: RedCovenantOperateur;
  /** Seuil dans l'unité du ratio : rapport (« 1,2 ») ou pourcentage (« 25 »). */
  seuil: string;
  preteur: string;
  frequence: RedCovenantFrequence;
}
export interface SaisieCovenants {
  covenants: SaisieCovenant[];
  motif: string;
}
export type ChampCovenants = "covenants" | "motif";

/** Facteur entre le seuil saisi et les points de base de l'API : rapport ×10 000, pourcentage ×100. */
export const facteurSeuilCovenant = (r: RedCovenantRatio) =>
  formeCovenant(r) === "pourcentage" ? 100 : 10_000;

/** Écriture du seuil dans l'aide : « rapport (1,20) » ou « pourcentage (25) ». */
export const uniteSeuilCovenant = (r: RedCovenantRatio) =>
  formeCovenant(r) === "pourcentage"
    ? "pourcentage (par exemple 25 pour 25 %)"
    : "rapport (par exemple 1,2)";

export function covenantVide(): SaisieCovenant {
  return {
    cle: nouvelleCle("covenant"),
    ratio: RED_COVENANT_RATIOS[0],
    operateur: "min",
    seuil: "",
    preteur: "",
    frequence: "annuelle",
  };
}

/** Points de base de l'API vers le texte modifiable du seuil (« 12000 » devient « 1,2 »). */
export function seuilVersSaisie(ratio: RedCovenantRatio, pb: number): string {
  return String(pb / facteurSeuilCovenant(ratio)).replace(".", ",");
}

/** Formulaire d'une nouvelle version, prérempli depuis la version courante. */
export function saisieCovenantsDepuis(version: RedCovenantsVersionVue | null): SaisieCovenants {
  return {
    motif: "",
    covenants: (version?.covenants ?? []).map((c) => ({
      cle: nouvelleCle("covenant"),
      ratio: c.ratio,
      operateur: c.operateur,
      seuil: seuilVersSaisie(c.ratio, c.seuil_pb),
      preteur: c.preteur ?? "",
      frequence: c.frequence,
    })),
  };
}

/** Seuil saisi vers points de base : `null` si vide, `NaN` si illisible ou hors bornes. */
export function lireSeuilCovenant(texte: string, ratio: RedCovenantRatio): number | null {
  const n = lireNombre(texte);
  if (n === null) return null;
  if (Number.isNaN(n)) return Number.NaN;
  const facteur = facteurSeuilCovenant(ratio);
  const pb = Math.round(n * facteur);
  if (Math.abs(n * facteur - pb) > 1e-6) return Number.NaN;
  if (Math.abs(pb) > RED_COVENANT_SEUIL_PB_MAX) return Number.NaN;
  return pb;
}

export function corpsCovenantsDepuisFormulaire(
  s: SaisieCovenants,
): Resultat<RedCovenantsVersionCreation, ChampCovenants> {
  const erreurs: Erreurs<ChampCovenants> = {};
  const covenants: RedCovenantsVersionCreation["covenants"] = [];
  if (s.covenants.length > RED_COVENANTS_PAR_VERSION_MAX) {
    erreurs.covenants = `${RED_COVENANTS_PAR_VERSION_MAX} covenants au plus par version.`;
  }
  s.covenants.forEach((c, i) => {
    if (erreurs.covenants) return;
    const numero = i + 1;
    if (!(RED_COVENANT_RATIOS as readonly string[]).includes(c.ratio)) {
      erreurs.covenants = `Covenant ${numero} : choisissez un ratio de la liste.`;
      return;
    }
    if (!(RED_COVENANT_OPERATEURS as readonly string[]).includes(c.operateur)) {
      erreurs.covenants = `Covenant ${numero} : choisissez plancher ou plafond.`;
      return;
    }
    if (!(RED_COVENANT_FREQUENCES as readonly string[]).includes(c.frequence)) {
      erreurs.covenants = `Covenant ${numero} : choisissez une fréquence de la liste.`;
      return;
    }
    const seuil = lireSeuilCovenant(c.seuil, c.ratio);
    if (seuil === null || Number.isNaN(seuil)) {
      erreurs.covenants = `Covenant ${numero} : saisissez un seuil lisible (${uniteSeuilCovenant(c.ratio)}, au plus ${formeCovenant(c.ratio) === "pourcentage" ? "deux" : "quatre"} décimales).`;
      return;
    }
    const preteur = texteOuNull(c.preteur);
    if (preteur !== null && preteur.length > 120) {
      erreurs.covenants = `Covenant ${numero} : le prêteur compte 120 caractères au plus.`;
      return;
    }
    covenants.push({
      ratio: c.ratio,
      operateur: c.operateur,
      seuil_pb: seuil,
      ...(preteur !== null ? { preteur } : {}),
      frequence: c.frequence,
    });
  });
  if (!erreurs.covenants) {
    const vus = new Map<string, number>();
    for (const [i, c] of covenants.entries()) {
      const cle = `${c.ratio}|${c.operateur}`;
      if (vus.has(cle)) {
        erreurs.covenants = `Covenant ${i + 1} : un même ratio ne porte pas deux fois le même opérateur.`;
        break;
      }
      vus.set(cle, c.seuil_pb);
    }
    if (!erreurs.covenants) {
      for (const [i, c] of covenants.entries()) {
        const plafond = c.operateur === "min" ? vus.get(`${c.ratio}|max`) : undefined;
        if (plafond !== undefined && c.seuil_pb > plafond) {
          erreurs.covenants = `Covenant ${i + 1} : le plancher d'un ratio ne dépasse pas son plafond.`;
          break;
        }
      }
    }
  }
  const motif = texteOuNull(s.motif);
  if (motif !== null && motif.length > 500) erreurs.motif = MSG_MOTIF;
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { covenants, ...(motif !== null ? { motif } : {}) } };
}

// --- Plan de financement ------------------------------------------------------------------------------

export interface SaisieLigneFinancement {
  cle: string;
  periode: string;
  sens: RedFinancementSens;
  nature: string;
  libelle: string;
  montant: string;
  /** Origine d'une ligne pré-remplie (retirée au pré-remplissage suivant) ; null si saisie à la main. */
  origine: RedFinancementOrigine | null;
}
export interface SaisieFinancement {
  date_debut: string;
  type_periode: RedFinancementTypePeriode;
  nombre_periodes: string;
  motif: string;
  lignes: SaisieLigneFinancement[];
}
export type ChampFinancement =
  "date_debut" | "type_periode" | "nombre_periodes" | "lignes" | "motif";

export const naturesDuSens = (sens: RedFinancementSens): readonly string[] =>
  sens === "emploi" ? RED_FINANCEMENT_EMPLOIS : RED_FINANCEMENT_RESSOURCES;

export function ligneFinancementVide(sens: RedFinancementSens = "emploi"): SaisieLigneFinancement {
  return {
    cle: nouvelleCle("financement"),
    periode: "1",
    sens,
    nature: naturesDuSens(sens)[0] ?? "",
    libelle: "",
    montant: "",
    origine: null,
  };
}

/** Premier jour du mois suivant la date donnée (valeur de départ d'un premier plan). */
export function premierDuMoisSuivant(date: string): string {
  const [annee, mois] = date.split("-").map(Number);
  if (!annee || !mois) return date;
  return mois === 12 ? `${annee + 1}-01-01` : `${annee}-${String(mois + 1).padStart(2, "0")}-01`;
}

/** Vrai pour un jour de mois « 01 » d'une date valide. */
export const estPremierDuMois = (date: string) =>
  dateValide(date) !== null && date.slice(8, 10) === "01";

/** Formulaire d'une nouvelle version, prérempli depuis la version courante (ou vide). */
export function saisieFinancementDepuis(
  version: RedFinancementVersionVue | null,
  devise: Devise,
  aujourdhui: string,
): SaisieFinancement {
  if (version === null) {
    return {
      date_debut: premierDuMoisSuivant(aujourdhui),
      type_periode: "annee",
      nombre_periodes: "3",
      motif: "",
      lignes: [],
    };
  }
  return {
    date_debut: version.date_debut,
    type_periode: version.type_periode,
    nombre_periodes: String(version.nombre_periodes),
    motif: "",
    lignes: version.lignes.map((l) => ({
      cle: nouvelleCle("financement"),
      periode: String(l.periode),
      sens: l.sens,
      nature: l.nature,
      libelle: l.libelle ?? "",
      montant: montantVersTexte(l.montant, devise),
      origine: null,
    })),
  };
}

/**
 * Applique une proposition de l'API au brouillon : le cadre de la proposition remplace celui du
 * formulaire et ses lignes remplacent les lignes d'un précédent pré-remplissage ; les lignes
 * saisies à la main sont conservées. Rien n'est enregistré.
 */
export function appliquerProposition(
  s: SaisieFinancement,
  p: RedFinancementPropositionVue,
  devise: Devise,
): SaisieFinancement {
  return {
    ...s,
    date_debut: p.cadre.date_debut,
    type_periode: p.cadre.type_periode,
    nombre_periodes: String(p.cadre.nombre_periodes),
    lignes: [
      ...s.lignes.filter((l) => l.origine === null),
      ...p.lignes.map((l): SaisieLigneFinancement => ({
        cle: nouvelleCle("financement"),
        periode: String(l.periode),
        sens: l.sens,
        nature: l.nature,
        libelle: RED_FINANCEMENT_ORIGINE_LIBELLES[l.origine],
        montant: montantVersTexte(l.montant, devise),
        origine: l.origine,
      })),
    ],
  };
}

/** Compte rendu d'un pré-remplissage (lignes proposées, échéances hors du plan). */
export function messageProposition(p: RedFinancementPropositionVue): string {
  const hors = p.anterieures + p.ulterieures;
  const parties = [
    `${p.lignes.length} ligne(s) proposée(s), non enregistrée(s) : relisez-les avant d'enregistrer.`,
  ];
  if (hors > 0) {
    parties.push(
      `${p.anterieures} échéance(s) antérieure(s) et ${p.ulterieures} postérieure(s) au plan ne sont pas reprises.`,
    );
  }
  if (p.besoin_hors_plan) {
    parties.push("Le besoin de financement de la trésorerie tombe hors de la période du plan.");
  }
  return parties.join(" ");
}

export function corpsFinancementDepuisFormulaire(
  s: SaisieFinancement,
  devise: Devise,
): Resultat<RedFinancementVersionCreation, ChampFinancement> {
  const erreurs: Erreurs<ChampFinancement> = {};
  if (dateValide(s.date_debut) === null) {
    erreurs.date_debut = "Date illisible : saisissez une date entre 2000 et 2100.";
  } else if (!estPremierDuMois(s.date_debut)) {
    erreurs.date_debut = "Un premier jour de mois est attendu.";
  }
  if (!(RED_FINANCEMENT_TYPES_PERIODE as readonly string[]).includes(s.type_periode)) {
    erreurs.type_periode = "Choisissez des années ou des semestres.";
  }
  const nombre = lireEntier(s.nombre_periodes, 1, RED_FINANCEMENT_PERIODES_MAX);
  if (nombre === null || Number.isNaN(nombre)) {
    erreurs.nombre_periodes = `Saisissez un nombre de périodes de 1 à ${RED_FINANCEMENT_PERIODES_MAX}.`;
  }
  const lignes: RedFinancementVersionCreation["lignes"] = [];
  s.lignes.forEach((l, i) => {
    if (erreurs.lignes) return;
    const numero = i + 1;
    if (l.montant.trim() === "") return;
    const montant = lireMontantRed(l.montant, devise);
    if (montant === null || Number.isNaN(montant)) {
      erreurs.lignes = `Ligne ${numero} : saisissez un montant positif lisible.`;
      return;
    }
    if (montant < 1) {
      erreurs.lignes = `Ligne ${numero} : le montant doit être supérieur à zéro (laissez vide pour ne rien prévoir).`;
      return;
    }
    const periode = lireEntier(l.periode, 1, RED_FINANCEMENT_PERIODES_MAX);
    if (periode === null || Number.isNaN(periode)) {
      erreurs.lignes = `Ligne ${numero} : choisissez une période.`;
      return;
    }
    if (typeof nombre === "number" && !Number.isNaN(nombre) && periode > nombre) {
      erreurs.lignes = `Ligne ${numero} : la période dépasse le nombre de périodes du plan.`;
      return;
    }
    if (!naturesDuSens(l.sens).includes(l.nature)) {
      erreurs.lignes = `Ligne ${numero} : choisissez une nature de ce sens.`;
      return;
    }
    const libelle = texteOuNull(l.libelle);
    if (libelle !== null && libelle.length > 200) {
      erreurs.lignes = `Ligne ${numero} : le libellé compte 200 caractères au plus.`;
      return;
    }
    lignes.push({
      periode,
      sens: l.sens,
      nature: l.nature,
      ...(libelle !== null ? { libelle } : {}),
      montant,
    });
  });
  if (lignes.length > RED_FINANCEMENT_LIGNES_MAX) {
    erreurs.lignes = `${RED_FINANCEMENT_LIGNES_MAX} lignes au plus par version.`;
  }
  const motif = texteOuNull(s.motif);
  if (motif !== null && motif.length > 500) erreurs.motif = MSG_MOTIF;
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      date_debut: s.date_debut,
      type_periode: s.type_periode,
      nombre_periodes: nombre as number,
      lignes,
      ...(motif !== null ? { motif } : {}),
    },
  };
}

/** Cadre de la proposition : seuls les champs lisibles du formulaire sont transmis à l'API. */
export function cadreProposition(s: SaisieFinancement): {
  date_debut?: string;
  type_periode?: string;
  nombre_periodes?: number;
} {
  const nombre = lireEntier(s.nombre_periodes, 1, RED_FINANCEMENT_PERIODES_MAX);
  return {
    ...(estPremierDuMois(s.date_debut) ? { date_debut: s.date_debut } : {}),
    ...((RED_FINANCEMENT_TYPES_PERIODE as readonly string[]).includes(s.type_periode)
      ? { type_periode: s.type_periode }
      : {}),
    ...(typeof nombre === "number" && !Number.isNaN(nombre) ? { nombre_periodes: nombre } : {}),
  };
}
