/** Redressement (saisie) : trésorerie (version, réalisé, point mort). */
import {
  RED_CATEGORIES_DECAISSEMENT,
  RED_CATEGORIES_ENCAISSEMENT,
  type RedPointMortEntree,
  type RedRealiseCreation,
  type RedSensFlux,
  type RedTresorerieVersionCreation,
  type RedTresorerieVersionVue,
} from "@missionpilot/shared";
import type { Devise } from "./format";
import { dateValide } from "./periode";
import { texteOuNull, type Resultat } from "./saisie";
import {
  type Erreurs,
  MSG_DATE,
  MSG_MONTANT,
  lireMontantRed,
  lireSolde,
  lireEntier,
  estLundi,
  prochainLundi,
} from "./redressement-saisie-base";

// --- Trésorerie : version, réalisé, point mort ------------------------------------------------------------

export interface SaisieLigneTresorerie {
  /** Clé d'affichage stable (jamais envoyée). */
  cle: string;
  sens: RedSensFlux;
  categorie: string;
  /** « 1 » à « 13 ». */
  semaine: string;
  libelle: string;
  /** Montant en unités usuelles. */
  montant: string;
  /** Ligne rattachée à l'échéance d'un accord (importée de la route 21) : non modifiable. */
  creancier_id: string | null;
  echeance_id: string | null;
}
export interface SaisieVersionTresorerie {
  date_debut: string;
  solde_initial: string;
  seuil_tension: string;
  motif: string;
  lignes: SaisieLigneTresorerie[];
}
export type ChampVersionTresorerie =
  "date_debut" | "solde_initial" | "seuil_tension" | "motif" | "lignes";

let compteurLignes = 0;
export const nouvelleCleLigne = () => `ligne-${++compteurLignes}`;

export function ligneVide(sens: RedSensFlux = "encaissement"): SaisieLigneTresorerie {
  return {
    cle: nouvelleCleLigne(),
    sens,
    categorie:
      sens === "encaissement" ? RED_CATEGORIES_ENCAISSEMENT[0] : RED_CATEGORIES_DECAISSEMENT[0],
    semaine: "1",
    libelle: "",
    montant: "",
    creancier_id: null,
    echeance_id: null,
  };
}

/** Usuel → saisie : « 1500000 » (XOF) ou « 1500,5 » (EUR). */
export function montantVersTexte(mineur: number, devise: Devise): string {
  const f = devise === "XOF" || devise === "XAF" ? 1 : 100;
  return String(mineur / f).replace(".", ",");
}

/** Formulaire d'une nouvelle version, préremplie depuis la version courante (ou vide, au lundi suivant). */
export function saisieVersionDepuis(
  version: RedTresorerieVersionVue | null,
  devise: Devise,
  aujourdhui: string,
): SaisieVersionTresorerie {
  if (version === null) {
    return {
      date_debut: prochainLundi(aujourdhui),
      solde_initial: "",
      seuil_tension: "0",
      motif: "",
      lignes: [],
    };
  }
  return {
    date_debut: version.date_debut,
    solde_initial: montantVersTexte(version.solde_initial, devise),
    seuil_tension: montantVersTexte(version.seuil_tension, devise),
    motif: "",
    lignes: version.lignes.map((l) => ({
      cle: nouvelleCleLigne(),
      sens: l.sens,
      categorie: l.categorie,
      semaine: String(l.semaine),
      libelle: l.libelle ?? "",
      montant: montantVersTexte(l.montant, devise),
      creancier_id: l.creancier_id,
      echeance_id: l.echeance_id,
    })),
  };
}

/**
 * Corps de la route 19. Une ligne dont le montant est vide est ignorée (case non renseignée) ;
 * un montant à zéro ou illisible est une erreur signalée avec le numéro de la ligne.
 */
export function corpsVersionDepuisFormulaire(
  s: SaisieVersionTresorerie,
  devise: Devise,
): Resultat<RedTresorerieVersionCreation, ChampVersionTresorerie> {
  const erreurs: Erreurs<ChampVersionTresorerie> = {};
  if (dateValide(s.date_debut) === null) erreurs.date_debut = MSG_DATE;
  else if (!estLundi(s.date_debut)) erreurs.date_debut = "Un lundi est attendu.";
  const soldeInitial = lireSolde(s.solde_initial, devise);
  if (soldeInitial === null) erreurs.solde_initial = "Saisissez le solde bancaire initial.";
  else if (Number.isNaN(soldeInitial)) erreurs.solde_initial = MSG_MONTANT(devise);
  const seuilTexte = s.seuil_tension.trim() === "" ? "0" : s.seuil_tension;
  const seuil = lireMontantRed(seuilTexte, devise);
  if (seuil === null || Number.isNaN(seuil)) erreurs.seuil_tension = MSG_MONTANT(devise);

  const lignes: RedTresorerieVersionCreation["lignes"] = [];
  s.lignes.forEach((l, i) => {
    if (erreurs.lignes) return;
    const numero = i + 1;
    if (l.montant.trim() === "") return;
    const montant = lireMontantRed(l.montant, devise);
    if (montant === null || Number.isNaN(montant)) {
      erreurs.lignes = `Ligne ${numero} : ${MSG_MONTANT(devise)}`;
      return;
    }
    if (montant < 1) {
      erreurs.lignes = `Ligne ${numero} : le montant doit être supérieur à zéro (laissez vide pour ne rien prévoir).`;
      return;
    }
    const semaine = lireEntier(l.semaine, 1, 13);
    if (semaine === null || Number.isNaN(semaine)) {
      erreurs.lignes = `Ligne ${numero} : choisissez une semaine de 1 à 13.`;
      return;
    }
    const liste: readonly string[] =
      l.sens === "encaissement" ? RED_CATEGORIES_ENCAISSEMENT : RED_CATEGORIES_DECAISSEMENT;
    if (!liste.includes(l.categorie)) {
      erreurs.lignes = `Ligne ${numero} : choisissez une catégorie de ce sens.`;
      return;
    }
    const libelle = texteOuNull(l.libelle);
    if (libelle !== null && libelle.length > 200) {
      erreurs.lignes = `Ligne ${numero} : le libellé compte 200 caractères au plus.`;
      return;
    }
    const ligne: RedTresorerieVersionCreation["lignes"][number] = {
      semaine,
      sens: l.sens,
      categorie: l.categorie,
      montant,
    };
    if (libelle !== null) ligne.libelle = libelle;
    if (l.creancier_id) ligne.creancier_id = l.creancier_id;
    if (l.echeance_id) ligne.echeance_id = l.echeance_id;
    lignes.push(ligne);
  });
  if (lignes.length > 600) erreurs.lignes = "600 lignes au plus par version.";
  const motif = texteOuNull(s.motif);
  if (motif !== null && motif.length > 500)
    erreurs.motif = "Le motif compte 500 caractères au plus.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const charge: RedTresorerieVersionCreation = {
    date_debut: s.date_debut,
    solde_initial: soldeInitial as number,
    seuil_tension: seuil as number,
    lignes,
  };
  if (motif !== null) charge.motif = motif;
  return { ok: true, charge };
}

export interface SaisieRealise {
  semaine_debut: string;
  encaissement: Record<string, string>;
  decaissement: Record<string, string>;
  /** Solde bancaire constaté en fin de semaine (facultatif). */
  solde_constate: string;
  commentaire: string;
}
export type ChampRealise =
  "semaine_debut" | "encaissement" | "decaissement" | "solde_constate" | "commentaire";

export const saisieRealiseVide = (semaineDebut = ""): SaisieRealise => ({
  semaine_debut: semaineDebut,
  encaissement: {},
  decaissement: {},
  solde_constate: "",
  commentaire: "",
});

/** Montants par catégorie : vides ignorés, décimale refusée selon la devise. */
function fluxDepuis(
  saisie: Record<string, string>,
  categories: readonly string[],
  devise: Devise,
): { flux: Record<string, number>; erreur: string | null } {
  const flux: Record<string, number> = {};
  for (const c of categories) {
    const t = saisie[c];
    if (t === undefined || t.trim() === "") continue;
    const m = lireMontantRed(t, devise);
    if (m === null || Number.isNaN(m)) return { flux, erreur: MSG_MONTANT(devise) };
    flux[c] = m;
  }
  return { flux, erreur: null };
}

/** Corps de la route 20 : flux regroupés par sens et catégorie (aucune somme n'est faite ici). */
export function corpsRealiseDepuisFormulaire(
  s: SaisieRealise,
  devise: Devise,
): Resultat<RedRealiseCreation, ChampRealise> {
  const erreurs: Erreurs<ChampRealise> = {};
  if (dateValide(s.semaine_debut) === null) erreurs.semaine_debut = MSG_DATE;
  else if (!estLundi(s.semaine_debut)) erreurs.semaine_debut = "Un lundi est attendu.";
  const enc = fluxDepuis(s.encaissement, RED_CATEGORIES_ENCAISSEMENT, devise);
  if (enc.erreur) erreurs.encaissement = enc.erreur;
  const dec = fluxDepuis(s.decaissement, RED_CATEGORIES_DECAISSEMENT, devise);
  if (dec.erreur) erreurs.decaissement = dec.erreur;
  const solde = lireSolde(s.solde_constate, devise);
  if (solde !== null && Number.isNaN(solde)) erreurs.solde_constate = MSG_MONTANT(devise);
  const commentaire = texteOuNull(s.commentaire);
  if (commentaire !== null && commentaire.length > 1000) {
    erreurs.commentaire = "Le commentaire compte 1 000 caractères au plus.";
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const flux: RedRealiseCreation["flux"] = {};
  if (Object.keys(enc.flux).length > 0) flux.encaissement = enc.flux;
  if (Object.keys(dec.flux).length > 0) flux.decaissement = dec.flux;
  const charge: RedRealiseCreation = { semaine_debut: s.semaine_debut, flux };
  if (solde !== null) charge.solde_constate = solde;
  if (commentaire !== null) charge.commentaire = commentaire;
  return { ok: true, charge };
}

export interface SaisiePointMort {
  chiffre_affaires: string;
  charges_variables: string;
  charges_fixes: string;
  periode_jours: string;
}
export type ChampPointMort = keyof SaisiePointMort;

export function corpsPointMortDepuisFormulaire(
  s: SaisiePointMort,
  devise: Devise,
): Resultat<RedPointMortEntree, ChampPointMort> {
  const erreurs: Erreurs<ChampPointMort> = {};
  const lire = (cle: Exclude<ChampPointMort, "periode_jours">): number => {
    const m = lireMontantRed(s[cle], devise);
    if (m === null) {
      erreurs[cle] = "Saisissez un montant.";
      return 0;
    }
    if (Number.isNaN(m)) {
      erreurs[cle] = MSG_MONTANT(devise);
      return 0;
    }
    return m;
  };
  const ca = lire("chiffre_affaires");
  const cv = lire("charges_variables");
  const cf = lire("charges_fixes");
  const periode = lireEntier(s.periode_jours, 1, 366);
  if (periode !== null && Number.isNaN(periode)) {
    erreurs.periode_jours = "La période est un nombre entier de jours, de 1 à 366.";
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const charge: RedPointMortEntree = {
    chiffre_affaires: ca,
    charges_variables: cv,
    charges_fixes: cf,
  };
  if (periode !== null) charge.periode_jours = periode;
  return { ok: true, charge };
}
