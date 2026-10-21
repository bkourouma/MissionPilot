/**
 * Redressement : de la saisie d'un formulaire au corps d'API (SPEC-3a §10.5). Conversions de
 * TEXTE en entier (montants, dates, codes), regroupements par catégorie et contrôles de forme avec
 * leurs messages en français. Aucun calcul métier : pas de somme de montants, pas de solde, pas
 * de ratio ; seule exception, `sommeDesPoids`, contrôle de saisie de l'éditeur de seuils (l'API
 * revalide). Logique pure, testée dans `redressement-saisie.test.ts`.
 */
import {
  RED_CATEGORIES_DECAISSEMENT,
  RED_CATEGORIES_ENCAISSEMENT,
  RED_CRITERES_ALERTE,
  RED_ECHEANCES_MAX,
  RED_MONTANT_MAX,
  RED_POSTES,
  RED_REPONSES_URGENCE,
  RED_DOMAINES,
  type RedActionCreation,
  type RedActionModification,
  type RedCategorieCreancier,
  type RedCorrespondanceCreation,
  type RedCreanceCreation,
  type RedCreancierCreation,
  type RedCritereAlerte,
  type RedDefinitionLevierVue,
  type RedDossierCreation,
  type RedSecteur,
  type RedDomaine,
  type RedEvenementNegociation,
  type RedImpactLevierVue,
  type RedPoste,
  type RedPostesVue,
  type RedPointMortEntree,
  type RedRealiseCreation,
  type RedReferentielVue,
  type RedReponseUrgence,
  type RedScoreCreation,
  type RedSeuils,
  type RedSeuilsCreation,
  type RedSensFlux,
  type RedTresorerieVersionCreation,
  type RedTresorerieVersionVue,
  type RedUrgenceCreation,
  type RedVolet,
} from "@missionpilot/shared";
import type { Devise } from "./format";
import { FORME_CRITERE } from "./redressement";
import { ajouterJoursIso } from "./kpi";
import { dateValide } from "./periode";
import { lireMontant, lireNombre, texteOuNull, type Resultat } from "./saisie";

type Erreurs<K extends string> = Partial<Record<K, string>>;

const MSG_DATE = "Date illisible : saisissez une date entre 2000 et 2100.";
const MSG_MONTANT = (devise: Devise) =>
  devise === "XOF" || devise === "XAF"
    ? "Montant illisible : saisissez un nombre entier, sans décimale (ex. 1 200 000)."
    : "Montant illisible : saisissez un nombre positif, avec deux décimales au plus (ex. 1 500,50).";

// --- Montants et dates ------------------------------------------------------------------------------

/**
 * Montant saisi (unités usuelles) → unités mineures. `null` si vide, `NaN` si illisible, négatif,
 * trop précis pour la devise ou au-delà du plafond de l'API.
 */
export function lireMontantRed(v: string, devise: Devise): number | null {
  const m = lireMontant(v, devise);
  if (m === null) return null;
  return Number.isNaN(m) || m > RED_MONTANT_MAX ? Number.NaN : m;
}

/** Solde saisi : comme un montant, mais négatif admis (« -250 000 », « −250 000 »). */
export function lireSolde(v: string, devise: Devise): number | null {
  const t = v.trim();
  if (t === "") return null;
  const negatif = /^[-−]/.test(t);
  const m = lireMontantRed(negatif ? t.slice(1) : t, devise);
  if (m === null || Number.isNaN(m)) return Number.NaN;
  return negatif && m !== 0 ? -m : m;
}

/** Entier saisi (texte) : `null` si vide, `NaN` si illisible, décimal ou hors bornes. */
export function lireEntier(v: string, min: number, max: number): number | null {
  const n = lireNombre(v);
  if (n === null) return null;
  if (Number.isNaN(n) || !Number.isInteger(n) || n < min || n > max) return Number.NaN;
  return n;
}

/** Jour de semaine UTC = lundi (les semaines de la trésorerie commencent un lundi). */
export function estLundi(date: string): boolean {
  return new Date(`${date}T00:00:00Z`).getUTCDay() === 1;
}

/** Premier lundi strictement après la date donnée (valeur de départ d'une première version). */
export function prochainLundi(date: string): string {
  const jour = new Date(`${date}T00:00:00Z`).getUTCDay();
  return ajouterJoursIso(date, (8 - jour) % 7 || 7);
}

// --- Codes de lignes (correspondance de postes) -------------------------------------------------------

const FORMAT_CODE = /^[A-Za-z0-9_.-]{1,40}$/;
export const CODES_PAR_POSTE_MAX = 50;

/**
 * « BB, bi » → ["BB", "BI"] : séparateurs virgule, point-virgule ou espace ; vides et doublons
 * écartés. Un code retrouvé (sans tenir compte de la casse) dans `connus` prend l'écriture de
 * l'état du client ; sinon il est mis en majuscules (convention des références SYSCOHADA).
 */
export function parserCodes(texte: string, connus: readonly string[] = []): string[] {
  const parCasse = new Map(connus.map((c) => [c.toUpperCase(), c]));
  const sortie: string[] = [];
  const vus = new Set<string>();
  for (const brut of texte.split(/[,;\s]+/)) {
    const t = brut.trim();
    if (t === "") continue;
    const code = parCasse.get(t.toUpperCase()) ?? t.toUpperCase();
    if (vus.has(code)) continue;
    vus.add(code);
    sortie.push(code);
  }
  return sortie;
}

// --- Correspondance de postes ------------------------------------------------------------------------

export interface SaisiePoste {
  /** Codes séparés par des virgules. */
  codes: string;
  sans_objet: boolean;
}
export type SaisieCorrespondance = Record<RedPoste, SaisiePoste>;
export type ChampCorrespondance = "postes" | "motif" | `poste.${RedPoste}`;

/** Formulaire depuis une correspondance (courante ou indicative) : un champ par poste. */
export function saisieCorrespondanceDepuis(
  postes: RedPostesVue | null | undefined,
): SaisieCorrespondance {
  const saisie = {} as SaisieCorrespondance;
  for (const p of RED_POSTES) {
    const a = postes?.[p];
    saisie[p] = { codes: a ? a.codes.join(", ") : "", sans_objet: a?.sans_objet ?? false };
  }
  return saisie;
}

/** Postes sans code et non « Sans objet » : omis (ils restent « à renseigner », jamais zéro). */
export function corpsCorrespondanceDepuisFormulaire(
  saisie: SaisieCorrespondance,
  motif: string,
  connus: readonly string[] = [],
): Resultat<RedCorrespondanceCreation, ChampCorrespondance> {
  const erreurs: Erreurs<ChampCorrespondance> = {};
  const postes: RedCorrespondanceCreation["postes"] = {};
  for (const p of RED_POSTES) {
    const s = saisie[p];
    const codes = parserCodes(s.codes, connus);
    if (s.sans_objet) {
      if (codes.length > 0) erreurs[`poste.${p}`] = "Un poste sans objet ne porte aucun code.";
      else postes[p] = { codes: [], sans_objet: true };
      continue;
    }
    if (codes.length === 0) continue;
    if (codes.length > CODES_PAR_POSTE_MAX) {
      erreurs[`poste.${p}`] = `Cinquante codes au plus par poste (${codes.length} saisis).`;
    } else if (codes.some((c) => !FORMAT_CODE.test(c))) {
      erreurs[`poste.${p}`] =
        "Un code ne contient que des lettres, des chiffres, « . », « _ » ou « - » (40 caractères au plus).";
    } else {
      postes[p] = { codes, sans_objet: false };
    }
  }
  if (Object.keys(postes).length === 0 && Object.keys(erreurs).length === 0) {
    erreurs.postes = "Renseignez au moins un poste : des codes de lignes, ou « Sans objet ».";
  }
  const m = texteOuNull(motif);
  if (m !== null && m.length > 500) erreurs.motif = "Le motif compte 500 caractères au plus.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: m === null ? { postes } : { postes, motif: m } };
}

// --- Urgence -------------------------------------------------------------------------------------------

export type GrilleUrgence = RedReferentielVue["grille_urgence"];

export interface GroupeQuestions {
  domaine: RedDomaine;
  questions: GrilleUrgence;
}

/** Questions regroupées par domaine, dans l'ordre des domaines (un `fieldset` par groupe). */
export function grouperQuestions(grille: GrilleUrgence): GroupeQuestions[] {
  return RED_DOMAINES.map((domaine) => ({
    domaine,
    questions: grille.filter((q) => q.domaine === domaine),
  })).filter((g) => g.questions.length > 0);
}

export function compterReponses(reponses: Readonly<Record<string, string | undefined>>): number {
  return Object.values(reponses).filter((r) => r !== undefined && r !== "").length;
}

/** « 12 questions sur 15 renseignées » (annoncé poliment). */
export function libelleCompteur(repondues: number, total: number): string {
  const s = repondues > 1 ? "s" : "";
  return `${repondues} question${s} sur ${total} renseignée${s}`;
}

export type ChampUrgence = "reponses" | "commentaire";

/** Corps de la route 12 : les seules questions renseignées ; la durée est celle passée sur la page. */
export function corpsUrgenceDepuisFormulaire(
  reponses: Readonly<Record<string, RedReponseUrgence | undefined>>,
  dureeSecondes: number | null,
  commentaire: string,
  grille: GrilleUrgence,
): Resultat<RedUrgenceCreation, ChampUrgence> {
  const erreurs: Erreurs<ChampUrgence> = {};
  const codes = new Set(grille.map((q) => q.code));
  const choisies: Record<string, RedReponseUrgence> = {};
  for (const [code, r] of Object.entries(reponses)) {
    if (r === undefined || !codes.has(code)) continue;
    if (!(RED_REPONSES_URGENCE as readonly string[]).includes(r)) continue;
    choisies[code] = r;
  }
  if (Object.keys(choisies).length === 0) {
    erreurs.reponses = "Répondez à au moins une question pour lancer l'évaluation.";
  }
  const c = texteOuNull(commentaire);
  if (c !== null && c.length > 2000)
    erreurs.commentaire = "Le commentaire compte 2 000 caractères au plus.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const charge: RedUrgenceCreation = { reponses: choisies };
  if (dureeSecondes !== null && Number.isFinite(dureeSecondes)) {
    charge.duree_secondes = Math.min(86_400, Math.max(0, Math.floor(dureeSecondes)));
  }
  if (c !== null) charge.commentaire = c;
  return { ok: true, charge };
}

// --- Incidents de paiement (score d'alerte) -------------------------------------------------------------

export type ReponseTernaire = "oui" | "non" | "inconnu";
export interface SaisieIncidents {
  /** Vide : inconnu. */
  rejets: string;
  /** Vide : inconnu. */
  retards: string;
  arrieres: ReponseTernaire;
}
export type ChampIncidents = "rejets" | "retards";

export function saisieIncidentsDepuis(
  incidents:
    | {
        rejets_bancaires_12m: number | null;
        retards_fournisseurs_90j: number | null;
        arrieres_fiscaux_sociaux: boolean | null;
      }
    | null
    | undefined,
): SaisieIncidents {
  return {
    rejets: incidents?.rejets_bancaires_12m != null ? String(incidents.rejets_bancaires_12m) : "",
    retards:
      incidents?.retards_fournisseurs_90j != null ? String(incidents.retards_fournisseurs_90j) : "",
    arrieres:
      incidents?.arrieres_fiscaux_sociaux == null
        ? "inconnu"
        : incidents.arrieres_fiscaux_sociaux
          ? "oui"
          : "non",
  };
}

export function corpsScoreDepuisFormulaire(
  s: SaisieIncidents,
): Resultat<RedScoreCreation, ChampIncidents> {
  const erreurs: Erreurs<ChampIncidents> = {};
  const rejets = lireEntier(s.rejets, 0, 999);
  const retards = lireEntier(s.retards, 0, 999);
  if (rejets !== null && Number.isNaN(rejets))
    erreurs.rejets = "Saisissez un nombre entier de 0 à 999.";
  if (retards !== null && Number.isNaN(retards))
    erreurs.retards = "Saisissez un nombre entier de 0 à 999.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      incidents: {
        rejets_bancaires_12m: rejets,
        retards_fournisseurs_90j: retards,
        arrieres_fiscaux_sociaux: s.arrieres === "inconnu" ? null : s.arrieres === "oui",
      },
    },
  };
}

// --- Seuils d'alerte (par secteur) ---------------------------------------------------------------------------

/** Facteur entre la valeur saisie et la valeur de l'API : rapport ×10 000, pourcentage ×100. */
export function facteurCritere(critere: RedCritereAlerte): number {
  const forme = FORME_CRITERE[critere];
  if (forme === "ratio") return 10_000;
  if (forme === "pourcentage" || forme === "points") return 100;
  return 1;
}

export interface SaisieSeuilCritere {
  orange: string;
  rouge: string;
  poids: string;
}
export interface SaisieSeuils {
  criteres: Record<RedCritereAlerte, SaisieSeuilCritere>;
  niveaux: { modere: string; eleve: string; critique: string };
  part_minimale_evaluee_pct: string;
  motif: string;
}
export type ChampSeuils =
  "poids" | "niveaux" | "part" | "motif" | `${RedCritereAlerte}.${"orange" | "rouge" | "poids"}`;

/** Valeur de l'API → texte d'un champ (« 12000 » → « 1,2 » pour un rapport). */
export function valeurVersSaisie(critere: RedCritereAlerte, valeur: number): string {
  const f = facteurCritere(critere);
  return String(f === 1 ? valeur : valeur / f).replace(".", ",");
}

export function saisieSeuilsDepuis(seuils: RedSeuils): SaisieSeuils {
  const criteres = {} as SaisieSeuils["criteres"];
  for (const c of RED_CRITERES_ALERTE) {
    const s = seuils.criteres[c];
    criteres[c] = {
      orange: valeurVersSaisie(c, s.orange),
      rouge: valeurVersSaisie(c, s.rouge),
      poids: String(s.poids),
    };
  }
  return {
    criteres,
    niveaux: {
      modere: String(seuils.niveaux.modere),
      eleve: String(seuils.niveaux.eleve),
      critique: String(seuils.niveaux.critique),
    },
    part_minimale_evaluee_pct: String(seuils.part_minimale_evaluee_pct),
    motif: "",
  };
}

/** Texte saisi → valeur de l'API (entier) ; `NaN` si illisible ou trop précis. */
function lireValeurCritere(critere: RedCritereAlerte, texte: string): number {
  const n = lireNombre(texte);
  if (n === null || Number.isNaN(n)) return Number.NaN;
  const brut = n * facteurCritere(critere);
  const entier = Math.round(brut);
  if (Math.abs(brut - entier) > 1e-6 || Math.abs(entier) > 1_000_000) return Number.NaN;
  return entier;
}

/**
 * Contrôle de saisie : somme des poids saisis (entiers lisibles). Le moteur impose 100 ; ce
 * total n'alimente aucun résultat, il évite seulement un aller-retour inutile.
 */
export function sommeDesPoids(criteres: Record<RedCritereAlerte, { poids: string }>): number {
  let somme = 0;
  for (const c of RED_CRITERES_ALERTE) {
    const n = lireEntier(criteres[c].poids, 0, 1000);
    if (n !== null && !Number.isNaN(n)) somme += n;
  }
  return somme;
}

export function corpsSeuilsDepuisFormulaire(
  secteur: RedSeuilsCreation["secteur"],
  s: SaisieSeuils,
): Resultat<RedSeuilsCreation, ChampSeuils> {
  const erreurs: Erreurs<ChampSeuils> = {};
  const criteres = {} as RedSeuils["criteres"];
  for (const c of RED_CRITERES_ALERTE) {
    const orange = lireValeurCritere(c, s.criteres[c].orange);
    const rouge = lireValeurCritere(c, s.criteres[c].rouge);
    const poids = lireEntier(s.criteres[c].poids, 0, 1000);
    if (Number.isNaN(orange)) erreurs[`${c}.orange`] = "Valeur illisible.";
    if (Number.isNaN(rouge)) erreurs[`${c}.rouge`] = "Valeur illisible.";
    if (poids === null || Number.isNaN(poids))
      erreurs[`${c}.poids`] = "Poids : entier de 0 à 1 000.";
    criteres[c] = { orange, rouge, poids: poids ?? Number.NaN };
  }
  const modere = lireEntier(s.niveaux.modere, 0, 100);
  const eleve = lireEntier(s.niveaux.eleve, 0, 100);
  const critique = lireEntier(s.niveaux.critique, 0, 100);
  if ([modere, eleve, critique].some((n) => n === null || Number.isNaN(n))) {
    erreurs.niveaux = "Les trois niveaux sont des entiers de 0 à 100.";
  }
  const part = lireEntier(s.part_minimale_evaluee_pct, 0, 100);
  if (part === null || Number.isNaN(part)) erreurs.part = "Part minimale : entier de 0 à 100.";
  if (!erreurs.poids && Object.keys(erreurs).every((k) => !k.endsWith(".poids"))) {
    const somme = sommeDesPoids(s.criteres);
    if (somme !== 100) {
      erreurs.poids = `La somme des poids doit être égale à 100 (actuellement ${somme}).`;
    }
  }
  const motif = texteOuNull(s.motif);
  if (motif !== null && motif.length > 500)
    erreurs.motif = "Le motif compte 500 caractères au plus.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const charge: RedSeuilsCreation = {
    secteur,
    seuils: {
      criteres,
      niveaux: { modere: modere as number, eleve: eleve as number, critique: critique as number },
      part_minimale_evaluee_pct: part as number,
    },
  };
  if (motif !== null) charge.motif = motif;
  return { ok: true, charge };
}

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

// --- Créanciers -------------------------------------------------------------------------------------------

export interface SaisieCreancier {
  nom: string;
  categorie: RedCategorieCreancier;
  garanti: boolean;
  reference: string;
  principal: string;
  interets: string;
  date_arrete: string;
  echeance_initiale: string;
  nature: string;
}
export type ChampCreancier = keyof SaisieCreancier;

function lireCreance(
  s: Pick<
    SaisieCreancier,
    "principal" | "interets" | "date_arrete" | "echeance_initiale" | "nature"
  >,
  devise: Devise,
  erreurs: Erreurs<ChampCreancier>,
): {
  principal: number;
  interets: number;
  date_arrete: string;
  echeance_initiale: string | null;
  nature: string | null;
} {
  const principal = lireMontantRed(s.principal, devise);
  if (principal === null) erreurs.principal = "Saisissez le montant principal.";
  else if (Number.isNaN(principal)) erreurs.principal = MSG_MONTANT(devise);
  const interets = s.interets.trim() === "" ? 0 : lireMontantRed(s.interets, devise);
  if (interets === null || Number.isNaN(interets)) erreurs.interets = MSG_MONTANT(devise);
  if (dateValide(s.date_arrete) === null) erreurs.date_arrete = MSG_DATE;
  const echeance = texteOuNull(s.echeance_initiale);
  if (echeance !== null && dateValide(echeance) === null) erreurs.echeance_initiale = MSG_DATE;
  const nature = texteOuNull(s.nature);
  if (nature !== null && nature.length > 200)
    erreurs.nature = "La nature compte 200 caractères au plus.";
  return {
    principal: principal ?? 0,
    interets: interets ?? 0,
    date_arrete: s.date_arrete,
    echeance_initiale: echeance,
    nature,
  };
}

export function corpsCreancierDepuisFormulaire(
  s: SaisieCreancier,
  devise: Devise,
): Resultat<RedCreancierCreation, ChampCreancier> {
  const erreurs: Erreurs<ChampCreancier> = {};
  const nom = s.nom.trim();
  if (nom === "") erreurs.nom = "Saisissez le nom du créancier.";
  else if (nom.length > 200) erreurs.nom = "Le nom compte 200 caractères au plus.";
  const reference = texteOuNull(s.reference);
  if (reference !== null && reference.length > 120) {
    erreurs.reference = "La référence compte 120 caractères au plus.";
  }
  const c = lireCreance(s, devise, erreurs);
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const charge: RedCreancierCreation = {
    nom,
    categorie: s.categorie,
    garanti: s.garanti,
    principal: c.principal,
    interets: c.interets,
    date_arrete: c.date_arrete,
  };
  if (reference !== null) charge.reference = reference;
  if (c.echeance_initiale !== null) charge.echeance_initiale = c.echeance_initiale;
  if (c.nature !== null) charge.nature = c.nature;
  return { ok: true, charge };
}

export interface SaisieCreance {
  principal: string;
  interets: string;
  date_arrete: string;
  echeance_initiale: string;
  nature: string;
  commentaire: string;
}
export type ChampCreance = keyof SaisieCreance;

export function corpsCreanceDepuisFormulaire(
  s: SaisieCreance,
  devise: Devise,
): Resultat<RedCreanceCreation, ChampCreance> {
  const erreurs: Erreurs<ChampCreancier> = {};
  const c = lireCreance(s, devise, erreurs);
  const commentaire = texteOuNull(s.commentaire);
  const e: Erreurs<ChampCreance> = { ...erreurs };
  if (commentaire !== null && commentaire.length > 1000) {
    e.commentaire = "Le commentaire compte 1 000 caractères au plus.";
  }
  if (Object.keys(e).length > 0) return { ok: false, erreurs: e };
  const charge: RedCreanceCreation = {
    principal: c.principal,
    interets: c.interets,
    date_arrete: c.date_arrete,
  };
  if (c.echeance_initiale !== null) charge.echeance_initiale = c.echeance_initiale;
  if (c.nature !== null) charge.nature = c.nature;
  if (commentaire !== null) charge.commentaire = commentaire;
  return { ok: true, charge };
}

export interface SaisieLigneEcheance {
  cle: string;
  date: string;
  montant: string;
}
export interface SaisieEvenement {
  type: RedEvenementNegociation["type"];
  date_evenement: string;
  montant: string;
  conditions: string;
  accord_id: string;
  /** « » : paiement non rattaché à une échéance. */
  echeance_rang: string;
  mode: "regulier" | "explicite";
  nombre_echeances: string;
  date_premiere: string;
  periodicite_mois: string;
  lignes: SaisieLigneEcheance[];
}
export type ChampEvenement =
  | "date_evenement"
  | "montant"
  | "conditions"
  | "accord_id"
  | "echeance_rang"
  | "nombre_echeances"
  | "date_premiere"
  | "periodicite_mois"
  | "lignes";

export const evenementVide = (aujourdhui: string, accordId = ""): SaisieEvenement => ({
  type: "note",
  date_evenement: aujourdhui,
  montant: "",
  conditions: "",
  accord_id: accordId,
  echeance_rang: "",
  mode: "regulier",
  nombre_echeances: "12",
  date_premiere: aujourdhui,
  periodicite_mois: "1",
  lignes: [],
});

/** Corps de la route 28 selon le type d'événement ; l'imputation des paiements est celle de l'API. */
export function corpsEvenementDepuisFormulaire(
  s: SaisieEvenement,
  devise: Devise,
): Resultat<RedEvenementNegociation, ChampEvenement> {
  const erreurs: Erreurs<ChampEvenement> = {};
  if (dateValide(s.date_evenement) === null) erreurs.date_evenement = MSG_DATE;
  const conditions = texteOuNull(s.conditions);
  if (conditions !== null && conditions.length > 2000) {
    erreurs.conditions = "Les conditions comptent 2 000 caractères au plus.";
  }
  const montantTexte = s.montant;
  const montant = lireMontantRed(montantTexte, devise);
  if (montant !== null && Number.isNaN(montant)) erreurs.montant = MSG_MONTANT(devise);
  const positif = () => {
    if (montant === null) erreurs.montant = "Saisissez le montant.";
    else if (!Number.isNaN(montant) && montant < 1)
      erreurs.montant = "Le montant doit être supérieur à zéro.";
  };

  if (s.type === "accord") {
    positif();
    let echeancier: Extract<RedEvenementNegociation, { type: "accord" }>["echeancier"] | null =
      null;
    if (s.mode === "regulier") {
      const n = lireEntier(s.nombre_echeances, 1, RED_ECHEANCES_MAX);
      if (n === null || Number.isNaN(n)) {
        erreurs.nombre_echeances = `Nombre d'échéances : entier de 1 à ${RED_ECHEANCES_MAX}.`;
      }
      if (dateValide(s.date_premiere) === null) erreurs.date_premiere = MSG_DATE;
      const p = lireEntier(s.periodicite_mois, 1, 12);
      if (p === null || Number.isNaN(p))
        erreurs.periodicite_mois = "Périodicité : entier de 1 à 12 mois.";
      if (!erreurs.nombre_echeances && !erreurs.date_premiere && !erreurs.periodicite_mois) {
        echeancier = {
          mode: "regulier",
          nombre_echeances: n as number,
          date_premiere: s.date_premiere,
          periodicite_mois: p as number,
        };
      }
    } else {
      const lignes: { date: string; montant: number }[] = [];
      if (s.lignes.length === 0) erreurs.lignes = "Ajoutez au moins une échéance.";
      else if (s.lignes.length > RED_ECHEANCES_MAX) {
        erreurs.lignes = `${RED_ECHEANCES_MAX} échéances au plus.`;
      }
      s.lignes.forEach((l, i) => {
        if (erreurs.lignes) return;
        if (dateValide(l.date) === null) {
          erreurs.lignes = `Échéance ${i + 1} : ${MSG_DATE}`;
          return;
        }
        const m = lireMontantRed(l.montant, devise);
        if (m === null || Number.isNaN(m) || m < 1) {
          erreurs.lignes = `Échéance ${i + 1} : saisissez un montant supérieur à zéro.`;
          return;
        }
        lignes.push({ date: l.date, montant: m });
      });
      if (!erreurs.lignes) echeancier = { mode: "explicite", lignes };
    }
    if (Object.keys(erreurs).length > 0 || echeancier === null || montant === null) {
      return { ok: false, erreurs };
    }
    const charge: RedEvenementNegociation = {
      type: "accord",
      date_evenement: s.date_evenement,
      montant,
      echeancier,
    };
    if (conditions !== null) charge.conditions = conditions;
    return { ok: true, charge };
  }

  if (s.type === "paiement") {
    positif();
    if (s.accord_id === "")
      erreurs.accord_id = "Aucun accord en vigueur : enregistrez d'abord un accord.";
    const rang =
      s.echeance_rang.trim() === "" ? null : lireEntier(s.echeance_rang, 1, RED_ECHEANCES_MAX);
    if (rang !== null && Number.isNaN(rang))
      erreurs.echeance_rang = "Choisissez une échéance de la liste.";
    if (Object.keys(erreurs).length > 0 || montant === null) return { ok: false, erreurs };
    const charge: RedEvenementNegociation = {
      type: "paiement",
      date_evenement: s.date_evenement,
      montant: montant as number,
      accord_id: s.accord_id,
    };
    if (rang !== null) charge.echeance_rang = rang;
    return { ok: true, charge };
  }

  if (s.type === "rupture") {
    if (s.accord_id === "") erreurs.accord_id = "Aucun accord en vigueur à rompre.";
    if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
    const charge: RedEvenementNegociation = {
      type: "rupture",
      date_evenement: s.date_evenement,
      accord_id: s.accord_id,
    };
    if (conditions !== null) charge.conditions = conditions;
    return { ok: true, charge };
  }

  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const charge = {
    type: s.type,
    date_evenement: s.date_evenement,
    ...(montant !== null ? { montant } : {}),
    ...(conditions !== null ? { conditions } : {}),
  } as RedEvenementNegociation;
  return { ok: true, charge };
}

const FORMAT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Corps de l'annulation d'un paiement : l'événement vise le paiement par son identifiant. */
export function corpsAnnulationPaiement(
  paiementId: string,
  dateEvenement: string,
): Resultat<
  Extract<RedEvenementNegociation, { type: "annulation_paiement" }>,
  "paiement_annule_id" | "date_evenement"
> {
  const erreurs: Erreurs<"paiement_annule_id" | "date_evenement"> = {};
  if (!FORMAT_UUID.test(paiementId)) erreurs.paiement_annule_id = "Paiement à annuler inconnu.";
  if (dateValide(dateEvenement) === null) erreurs.date_evenement = MSG_DATE;
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      type: "annulation_paiement",
      date_evenement: dateEvenement,
      paiement_annule_id: paiementId,
    },
  };
}

// --- Plan : actions et leviers ---------------------------------------------------------------------------------

export interface SaisieAction {
  titre: string;
  description: string;
  volet: RedVolet;
  domaine: RedDomaine;
  echeance: string;
  responsable_id: string;
  /** « » : aucun levier. */
  levier_code: string;
  parametres: Record<string, string>;
  creer_tache: boolean;
}
export type ChampAction =
  "titre" | "description" | "echeance" | "responsable_id" | "levier" | "parametres";

type DefinitionParametres = Pick<RedDefinitionLevierVue, "parametres">;

/** Paramètres saisis → entiers (montants en unités mineures de la devise, le reste tel quel). */
export function parametresDepuisSaisie(
  definition: DefinitionParametres,
  saisie: Readonly<Record<string, string>>,
  devise: Devise,
): { parametres: Record<string, number>; erreur: string | null } {
  const parametres: Record<string, number> = {};
  for (const p of definition.parametres) {
    const texte = saisie[p.cle] ?? "";
    if (texte.trim() === "") return { parametres, erreur: `Renseignez « ${p.libelle} ».` };
    const valeur =
      p.unite === "montant" ? lireMontantRed(texte, devise) : lireEntier(texte, p.min, p.max);
    if (valeur === null || Number.isNaN(valeur)) {
      return {
        parametres,
        erreur:
          p.unite === "montant"
            ? `« ${p.libelle} » : ${MSG_MONTANT(devise)}`
            : `« ${p.libelle} » : saisissez un entier entre ${p.min} et ${p.max}.`,
      };
    }
    parametres[p.cle] = valeur;
  }
  return { parametres, erreur: null };
}

/** Valeur d'un paramètre de l'API → texte du champ. */
export function parametresVersSaisie(
  definition: DefinitionParametres,
  parametres: Readonly<Record<string, number>>,
  devise: Devise,
): Record<string, string> {
  const sortie: Record<string, string> = {};
  for (const p of definition.parametres) {
    const v = parametres[p.cle];
    if (v === undefined) continue;
    sortie[p.cle] = p.unite === "montant" ? montantVersTexte(v, devise) : String(v);
  }
  return sortie;
}

/** Corps de création (route 30) ou de modification (route 31) d'une action. */
export function corpsActionDepuisFormulaire(
  s: SaisieAction,
  devise: Devise,
  definitions: readonly RedDefinitionLevierVue[],
  mode: "creation",
): Resultat<RedActionCreation, ChampAction>;
export function corpsActionDepuisFormulaire(
  s: SaisieAction,
  devise: Devise,
  definitions: readonly RedDefinitionLevierVue[],
  mode: "modification",
): Resultat<RedActionModification, ChampAction>;
export function corpsActionDepuisFormulaire(
  s: SaisieAction,
  devise: Devise,
  definitions: readonly RedDefinitionLevierVue[],
  mode: "creation" | "modification",
): Resultat<RedActionCreation | RedActionModification, ChampAction> {
  const erreurs: Erreurs<ChampAction> = {};
  const titre = s.titre.trim();
  if (titre === "") erreurs.titre = "Saisissez le titre de l'action.";
  else if (titre.length > 200) erreurs.titre = "Le titre compte 200 caractères au plus.";
  const description = texteOuNull(s.description);
  if (description !== null && description.length > 2000) {
    erreurs.description = "La description compte 2 000 caractères au plus.";
  }
  if (dateValide(s.echeance) === null) erreurs.echeance = MSG_DATE;
  if (s.responsable_id === "") erreurs.responsable_id = "Choisissez le responsable.";
  let levier: NonNullable<RedActionCreation["levier"]> | null = null;
  if (s.levier_code !== "") {
    const definition = definitions.find((d) => d.code === s.levier_code);
    if (!definition) erreurs.levier = "Levier inconnu : rechargez la page.";
    else {
      const p = parametresDepuisSaisie(definition, s.parametres, devise);
      if (p.erreur) erreurs.parametres = p.erreur;
      else levier = { code: definition.code, parametres: p.parametres };
    }
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  if (mode === "creation") {
    const charge: RedActionCreation = {
      titre,
      volet: s.volet,
      domaine: s.domaine,
      echeance: s.echeance,
      responsable_id: s.responsable_id,
      creer_tache: s.creer_tache,
    };
    if (description !== null) charge.description = description;
    if (levier !== null) charge.levier = levier;
    return { ok: true, charge };
  }
  const charge: RedActionModification = {
    titre,
    volet: s.volet,
    domaine: s.domaine,
    echeance: s.echeance,
    responsable_id: s.responsable_id,
    levier,
  };
  if (description !== null) charge.description = description;
  return { ok: true, charge };
}

/** Corps de la route 37 : le levier et ses paramètres. */
export function corpsSimulationDepuisFormulaire(
  definition: RedDefinitionLevierVue | undefined,
  saisie: Readonly<Record<string, string>>,
  devise: Devise,
): Resultat<
  { code: RedDefinitionLevierVue["code"]; parametres: Record<string, number> },
  "levier" | "parametres"
> {
  if (!definition) return { ok: false, erreurs: { levier: "Choisissez un levier." } };
  const p = parametresDepuisSaisie(definition, saisie, devise);
  if (p.erreur) return { ok: false, erreurs: { parametres: p.erreur } };
  return { ok: true, charge: { code: definition.code, parametres: p.parametres } };
}

/** Résumé d'impact pour l'affichage (« Plus ou moins-value » seulement pour une cession). */
export const aPlusOuMoinsValue = (impact: Pick<RedImpactLevierVue, "plus_ou_moins_value">) =>
  impact.plus_ou_moins_value !== null;

// --- Dossier --------------------------------------------------------------------------------------------------

export interface SaisieDossier {
  intitule: string;
  secteur: RedSecteur;
}
export type ChampDossier = "intitule";

export function corpsDossierDepuisFormulaire(
  s: SaisieDossier,
): Resultat<RedDossierCreation, ChampDossier> {
  const intitule = s.intitule.trim();
  if (intitule === "")
    return { ok: false, erreurs: { intitule: "Saisissez l'intitulé du dossier." } };
  if (intitule.length > 200) {
    return { ok: false, erreurs: { intitule: "L'intitulé compte 200 caractères au plus." } };
  }
  return { ok: true, charge: { intitule, secteur: s.secteur } };
}

export type ChampStatutDossier = "motif";

/** Clôture : un motif d'au moins 10 caractères est exigé (l'API revalide). */
export function corpsCloture(
  motif: string,
): Resultat<{ statut: "clos"; motif: string }, ChampStatutDossier> {
  const m = motif.trim();
  if (m.length < 10) {
    return {
      ok: false,
      erreurs: { motif: "Un motif d'au moins 10 caractères est exigé pour clore le dossier." },
    };
  }
  if (m.length > 1000) {
    return { ok: false, erreurs: { motif: "Le motif compte 1 000 caractères au plus." } };
  }
  return { ok: true, charge: { statut: "clos", motif: m } };
}
