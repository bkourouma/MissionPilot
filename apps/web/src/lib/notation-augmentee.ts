import {
  aPermission,
  PUBLICS_ITEM_NOTATION,
  REPONDANTS_CIBLE_PLANCHER,
  SEUIL_CONFIANCE_PLANCHER,
  type ItemBanqueDonnees,
  type PublicItemNotation,
  type Role,
} from "@missionpilot/shared";
import { ErreurApi } from "./api";
import { estExpertPublieur, messageNotation, type Classe, type TonaliteNotation } from "./notation";
import { codeDepuisTitre } from "./notation-grilles";
import { lireNombre, type Resultat } from "./saisie";

/*
 * Notation augmentée (PRD complémentaire §11.1) côté interface : types des réponses de l'API,
 * chemins, libellés et lecture des paramètres d'URL. Aucun chiffre n'est calculé ici : indice
 * de confiance, contributions, simulation, mesures de calibration et priorités viennent de
 * l'API (moteurs). Les fonctions ne font que présenter.
 */

const segment = encodeURIComponent;

export type NiveauConfiance = "elevee" | "suffisante" | "insuffisante";

export interface ConfianceNotation {
  numero: number;
  statut: string;
  indice: number;
  seuil: number;
  publiable: boolean;
  niveau: NiveauConfiance;
  couverture: { valeur: number; poids: number };
  repondants: { valeur: number; poids: number; nombre: number; cible: number };
  preuves: {
    valeur: number;
    poids: number;
    dimensions_etayees: number;
    dimensions: number;
    assertions: number;
  };
}

export interface ConstatPerception {
  question: string;
  libelle: string;
  type: "entre_populations" | "interne";
  gravite: "majeur" | "notable";
  ecart: number;
  niveau_bas: number;
  niveau_haut: number;
  populations_basses: string[];
  populations_hautes: string[];
  nombre_repondants: number;
  enonce: string;
}

export interface ConstatsNotation {
  numero: number;
  statut: string;
  constats: ConstatPerception[];
}

export interface ContributionPratique {
  indicateur: string;
  question: string;
  statut: "repondu" | "manquant" | "sans_objet";
  points: number | null;
  poids: number;
  contribution: number;
}

export interface ContributionDimension {
  dimension: string;
  libelle: string;
  notable: boolean;
  poids: number;
  score: number | null;
  contribution: number;
  ajustement: number;
  ecart_arrondi: number;
  pratiques: ContributionPratique[];
}

export interface EtapeSimulation {
  dimension: string;
  libelle: string;
  indicateur: string;
  question: string;
  points_avant: number;
  points_apres: number;
  paliers: number;
  gain: number;
}

export interface SimulationPassage {
  classe_actuelle: Classe;
  score_actuel: number;
  cible: Classe;
  seuil: number;
  deja_atteinte: boolean;
  atteignable: boolean;
  gain_necessaire: number;
  score_projete: number;
  classe_projetee: Classe;
  /** Vrai si le plafond de pas a interrompu la simulation avant la cible. */
  tronquee?: boolean;
  etapes: EtapeSimulation[];
}

export interface ExplicationNotation {
  numero: number;
  statut: string;
  score: number;
  classe: Classe;
  strategie: "ignorer" | "penaliser";
  somme_contributions: number;
  dimensions: ContributionDimension[];
  simulation: SimulationPassage | null;
}

export type SourceImpact = "contexte_semblable" | "secteur" | "taille" | "general" | "aucun";

export interface InitiativePriorisee {
  code: string;
  titre: string;
  rang: number;
  priorite: number;
  besoin: number;
  impact: number;
  source_impact: SourceImpact;
  observations: number;
  effort: number;
  duree_mois: number;
  dimensions: string[];
  retenue: boolean;
  motif: string;
}

export interface PlanActionPropose {
  version_id: string;
  numero: number;
  contexte: { secteur: string | null; taille: string | null };
  capacite: number;
  capacite_utilisee: number;
  initiatives: InitiativePriorisee[];
}

export interface ElementBanque {
  id: string;
  code: string;
  version: number;
  dimension: string;
  pratique: string;
  statut: "brouillon" | "valide";
  intitule: string | null;
  version_validee: number | null;
  modifie_le: string;
}

export interface ElementCalibration {
  id: string;
  titre: string;
  nombre_cas: number;
  niveaux: number;
  tolerance: number;
  notation_id: string | null;
  cree_le: string;
  cloturee_le: string | null;
  close: boolean;
  evaluateurs: number;
}

export interface Page<T> {
  elements: T[];
  curseur_suivant: string | null;
}

/* ----- Chemins ----- */

export const cheminConfiance = (notationId: string, numero: number) =>
  `/api/notations/${segment(notationId)}/confiance?version=${numero}`;
export const cheminConstats = (notationId: string, numero: number) =>
  `/api/notations/${segment(notationId)}/constats?version=${numero}`;
export const cheminExplication = (notationId: string, numero: number, cible: Classe | null) =>
  `/api/notations/${segment(notationId)}/explication?version=${numero}${cible ? `&cible=${cible}` : ""}`;
export const cheminPropositionPlan = (notationId: string, numero: number, capacite: number) =>
  `/api/notations/${segment(notationId)}/plan-action/proposition?version=${numero}&capacite=${capacite}`;
export const cheminPlansAction = (notationId: string) =>
  `/api/notations/${segment(notationId)}/plans-action`;
export const cheminBanque = (curseur: string, statut: "brouillon" | "valide" | null) => {
  const q = new URLSearchParams({ limite: "50" });
  if (curseur) q.set("curseur", curseur);
  if (statut) q.set("statut", statut);
  return `/api/notation/banque?${q.toString()}`;
};
export const cheminCalibrations = (curseur: string) =>
  `/api/notation/calibrations?limite=50${curseur ? `&curseur=${segment(curseur)}` : ""}`;
export const hrefAnalyseNotation = (missionId: string, numero?: number | null) =>
  `/missions/${segment(missionId)}/notation/analyse${numero ? `?version=${numero}` : ""}`;

/* ----- Paramètres d'URL ----- */

const premier = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Classe visée du simulateur (A à D), sinon null (l'API vise la classe supérieure). */
export function lireCible(v: string | string[] | undefined): Classe | null {
  const x = premier(v);
  return x === "A" || x === "B" || x === "C" || x === "D" ? x : null;
}

export const CAPACITE_DEFAUT = 10;

/** Capacité du client (somme d'efforts, 1 à 100), sinon la valeur par défaut. */
export function lireCapacite(v: string | string[] | undefined): number {
  const x = Number(premier(v));
  return Number.isInteger(x) && x >= 1 && x <= 100 ? x : CAPACITE_DEFAUT;
}

/** Statut de filtre de la banque. */
export function lireStatutBanque(v: string | string[] | undefined): "brouillon" | "valide" | null {
  const x = premier(v);
  return x === "brouillon" || x === "valide" ? x : null;
}

/** Saisie de la capacité avant l'enregistrement d'un plan. */
export function validerCapacite(saisie: string): Resultat<{ capacite: number }, "capacite"> {
  const x = Number(saisie.trim());
  if (saisie.trim() === "" || !Number.isInteger(x) || x < 1 || x > 100) {
    return { ok: false, erreurs: { capacite: "Entier de 1 à 100 attendu." } };
  }
  return { ok: true, charge: { capacite: x } };
}

/* ----- Libellés et présentation ----- */

export const NIVEAUX_CONFIANCE: Record<
  NiveauConfiance,
  { libelle: string; tonalite: TonaliteNotation }
> = {
  elevee: { libelle: "Confiance élevée", tonalite: "succes" },
  suffisante: { libelle: "Confiance suffisante", tonalite: "attention" },
  insuffisante: { libelle: "Confiance insuffisante : publication impossible", tonalite: "danger" },
};

export const GRAVITES_CONSTAT: Record<
  ConstatPerception["gravite"],
  { libelle: string; tonalite: TonaliteNotation }
> = {
  majeur: { libelle: "Écart majeur", tonalite: "danger" },
  notable: { libelle: "Écart notable", tonalite: "attention" },
};

export const SOURCES_IMPACT: Record<SourceImpact, string> = {
  contexte_semblable: "Contextes semblables (secteur et taille)",
  secteur: "Même secteur",
  taille: "Même taille",
  general: "Tous contextes",
  aucun: "Aucune observation",
};

/** Ratio 0-1 affiché en pour-cent entier (« 81 % »). */
export function formaterRatio(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)} %`;
}

/**
 * Points signés au centième, en français (« +3,50 », « −1,20 », « 0,00 ») : arrondi d'abord, signe
 * ensuite (un écart de −0,004 s'affiche « 0,00 », jamais « −0,00 »).
 */
export function formaterPointsSignes(v: number): string {
  const centiemes = Math.round(Math.abs(v) * 100);
  const absolu = (centiemes / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (centiemes === 0) return absolu;
  return v > 0 ? `+${absolu}` : `−${absolu}`;
}

/** Phrase de synthèse du simulateur. */
export function phraseSimulation(s: SimulationPassage): string {
  if (s.deja_atteinte) return `La classe ${s.cible} est déjà atteinte.`;
  if (s.tronquee) {
    return `La simulation a été interrompue (trop de paliers à relever) avant la classe ${s.cible} : score projeté ${s.score_projete.toLocaleString("fr-FR")}, résultat partiel.`;
  }
  if (!s.atteignable) {
    return `La classe ${s.cible} n'est pas atteignable en relevant les seules pratiques répondues : score projeté ${s.score_projete.toLocaleString("fr-FR")}.`;
  }
  const n = s.etapes.length;
  return `Pour passer de ${s.classe_actuelle} à ${s.cible} (seuil ${s.seuil}), relever ${n} pratique${n > 1 ? "s" : ""} : score projeté ${s.score_projete.toLocaleString("fr-FR")} (classe ${s.classe_projetee}).`;
}

/* =====================================================================================
 * NOT-09 : rédaction, validation et lecture d'un item de la banque
 * Les contrôles de ce module sont un CONFORT (messages avant l'envoi) : le schéma partagé et le
 * moteur de l'API restent seuls juges, et leurs refus sont affichés en français.
 * ===================================================================================== */

export const INTITULE_LONGUEUR_MAX = 200;
export const LIBELLE_NIVEAU_LONGUEUR_MAX = 120;
/** Miroir de `FORMULATION_LONGUEUR_MAX` et `ANCRAGE_LONGUEUR_MAX` du moteur. */
export const FORMULATION_LONGUEUR_MAX = 500;
export const ANCRAGE_LONGUEUR_MAX = 1000;
/** Les ancrages réunis (« 1 : … ; 2 : … ») forment l'aide d'une question : 1000 caractères. */
export const AIDE_ANCRAGES_LONGUEUR_MAX = 1000;
export const NIVEAUX_ITEM_MIN = 2;
export const NIVEAUX_ITEM_MAX = 10;
export const PRIORITE_ITEM_MAX = 9;
export const DUREE_ITEM_MIN_SECONDES = 5;
export const DUREE_ITEM_MAX_SECONDES = 600;
export const POIDS_ITEM_MAX = 100;

const FORMAT_IDENTIFIANT = /^[a-z0-9][a-z0-9_.-]{0,79}$/;
export const MESSAGE_IDENTIFIANT =
  "Identifiant : minuscules sans accent, chiffres, « _ », « . » ou « - », 80 caractères au plus, en commençant par une lettre ou un chiffre.";

export interface VersionItemBanque {
  id: string;
  version: number;
  statut: "brouillon" | "valide";
  cree_le: string;
  valide_le: string | null;
}

/** Réponse de `GET /api/notation/banque/:id` (et des écritures sur un item). */
export interface ItemBanqueDetail {
  id: string;
  code: string;
  version: number;
  dimension: string;
  pratique: string;
  statut: "brouillon" | "valide";
  contenu: ItemBanqueDonnees;
  cree_par: string;
  cree_le: string;
  modifie_par: string;
  modifie_le: string;
  valide_par: string | null;
  valide_le: string | null;
  versions: VersionItemBanque[];
}

export const CHEMIN_BANQUE = "/api/notation/banque";
export const cheminItemBanque = (id: string) => `${CHEMIN_BANQUE}/${segment(id)}`;
export const cheminValiderItem = (id: string) => `${cheminItemBanque(id)}/valider`;
export const hrefItemBanque = (id: string) => `/notation/banque/${segment(id)}`;
export const HREF_NOUVEL_ITEM = "/notation/banque/nouveau";
/** Nouvelle version (brouillon) d'un item validé, préremplie depuis la version `id`. */
export const hrefNouvelleVersionItem = (id: string) => `${HREF_NOUVEL_ITEM}?depuis=${segment(id)}`;

export const STATUTS_ITEM: Record<
  ItemBanqueDetail["statut"],
  { libelle: string; tonalite: TonaliteNotation }
> = {
  brouillon: { libelle: "Brouillon", tonalite: "neutre" },
  valide: { libelle: "Validé", tonalite: "succes" },
};

/** Compteur affiché sous un champ à longueur limitée (« 120 / 500 caractères »). */
export const compteurCaracteres = (saisie: string, max: number) =>
  `${saisie.trim().length} / ${max} caractères`;

/** Texte d'aide d'une question : ancrages par niveau croissant, comme le moteur les réunit. */
export function aideDepuisAncrages(
  ancrages: readonly { niveau: number; comportement: string }[],
): string {
  return [...ancrages]
    .sort((a, b) => a.niveau - b.niveau)
    .map((a) => `${a.niveau} : ${a.comportement}`)
    .join(" ; ");
}

/** Saisie d'un item : tout en texte, tableaux de 10 cases (seuls les `niveaux` premiers servent). */
export interface SaisieItemBanque {
  code: string;
  dimension: string;
  pratique: string;
  intitule: string;
  niveaux: string;
  libelles: string[];
  ancrages: string[];
  formulations: Record<PublicItemNotation, string>;
  poids: string;
  priorite: string;
  duree: string;
}

const completer = (liste: readonly string[]): string[] =>
  Array.from({ length: NIVEAUX_ITEM_MAX }, (_, i) => liste[i] ?? "");

const formulationsVides = (): Record<PublicItemNotation, string> => ({
  tous: "",
  dirigeant: "",
  manager: "",
  equipe: "",
  externe: "",
});

/** Saisie d'un nouvel item : échelle à 5 niveaux, valeurs par défaut modifiables. */
export function saisieItemVide(): SaisieItemBanque {
  return {
    code: "",
    dimension: "",
    pratique: "",
    intitule: "",
    niveaux: "5",
    libelles: completer([]),
    ancrages: completer([]),
    formulations: formulationsVides(),
    poids: "1",
    priorite: "5",
    duree: "30",
  };
}

/** Saisie préremplie depuis un contenu enregistré (édition d'un brouillon, nouvelle version). */
export function saisieDepuisItem(c: ItemBanqueDonnees): SaisieItemBanque {
  const formulations = formulationsVides();
  for (const f of c.formulations) formulations[f.public] = f.texte;
  const n = c.echelle.niveaux;
  return {
    code: c.code,
    dimension: c.dimension,
    pratique: c.pratique,
    intitule: c.intitule,
    niveaux: String(n),
    libelles: completer(c.echelle.libelles),
    ancrages: completer(
      Array.from(
        { length: n },
        (_, i) => c.ancrages.find((a) => a.niveau === i + 1)?.comportement ?? "",
      ),
    ),
    formulations,
    poids: String(c.poids).replace(".", ","),
    priorite: String(c.priorite),
    duree: String(c.dureeSecondes),
  };
}

const entier = (v: string): number | null => {
  const t = v.trim();
  return /^\d{1,9}$/.test(t) ? Number(t) : null;
};

/**
 * Contrôle d'une saisie d'item avant l'envoi. Clés d'erreur : `code`, `dimension`, `pratique`,
 * `intitule`, `niveaux`, `libelle-N`, `ancrage-N` (N = niveau), `ancrages`, `formulations`,
 * `formulation-PUBLIC`, `poids`, `priorite`, `duree`. `base` (contenu enregistré) conserve ce que le
 * formulaire n'édite pas : exemples par contexte des ancrages et étalonnage.
 */
export function validerSaisieItem(
  s: SaisieItemBanque,
  base: ItemBanqueDonnees | null = null,
): Resultat<{ contenu: ItemBanqueDonnees }, string> {
  const e: Record<string, string> = {};
  const code = s.code.trim();
  const dimension = s.dimension.trim();
  const pratique = s.pratique.trim();
  for (const [cle, v] of [
    ["code", code],
    ["dimension", dimension],
    ["pratique", pratique],
  ] as const) {
    if (!FORMAT_IDENTIFIANT.test(v)) e[cle] = MESSAGE_IDENTIFIANT;
  }
  const intitule = s.intitule.trim();
  if (intitule === "") e.intitule = "L'intitulé de la pratique évaluée est obligatoire.";
  else if (intitule.length > INTITULE_LONGUEUR_MAX) {
    e.intitule = `Intitulé de ${INTITULE_LONGUEUR_MAX} caractères au plus.`;
  }

  const niveaux = entier(s.niveaux);
  const nombre =
    niveaux !== null && niveaux >= NIVEAUX_ITEM_MIN && niveaux <= NIVEAUX_ITEM_MAX ? niveaux : 0;
  if (nombre === 0) {
    e.niveaux = `Nombre de niveaux : entier de ${NIVEAUX_ITEM_MIN} à ${NIVEAUX_ITEM_MAX}.`;
  }
  const libelles: string[] = [];
  const comportements: string[] = [];
  for (let i = 0; i < nombre; i++) {
    const rang = i + 1;
    const libelle = (s.libelles[i] ?? "").trim();
    if (libelle === "") e[`libelle-${rang}`] = "Libellé du niveau obligatoire.";
    else if (libelle.length > LIBELLE_NIVEAU_LONGUEUR_MAX) {
      e[`libelle-${rang}`] = `Libellé de ${LIBELLE_NIVEAU_LONGUEUR_MAX} caractères au plus.`;
    }
    libelles.push(libelle);
    const comportement = (s.ancrages[i] ?? "").trim();
    if (comportement === "") {
      e[`ancrage-${rang}`] = "Un comportement observable est obligatoire pour chaque niveau.";
    } else if (comportement.length > ANCRAGE_LONGUEUR_MAX) {
      e[`ancrage-${rang}`] = `Comportement de ${ANCRAGE_LONGUEUR_MAX} caractères au plus.`;
    }
    comportements.push(comportement);
  }
  if (nombre > 0 && !Object.keys(e).some((k) => k.startsWith("ancrage-"))) {
    const reuni = aideDepuisAncrages(
      comportements.map((comportement, i) => ({ niveau: i + 1, comportement })),
    ).length;
    if (reuni > AIDE_ANCRAGES_LONGUEUR_MAX) {
      e.ancrages = `Ancrages trop longs : ${AIDE_ANCRAGES_LONGUEUR_MAX} caractères au plus une fois réunis (« niveau : comportement »), ${reuni} saisis.`;
    }
  }

  const formulations: { public: PublicItemNotation; texte: string }[] = [];
  for (const p of PUBLICS_ITEM_NOTATION) {
    const texte = s.formulations[p].trim();
    if (texte === "") continue;
    if (texte.length > FORMULATION_LONGUEUR_MAX) {
      e[`formulation-${p}`] = `Formulation de ${FORMULATION_LONGUEUR_MAX} caractères au plus.`;
    }
    formulations.push({ public: p, texte });
  }
  if (formulations.length === 0) {
    e.formulations = "Au moins une formulation est obligatoire (idéalement « Tous publics »).";
  }

  const poids = lireNombre(s.poids);
  if (poids === null || Number.isNaN(poids) || poids <= 0 || poids > POIDS_ITEM_MAX) {
    e.poids = `Poids : nombre supérieur à 0 et au plus ${POIDS_ITEM_MAX}.`;
  }
  const priorite = entier(s.priorite);
  if (priorite === null || priorite < 1 || priorite > PRIORITE_ITEM_MAX) {
    e.priorite = `Priorité : entier de 1 (cœur de la dimension) à ${PRIORITE_ITEM_MAX}.`;
  }
  const duree = entier(s.duree);
  if (duree === null || duree < DUREE_ITEM_MIN_SECONDES || duree > DUREE_ITEM_MAX_SECONDES) {
    e.duree = `Durée de réponse : entier de ${DUREE_ITEM_MIN_SECONDES} à ${DUREE_ITEM_MAX_SECONDES} secondes.`;
  }
  if (Object.keys(e).length > 0) return { ok: false, erreurs: e };

  const contenu: ItemBanqueDonnees = {
    code,
    dimension,
    pratique,
    intitule,
    echelle: { niveaux: nombre, libelles },
    ancrages: comportements.map((comportement, i) => {
      const exemples = base?.ancrages.find((a) => a.niveau === i + 1)?.exemples;
      return {
        niveau: i + 1,
        comportement,
        ...(exemples && exemples.length > 0 ? { exemples } : {}),
      };
    }),
    formulations,
    poids: poids as number,
    priorite: priorite as number,
    dureeSecondes: duree as number,
    ...(base?.etalonnage ? { etalonnage: base.etalonnage } : {}),
  };
  return { ok: true, charge: { contenu } };
}

export interface DroitsItemBanque {
  /** Brouillon modifiable par qui rédige (notation.gerer ou notation.publier). */
  modifier: boolean;
  /** Une version validée est figée : une correction passe par une nouvelle version. */
  nouvelleVersion: boolean;
  /** Le bouton « Valider » n'existe que pour `notation.publier`. */
  validerVisible: boolean;
  /** Bouton actif : expert métier qui n'est ni l'auteur ni le dernier modificateur. */
  valider: boolean;
  /** Pourquoi la validation est impossible (brouillon seulement), `null` si elle est possible. */
  explicationValidation: string | null;
}

/** Droits d'AFFICHAGE sur une version d'item ; l'API reste seule juge (MPN04, MPN08). */
export function droitsItemBanque(
  roles: readonly Role[],
  utilisateurId: string,
  item: { statut: "brouillon" | "valide"; cree_par: string; modifie_par: string },
): DroitsItemBanque {
  const brouillon = item.statut === "brouillon";
  const redige = aPermission(roles, "notation.gerer") || aPermission(roles, "notation.publier");
  const validerVisible = brouillon && aPermission(roles, "notation.publier");
  const auteur = item.cree_par === utilisateurId || item.modifie_par === utilisateurId;
  let explicationValidation: string | null = null;
  if (brouillon && !estExpertPublieur(roles)) {
    explicationValidation =
      "La validation d'un item revient à un expert métier du cabinet : votre rôle permet de le rédiger, pas de le valider.";
  } else if (brouillon && auteur) {
    explicationValidation =
      "Vous avez rédigé ou modifié ce brouillon : un autre expert métier doit le relire et le valider (séparation des tâches).";
  }
  return {
    modifier: brouillon && redige,
    nouvelleVersion: !brouillon && redige,
    validerVisible,
    valider: validerVisible && explicationValidation === null,
    explicationValidation,
  };
}

/* ----- Messages d'erreur de l'API ----- */

/** Codes dont le message de l'API est déjà un texte français destiné à l'utilisateur. */
const CODES_MESSAGE_FRANCAIS = new Set([
  "SEPARATION_DES_TACHES",
  "EXPERT_METIER_REQUIS",
  "ITEM_FIGE",
  "CALIBRATION_FIGEE",
  "CONFIANCE_INSUFFISANTE",
  "SELECTION_REFUSEE",
  "CONFLIT",
]);

export interface AnomalieNotationAugmentee {
  code: string;
  chemin: string;
  message: string;
}

/** Anomalies du moteur (`details.erreurs`) d'une erreur de l'API, vides si absentes. */
export function anomaliesErreur(e: unknown): AnomalieNotationAugmentee[] {
  if (!(e instanceof ErreurApi)) return [];
  const d = e.details as { erreurs?: unknown } | undefined;
  if (!d || !Array.isArray(d.erreurs)) return [];
  return d.erreurs.flatMap((a): AnomalieNotationAugmentee[] => {
    if (typeof a !== "object" || a === null) return [];
    const { code, chemin, message } = a as Record<string, unknown>;
    return typeof message === "string"
      ? [
          {
            code: typeof code === "string" ? code : "",
            chemin: typeof chemin === "string" ? chemin : "",
            message,
          },
        ]
      : [];
  });
}

/** Chemin technique d'une anomalie → partie de l'item concernée, en français. */
export function libelleCheminAnomalie(chemin: string): string {
  const indexe = /^(formulations|ancrages)\[(\d+)\]$/.exec(chemin);
  if (indexe) {
    const rang = Number(indexe[2]) + 1;
    return indexe[1] === "formulations" ? `Formulation n° ${rang}` : `Ancrage du niveau ${rang}`;
  }
  if (chemin.startsWith("etalonnage")) return "Étalonnage";
  const LIBELLES: Record<string, string> = {
    code: "Code",
    dimension: "Dimension",
    pratique: "Pratique",
    intitule: "Intitulé",
    "echelle.niveaux": "Échelle",
    "echelle.libelles": "Libellés de l'échelle",
    ancrages: "Ancrages",
    formulations: "Formulations",
    poids: "Poids",
    priorite: "Priorité",
    dureeSecondes: "Durée de réponse",
  };
  return LIBELLES[chemin] ?? "";
}

/**
 * Message français d'une erreur de la notation augmentée (banque, calibrations, paramètres) :
 * refus du moteur avec ses anomalies (« Item de banque invalide. Formulation n° 2 : Formulation
 * vide. »), règles métier de l'API (séparation des tâches, item figé, session close…), sinon le
 * message commun de la notation.
 */
export function messageNotationAugmentee(e: unknown): string {
  if (e instanceof ErreurApi) {
    const anomalies = anomaliesErreur(e);
    if (anomalies.length > 0) {
      const lignes = anomalies.slice(0, 8).map((a) => {
        const partie = libelleCheminAnomalie(a.chemin);
        return partie ? `${partie} : ${a.message}` : a.message;
      });
      return `${e.message} ${lignes.join(" ")}`;
    }
    if (CODES_MESSAGE_FRANCAIS.has(e.code)) return e.message;
    if (e.statut === 404) return "Cet élément n'est plus accessible. Actualisez la page.";
  }
  return messageNotation(e);
}

/** Après ce refus, l'état affiché est probablement périmé : rafraîchir la page. */
export const etatNotationAugmenteeChange = (e: unknown) =>
  e instanceof ErreurApi && (e.statut === 404 || e.statut === 409);

/* =====================================================================================
 * NOT-13 : sessions de calibrage
 * ===================================================================================== */

export interface CasCalibration {
  code: string;
  libelle: string;
}

export interface MesureCasCalibration {
  cas: string;
  cotations: number;
  min: number;
  max: number;
  ecart: number;
  mediane: number;
  /** `null` : un seul évaluateur, rien à comparer. */
  accord: boolean | null;
}

export interface MesureEvaluateurCalibration {
  evaluateur: { id: string; nom: string | null };
  cotations: number;
  cas_compares: number;
  biais: number | null;
  ecart_absolu_moyen: number | null;
}

/** Mesure produite par le moteur (`mesurerCalibration`) : rien n'est recalculé ici. */
export interface MesureCalibrationVue {
  tolerance: number;
  cas_doublement_cotes: number;
  cas_en_accord: number;
  taux_accord: number | null;
  ecart_moyen: number | null;
  a_discuter: string[];
  cas: MesureCasCalibration[];
  evaluateurs: MesureEvaluateurCalibration[];
}

export interface MaCotationCalibration {
  cas: string;
  niveau: number;
  motif: string | null;
  cree_le: string;
}

export interface CotationVisibleCalibration {
  cas: string;
  evaluateur: { id: string; nom: string };
  niveau: number;
  motif: string | null;
}

/** Réponse de `GET /api/notation/calibrations/:id` (et des écritures sur une session). */
export interface SessionCalibration {
  id: string;
  titre: string;
  cas: CasCalibration[];
  niveaux: number;
  tolerance: number;
  notation_id: string | null;
  cree_par: string;
  cree_le: string;
  cloturee_par: string | null;
  cloturee_le: string | null;
  conclusion: string | null;
  close: boolean;
  /** Nombre d'évaluateurs ayant coté chaque cas (jamais leurs niveaux avant la clôture). */
  avancement: { code: string; libelle: string; evaluateurs: number }[];
  mes_cotations: MaCotationCalibration[];
  /** `null` : cotations des autres masquées (double cotation à l'aveugle). */
  cotations: CotationVisibleCalibration[] | null;
  mesure: MesureCalibrationVue | null;
}

export const CHEMIN_CALIBRATIONS = "/api/notation/calibrations";
export const cheminCalibration = (id: string) => `${CHEMIN_CALIBRATIONS}/${segment(id)}`;
export const cheminCotations = (id: string) => `${cheminCalibration(id)}/cotations`;
export const cheminCloture = (id: string) => `${cheminCalibration(id)}/cloturer`;
export const hrefCalibration = (id: string) => `/notation/calibrations/${segment(id)}`;
export const HREF_NOUVELLE_CALIBRATION = "/notation/calibrations/nouvelle";

export const CAS_CALIBRATION_MAX = 200;
export const TITRE_CALIBRATION_LONGUEUR_MAX = 200;
export const LIBELLE_CAS_LONGUEUR_MAX = 200;
export const MOTIF_COTATION_LONGUEUR_MAX = 2000;
export const CONCLUSION_LONGUEUR_MAX = 4000;
export const TOLERANCE_CALIBRATION_MAX = 9;
export const NIVEAUX_CALIBRATION_DEFAUT = 5;

export interface SaisieCasCalibration {
  code: string;
  libelle: string;
}

export interface SaisieCalibration {
  titre: string;
  niveaux: string;
  tolerance: string;
  cas: SaisieCasCalibration[];
}

export function saisieCalibrationVide(): SaisieCalibration {
  return {
    titre: "",
    niveaux: String(NIVEAUX_CALIBRATION_DEFAUT),
    tolerance: "0",
    cas: [
      { code: "", libelle: "" },
      { code: "", libelle: "" },
    ],
  };
}

/** Code d'un cas : celui saisi, sinon dérivé du libellé (« Cas Acme 2026 » → « cas_acme_2026 »). */
export function codeCas(c: SaisieCasCalibration, rang: number): string {
  const saisi = c.code.trim();
  if (saisi !== "") return saisi;
  return codeDepuisTitre(c.libelle) || `cas_${rang + 1}`;
}

/**
 * Contrôle d'une création de session. Les lignes de cas entièrement vides sont ignorées. Clés
 * d'erreur : `titre`, `niveaux`, `tolerance`, `cas`, `cas-code-I`, `cas-libelle-I` (I = rang de la
 * ligne saisie, à partir de 0).
 */
export function validerSaisieCalibration(s: SaisieCalibration): Resultat<
  {
    titre: string;
    cas: CasCalibration[];
    niveaux: number;
    tolerance: number;
    notation_id: null;
  },
  string
> {
  const e: Record<string, string> = {};
  const titre = s.titre.trim();
  if (titre === "") e.titre = "Le titre de la session est obligatoire.";
  else if (titre.length > TITRE_CALIBRATION_LONGUEUR_MAX) {
    e.titre = `Titre de ${TITRE_CALIBRATION_LONGUEUR_MAX} caractères au plus.`;
  }
  const niveaux = entier(s.niveaux);
  if (niveaux === null || niveaux < NIVEAUX_ITEM_MIN || niveaux > NIVEAUX_ITEM_MAX) {
    e.niveaux = `Nombre de niveaux : entier de ${NIVEAUX_ITEM_MIN} à ${NIVEAUX_ITEM_MAX}.`;
  }
  const tolerance = entier(s.tolerance);
  if (tolerance === null || tolerance > TOLERANCE_CALIBRATION_MAX) {
    e.tolerance = `Tolérance : entier de 0 à ${TOLERANCE_CALIBRATION_MAX}.`;
  } else if (niveaux !== null && tolerance >= niveaux) {
    e.tolerance = "La tolérance est inférieure au nombre de niveaux.";
  }

  const cas: CasCalibration[] = [];
  const vus = new Set<string>();
  s.cas.forEach((ligne, i) => {
    if (ligne.code.trim() === "" && ligne.libelle.trim() === "") return;
    const libelle = ligne.libelle.trim();
    if (libelle === "") e[`cas-libelle-${i}`] = "Le libellé du cas est obligatoire.";
    else if (libelle.length > LIBELLE_CAS_LONGUEUR_MAX) {
      e[`cas-libelle-${i}`] = `Libellé de ${LIBELLE_CAS_LONGUEUR_MAX} caractères au plus.`;
    }
    const code = codeCas(ligne, i);
    if (!FORMAT_IDENTIFIANT.test(code)) e[`cas-code-${i}`] = MESSAGE_IDENTIFIANT;
    else if (vus.has(code)) e[`cas-code-${i}`] = "Ce code est déjà utilisé par un autre cas.";
    vus.add(code);
    cas.push({ code, libelle });
  });
  if (cas.length === 0) e.cas = "Au moins un cas à coter est obligatoire.";
  else if (cas.length > CAS_CALIBRATION_MAX) {
    e.cas = `${CAS_CALIBRATION_MAX} cas au plus par session.`;
  }
  if (Object.keys(e).length > 0) return { ok: false, erreurs: e };
  return {
    ok: true,
    charge: {
      titre,
      cas,
      niveaux: niveaux as number,
      tolerance: tolerance as number,
      notation_id: null,
    },
  };
}

/** Cotation d'un cas : niveau dans l'échelle de la session, motif facultatif. */
export function validerCotation(
  cas: string,
  niveauSaisi: string,
  motifSaisi: string,
  niveaux: number,
): Resultat<{ cotations: { cas: string; niveau: number; motif?: string }[] }, "niveau" | "motif"> {
  const e: Partial<Record<"niveau" | "motif", string>> = {};
  const niveau = entier(niveauSaisi);
  if (niveau === null || niveau < 1 || niveau > niveaux) {
    e.niveau = `Choisissez un niveau de 1 à ${niveaux}.`;
  }
  const motif = motifSaisi.trim();
  if (motif.length > MOTIF_COTATION_LONGUEUR_MAX) {
    e.motif = `Motif de ${MOTIF_COTATION_LONGUEUR_MAX} caractères au plus.`;
  }
  if (e.niveau || e.motif) return { ok: false, erreurs: e };
  return {
    ok: true,
    charge: { cotations: [{ cas, niveau: niveau as number, ...(motif === "" ? {} : { motif }) }] },
  };
}

/** Conclusion obligatoire de la clôture d'une session. */
export function validerConclusion(saisie: string): Resultat<{ conclusion: string }, "conclusion"> {
  const conclusion = saisie.trim();
  if (conclusion === "") {
    return { ok: false, erreurs: { conclusion: "La conclusion de la session est obligatoire." } };
  }
  if (conclusion.length > CONCLUSION_LONGUEUR_MAX) {
    return {
      ok: false,
      erreurs: { conclusion: `Conclusion de ${CONCLUSION_LONGUEUR_MAX} caractères au plus.` },
    };
  }
  return { ok: true, charge: { conclusion } };
}

export interface DroitsCalibration {
  coter: boolean;
  cloturer: boolean;
  explicationCloture: string | null;
}

/** Droits d'AFFICHAGE d'une session ; la clôture est réservée à un expert métier (MPN11). */
export function droitsCalibration(roles: readonly Role[], close: boolean): DroitsCalibration {
  const redige = aPermission(roles, "notation.gerer") || aPermission(roles, "notation.publier");
  const expert = estExpertPublieur(roles);
  return {
    coter: !close && redige,
    cloturer: !close && expert,
    explicationCloture:
      !close && !expert
        ? "La clôture d'une session revient à un expert métier du cabinet : votre rôle permet de coter, pas de clore."
        : null,
  };
}

export const LIBELLE_COTATIONS_MASQUEES =
  "Les cotations des autres évaluateurs restent masquées tant que la session est ouverte (cotation à l'aveugle). Un expert métier voit celles des cas qu'il a lui-même cotés ; tout le monde voit tout à la clôture.";

/** Accord d'un cas selon la mesure du moteur. */
export function libelleAccord(accord: boolean | null): {
  libelle: string;
  tonalite: TonaliteNotation;
} {
  if (accord === null) return { libelle: "Un seul évaluateur", tonalite: "neutre" };
  return accord
    ? { libelle: "En accord", tonalite: "succes" }
    : { libelle: "À discuter", tonalite: "attention" };
}

/** Niveaux de l'échelle d'une session (1 à n), pour les listes de choix. */
export const niveauxEchelle = (n: number): number[] =>
  Array.from({ length: Math.max(0, Math.min(n, NIVEAUX_ITEM_MAX)) }, (_, i) => i + 1);

/** Biais d'un évaluateur, en français (positif : plus généreux que ses pairs). */
export function phraseBiais(biais: number | null): string {
  if (biais === null) return "Non comparable";
  if (Math.round(Math.abs(biais) * 100) === 0) return "Aligné sur ses pairs";
  return biais > 0
    ? `Plus généreux que ses pairs (${formaterPointsSignes(biais)} niveau)`
    : `Plus sévère que ses pairs (${formaterPointsSignes(biais)} niveau)`;
}

/* =====================================================================================
 * NOT-11 : paramètres de confiance du cabinet
 * ===================================================================================== */

/** Réponse de `GET` et `PUT /api/notation/parametres`. */
export interface ParametresNotation {
  seuil_confiance: number;
  repondants_cible: number;
  /** Aucun réglage enregistré : valeurs par défaut du moteur. */
  par_defaut: boolean;
  modifie_le: string | null;
}

export const CHEMIN_PARAMETRES_NOTATION = "/api/notation/parametres";
export const HREF_PARAMETRES_NOTATION = "/parametres/notation";
export const REPONDANTS_CIBLE_MAX = 1000;
export { REPONDANTS_CIBLE_PLANCHER, SEUIL_CONFIANCE_PLANCHER };

/** Seuil de confiance à la française, 4 décimales au plus (« 0,5 », « 0,3125 »). */
export function formaterSeuil(v: number): string {
  return v.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

export interface SaisieParametresNotation {
  seuil: string;
  repondants: string;
}

export function saisieParametres(p: ParametresNotation): SaisieParametresNotation {
  return { seuil: formaterSeuil(p.seuil_confiance), repondants: String(p.repondants_cible) };
}

/** Contrôle des paramètres de confiance (planchers : seuil 0,3 ; au moins 2 répondants). */
export function validerParametres(
  s: SaisieParametresNotation,
): Resultat<
  { seuil_confiance: number; repondants_cible: number },
  "seuil_confiance" | "repondants_cible"
> {
  const e: Partial<Record<"seuil_confiance" | "repondants_cible", string>> = {};
  const seuil = lireNombre(s.seuil);
  if (seuil === null || Number.isNaN(seuil)) {
    e.seuil_confiance = "Saisissez un nombre entre 0,3 et 1 (ex. 0,5).";
  } else if (seuil < SEUIL_CONFIANCE_PLANCHER) {
    e.seuil_confiance = `Seuil de confiance : ${formaterSeuil(SEUIL_CONFIANCE_PLANCHER)} au moins (plancher qui garde la publication exigeante).`;
  } else if (seuil > 1) {
    e.seuil_confiance = "Seuil de confiance : 1 au plus.";
  } else if (Math.abs(Math.round(seuil * 10_000) - seuil * 10_000) >= 1e-6) {
    e.seuil_confiance = "Quatre décimales au plus.";
  }
  const repondants = entier(s.repondants);
  if (repondants === null) {
    e.repondants_cible = "Saisissez un nombre entier de répondants.";
  } else if (repondants < REPONDANTS_CIBLE_PLANCHER) {
    e.repondants_cible = `Cible de répondants : ${REPONDANTS_CIBLE_PLANCHER} au moins (plancher).`;
  } else if (repondants > REPONDANTS_CIBLE_MAX) {
    e.repondants_cible = `Cible de répondants : ${REPONDANTS_CIBLE_MAX} au plus.`;
  }
  if (e.seuil_confiance || e.repondants_cible) return { ok: false, erreurs: e };
  return {
    ok: true,
    charge: { seuil_confiance: seuil as number, repondants_cible: repondants as number },
  };
}

export interface DroitsParametresNotation {
  /** Formulaire d'édition affiché (`cabinet.gerer`). */
  modifier: boolean;
  /** Avertissement affiché au-dessus du formulaire, `null` s'il n'y en a pas. */
  avertissement: string | null;
  /** Explication quand la modification n'est pas proposée. */
  explication: string | null;
}

export const MESSAGE_SEPARATION_PARAMETRES =
  "Votre compte cumule le rôle d'expert métier : il publie les notations et ne règle donc pas le seuil de confiance qu'il doit franchir (séparation des tâches). Demandez à un associé qui n'est pas expert métier ; l'enregistrement sera refusé.";

/** Droits d'AFFICHAGE des paramètres de confiance : `cabinet.gerer` règle, pas un expert métier. */
export function droitsParametres(roles: readonly Role[]): DroitsParametresNotation {
  if (!aPermission(roles, "cabinet.gerer")) {
    return {
      modifier: false,
      avertissement: null,
      explication:
        "Le seuil de confiance et la cible de répondants se règlent par un associé du cabinet (gestion du cabinet).",
    };
  }
  return {
    modifier: true,
    avertissement: roles.includes("expert_metier") ? MESSAGE_SEPARATION_PARAMETRES : null,
    explication: null,
  };
}
