/**
 * Registre des preuves d'une mission (PRV-01 à PRV-05) côté cabinet : contrats des réponses de
 * l'API, libellés, chemins, droits d'affichage, messages d'erreur et mise en forme. Logique pure,
 * testée dans `preuves.test.ts`.
 *
 * L'indice de solidité, sa lecture (solide, étayée, fragile), les contradictions, la carte de
 * triangulation et le contrôle des livrables R2 et R3 sont ceux du moteur de l'API
 * (`packages/engines/src/preuves`) : ce module les met en forme et ne les recalcule JAMAIS.
 * Les centièmes et dix-millièmes reçus ne sont divisés que pour être affichés.
 */
import {
  aPermission,
  DECISION_ARBITRAGE_LIBELLES,
  FIABILITE_LIBELLES,
  LECTURE_SOLIDITE_LIBELLES,
  RATTACHEMENT_LIBELLES,
  STATUT_ASSERTION_LIBELLES,
  TYPE_SOURCE_PREUVE_LIBELLES,
  type DecisionArbitrage,
  type LectureSoliditeApi,
  type RattachementAssertion,
  type Role,
  type StatutAssertion,
  type TypeSourcePreuve,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi, messageErreur } from "./api";
import { formaterNombre, VALEUR_ABSENTE } from "./format";

// --- Réponses de l'API ----------------------------------------------------------------------

export type ClasseRisqueApi = "R0" | "R1" | "R2" | "R3";
export type FiabiliteApi = "A" | "B" | "C" | "D";
export type SensApi = "pour" | "contre";

export interface PreuveVue {
  id: string;
  mission_id: string;
  version: number;
  type_source: TypeSourcePreuve;
  source_precise: string;
  date_preuve: string;
  auteur: { id: string; nom: string | null };
  fiabilite: FiabiliteApi;
  extrait: string | null;
  fichier_id: string | null;
  reponse_id: string | null;
  document_id: string | null;
  dimensions: string[];
  nominatif: boolean;
  accord_nominatif: boolean;
  /** Verbatim nominatif sans accord, masqué pour ce lecteur. */
  masque: boolean;
  motif: string | null;
  cree_le: string;
  version_cree_le: string;
}

export interface AssertionLieeAPreuve {
  assertion_id: string;
  sens: SensApi;
  enonce: string;
  classe_risque: ClasseRisqueApi;
  statut: StatutAssertion;
}

export interface DetailPreuve extends PreuveVue {
  versions: PreuveVue[];
  assertions: AssertionLieeAPreuve[];
}

export interface ArbitrageVue {
  id: string;
  preuve_id: string;
  preuve_version: number;
  decision: DecisionArbitrage;
  motif: string;
  arbitre: { id: string; nom: string | null };
  arbitre_le: string;
}

export interface SoliditeVue {
  indice: number;
  numerateur: number;
  denominateur: number;
  lecture: LectureSoliditeApi;
  fiabilites_retenues: {
    type_source: TypeSourcePreuve;
    fiabilite: FiabiliteApi;
    poids_centiemes: number;
  }[];
  somme_centiemes: number;
  plafonnee: boolean;
  contradiction_non_resolue: boolean;
  preuves_pour: number;
  preuves_contre: number;
  plafond_centiemes: number;
  seuil_solide: number;
  seuil_etayee: number;
}

export interface AvisExpertVue {
  motif: string | null;
  signe: boolean;
  signe_par: { id: string; nom: string | null } | null;
  signe_le: string | null;
}

export interface AssertionVue {
  id: string;
  mission_id: string;
  version: number;
  enonce: string;
  rattachement: { type: RattachementAssertion; code: string } | null;
  livrable: string | null;
  classe_risque: ClasseRisqueApi;
  statut: StatutAssertion;
  avis_expert: AvisExpertVue | null;
  motif: string | null;
  auteur: { id: string; nom: string | null };
  cree_le: string;
  version_cree_le: string;
}

export interface ElementAssertion extends AssertionVue {
  solidite?: SoliditeVue;
  a_arbitrer: number;
}

export interface PreuveLiee extends PreuveVue {
  sens: SensApi;
  a_arbitrer: boolean;
  arbitrage: ArbitrageVue | null;
}

export interface VersionAssertion {
  version: number;
  enonce: string;
  classe_risque: ClasseRisqueApi;
  statut: StatutAssertion;
  avis_expert: boolean;
  signe_par: { id: string; nom: string | null } | null;
  signe_le: string | null;
  motif: string | null;
  auteur: { id: string; nom: string | null };
  cree_le: string;
}

export interface DetailAssertion extends AssertionVue {
  solidite: SoliditeVue;
  preuves_pour: PreuveLiee[];
  preuves_contre: PreuveLiee[];
  historique: VersionAssertion[];
  arbitrages: ArbitrageVue[];
}

export interface PageApi<T> {
  elements: T[];
  curseur_suivant: string | null;
}

export interface DimensionVue {
  id: string;
  code: string;
  libelle: string;
  actif: boolean;
  cree_le: string;
}

export interface CarteTriangulationVue {
  dimensions: {
    code: string;
    libelle: string;
    types_couverts: TypeSourcePreuve[];
    types_manquants: TypeSourcePreuve[];
    preuves: number;
    couverte: boolean;
    triangulee: boolean;
  }[];
  cellules: {
    dimension: string;
    type_source: TypeSourcePreuve;
    preuves: number;
    meilleure_fiabilite: FiabiliteApi | null;
  }[];
  zones_non_couvertes: { dimension: string; type_source: TypeSourcePreuve }[];
  dimensions_non_couvertes: string[];
  dimensions_sous_triangulees: string[];
  rattachements_inconnus: { preuve: string; dimension: string }[];
  preuves_ecartees: string[];
}

export interface ContradictionVue {
  assertion: AssertionVue;
  solidite: SoliditeVue;
  preuves_pour: PreuveLiee[];
  preuves_contre: PreuveLiee[];
  a_arbitrer: string[];
}

export interface ControleLivrableVue {
  conforme: boolean;
  controlees: number;
  ignorees: number;
  anomalies: {
    assertion_id: string;
    classe_risque: ClasseRisqueApi;
    code: "SANS_PREUVE" | "AVIS_EXPERT_NON_SIGNE";
    enonce: string;
    livrable: string | null;
  }[];
  livrable: string | null;
}

export interface AssertionFragileVue {
  id: string;
  enonce: string;
  classe_risque: ClasseRisqueApi;
  livrable: string | null;
  statut: StatutAssertion;
  avis_expert: boolean;
  avis_expert_signe: boolean;
  indice: number;
  lecture: LectureSoliditeApi;
  contradiction_non_resolue: boolean;
  preuves_pour: number;
  preuves_contre: number;
}

// --- Libellés -------------------------------------------------------------------------------

export const TYPE_SOURCE_LIBELLES = TYPE_SOURCE_PREUVE_LIBELLES;
export const FIABILITES = FIABILITE_LIBELLES;
export const LECTURES = LECTURE_SOLIDITE_LIBELLES;
export const STATUTS_ASSERTION = STATUT_ASSERTION_LIBELLES;
export const RATTACHEMENTS = RATTACHEMENT_LIBELLES;
export const DECISIONS = DECISION_ARBITRAGE_LIBELLES;

export const SENS_LIBELLES: Record<SensApi, string> = { pour: "Pour", contre: "Contre" };

export const ANOMALIE_LIBELLES: Record<"SANS_PREUVE" | "AVIS_EXPERT_NON_SIGNE", string> = {
  SANS_PREUVE: "Aucune preuve en sa faveur ni avis d'expert",
  AVIS_EXPERT_NON_SIGNE: "Avis d'expert non signé",
};

/** Lecture du moteur → tonalité du badge (le texte est toujours affiché). */
export const TONALITE_LECTURE: Record<LectureSoliditeApi, TonaliteStatut> = {
  solide: "succes",
  etayee: "attention",
  fragile: "danger",
};

export function libelleLecture(lecture: LectureSoliditeApi): string {
  return LECTURES[lecture];
}

// --- Chemins --------------------------------------------------------------------------------

export const cheminPreuvesMission = (missionId: string) => `/api/missions/${missionId}/preuves`;
export const cheminAssertionsMission = (missionId: string) =>
  `/api/missions/${missionId}/assertions`;
export const cheminPreuve = (id: string) => `/api/preuves/${id}`;
export const cheminVersionsPreuve = (id: string) => `/api/preuves/${id}/versions`;
export const cheminAssertion = (id: string) => `/api/assertions/${id}`;
export const cheminVersionsAssertion = (id: string) => `/api/assertions/${id}/versions`;
export const cheminLiensAssertion = (id: string) => `/api/assertions/${id}/liens`;
export const cheminLienAssertion = (id: string, preuveId: string) =>
  `/api/assertions/${id}/liens/${preuveId}`;
export const cheminArbitragesAssertion = (id: string) => `/api/assertions/${id}/arbitrages`;
export const cheminDimensions = (missionId: string) =>
  `${cheminPreuvesMission(missionId)}/dimensions`;
export const cheminDimension = (missionId: string, id: string) =>
  `${cheminDimensions(missionId)}/${id}`;
export const cheminTriangulation = (missionId: string) =>
  `${cheminPreuvesMission(missionId)}/triangulation`;
export const cheminContradictions = (missionId: string, resolues = false) =>
  `${cheminPreuvesMission(missionId)}/contradictions${resolues ? "?resolues=oui" : ""}`;
export const cheminControle = (missionId: string, livrable?: string | null) =>
  `${cheminPreuvesMission(missionId)}/controle${livrable ? `?livrable=${encodeURIComponent(livrable)}` : ""}`;
export const cheminAssertionsFragiles = (missionId: string) =>
  `${cheminAssertionsMission(missionId)}/fragiles`;

const base = (missionId: string) => `/missions/${missionId}/preuves`;
export const hrefRegistre = (missionId: string, requete = "") =>
  `${base(missionId)}${requete ? `?${requete}` : ""}`;
export const hrefNouvellePreuve = (missionId: string) => `${base(missionId)}/nouvelle`;
export const hrefPreuve = (missionId: string, id: string) => `${base(missionId)}/${id}`;
export const hrefAssertions = (missionId: string, requete = "") =>
  `${base(missionId)}/assertions${requete ? `?${requete}` : ""}`;
export const hrefNouvelleAssertion = (missionId: string) =>
  `${base(missionId)}/assertions/nouvelle`;
export const hrefAssertion = (missionId: string, id: string) =>
  `${base(missionId)}/assertions/${id}`;
export const hrefTriangulation = (missionId: string) => `${base(missionId)}/triangulation`;
export const hrefContradictions = (missionId: string) => `${base(missionId)}/contradictions`;

/** Sous-pages de l'onglet « Preuves » (l'onglet actif est celui dont le href est le plus long). */
export function sousPagesPreuves(missionId: string) {
  return [
    { id: "registre", libelle: "Registre", href: base(missionId) },
    { id: "assertions", libelle: "Assertions", href: hrefAssertions(missionId) },
    { id: "triangulation", libelle: "Triangulation", href: hrefTriangulation(missionId) },
    { id: "contradictions", libelle: "Contradictions", href: hrefContradictions(missionId) },
  ] as const;
}

// --- Droits d'affichage ---------------------------------------------------------------------

export interface DroitsPreuves {
  lire: boolean;
  /** Écrire : permission du rôle et mission ouverte (l'API reste la source de vérité). */
  ecrire: boolean;
}

/**
 * Signer un avis d'expert (et abaisser la classe de risque d'une assertion) : expert métier ou
 * associé, comme l'API (MPV04, MPV06). Confort d'affichage seulement.
 */
export function peutSignerAvisExpert(roles: readonly Role[]): boolean {
  return roles.includes("expert_metier") || roles.includes("associe");
}

export function droitsPreuves(roles: readonly Role[], mission: { statut: string }): DroitsPreuves {
  return {
    lire: aPermission(roles, "preuve.lire"),
    ecrire: aPermission(roles, "preuve.ecrire") && mission.statut !== "cloturee",
  };
}

// --- Mise en forme --------------------------------------------------------------------------

/** Indice de 0 à 1 déjà arrondi par le moteur : « 0,875 », « 1 », « 0,4375 ». */
export function formaterIndice(indice: number | null | undefined): string {
  return formaterNombre(indice, 4);
}

/** Poids ou somme reçus en centièmes → « 0,75 » (affichage seulement). */
export function formaterCentiemes(centiemes: number | null | undefined): string {
  if (typeof centiemes !== "number" || !Number.isFinite(centiemes)) return VALEUR_ABSENTE;
  return formaterNombre(centiemes / 100, 2);
}

/** Seuil reçu en dix-millièmes → « 0,75 » (affichage seulement). */
export function formaterSeuil(dixMillieme: number): string {
  return formaterNombre(dixMillieme / 10_000, 4);
}

export function libelleFiabilite(f: FiabiliteApi): string {
  return FIABILITES[f];
}

/** Dimension d'une preuve : libellé déclaré pour la mission, sinon le code. */
export function libelleDimension(
  code: string,
  dimensions: readonly Pick<DimensionVue, "code" | "libelle">[],
): string {
  return dimensions.find((d) => d.code === code)?.libelle ?? code;
}

/**
 * Explication en phrases de l'indice de solidité, à partir des nombres du moteur. Une ligne par
 * élément (source retenue, plafond, contradiction, seuils) ; aucun chiffre n'est calculé ici.
 */
export function expliquerSolidite(s: SoliditeVue): string[] {
  const lignes: string[] = [];
  if (s.fiabilites_retenues.length === 0) {
    lignes.push("Aucune preuve en faveur de l'assertion : l'indice est nul.");
  } else {
    lignes.push(
      "Pour chaque type de source indépendant, on retient la meilleure fiabilité : " +
        s.fiabilites_retenues
          .map(
            (f) =>
              `${TYPE_SOURCE_LIBELLES[f.type_source].toLowerCase()} (${f.fiabilite}, ${formaterCentiemes(f.poids_centiemes)})`,
          )
          .join(", ") +
        ".",
    );
    lignes.push(
      s.plafonnee
        ? `Somme ${formaterCentiemes(s.somme_centiemes)}, plafonnée à ${formaterCentiemes(s.plafond_centiemes)}.`
        : `Somme ${formaterCentiemes(s.somme_centiemes)} (plafond ${formaterCentiemes(s.plafond_centiemes)}).`,
    );
  }
  if (s.contradiction_non_resolue) {
    lignes.push(
      "Une contradiction n'est pas arbitrée : l'indice est divisé par deux tant que le consultant ne l'a pas tranchée.",
    );
  } else if (s.preuves_contre > 0) {
    lignes.push("Les preuves contraires ont été arbitrées par le consultant.");
  }
  lignes.push(
    `Indice : ${formaterCentiemes(s.numerateur)} sur ${formaterCentiemes(s.denominateur)}, soit ${formaterIndice(s.indice)}.`,
  );
  lignes.push(
    `Lecture : solide à partir de ${formaterSeuil(s.seuil_solide)}, étayée à partir de ${formaterSeuil(s.seuil_etayee)}, fragile en dessous.`,
  );
  return lignes;
}

/** Cellules de la carte en lignes (dimension) × colonnes (types de source), ordre de l'API. */
export function matriceTriangulation(carte: CarteTriangulationVue) {
  const types = [...new Set(carte.cellules.map((c) => c.type_source))];
  const zones = new Set(carte.zones_non_couvertes.map((z) => `${z.dimension}/${z.type_source}`));
  return {
    types,
    lignes: carte.dimensions.map((d) => ({
      ...d,
      cellules: types.map((t) => {
        const c = carte.cellules.find((x) => x.dimension === d.code && x.type_source === t);
        return {
          type_source: t,
          preuves: c?.preuves ?? 0,
          meilleure_fiabilite: c?.meilleure_fiabilite ?? null,
          non_couverte: zones.has(`${d.code}/${t}`),
        };
      }),
    })),
  };
}

/** État de couverture d'une dimension, en texte (la couleur ne porte jamais seule le sens). */
export function etatDimension(d: { couverte: boolean; triangulee: boolean }): {
  libelle: string;
  tonalite: TonaliteStatut;
} {
  if (!d.couverte) return { libelle: "Non couverte", tonalite: "danger" };
  if (!d.triangulee) return { libelle: "Une seule source", tonalite: "attention" };
  return { libelle: "Triangulée", tonalite: "succes" };
}

export function libelleAuteur(auteur: { nom: string | null } | null | undefined): string {
  return auteur?.nom ?? "Utilisateur supprimé";
}

// --- Erreurs --------------------------------------------------------------------------------

const MESSAGES_PREUVES: Record<string, string> = {
  MISSION_CLOTUREE: "La mission est clôturée : le registre des preuves est figé.",
  DIMENSION_INCONNUE: "Une dimension choisie n'existe pas (ou plus) pour cette mission.",
  DIMENSION_EXISTANTE: "Cette dimension existe déjà pour la mission.",
  PLAFOND_ATTEINT: "Cette mission atteint le plafond d'éléments de ce registre.",
  ARBITRAGE_INVALIDE:
    "Cette contradiction n'est plus à arbitrer : la preuve a changé ou n'est plus liée « contre ». Rechargez la page.",
  PREUVE_VERSION_CONCURRENTE:
    "Une autre correction vient d'être enregistrée. Rechargez la page puis recommencez.",
  PREUVE_INCOHERENTE:
    "Le document ou la réponse liés n'appartiennent pas à cette mission, ou l'auteur choisi n'est pas valide.",
  AVIS_EXPERT_INVALIDE: "Un avis d'expert est signé par l'auteur de la version.",
};

const MESSAGE_INTROUVABLE = "Cet élément n'existe plus ou n'est pas accessible. Rechargez la page.";

export function messagePreuves(e: unknown): string {
  if (e instanceof ErreurApi) {
    const specifique = MESSAGES_PREUVES[e.code];
    if (specifique) return specifique;
    if (e.statut === 404) return MESSAGE_INTROUVABLE;
    if (e.statut === 409 || (e.statut === 400 && e.message !== "Données invalides.")) {
      return e.message;
    }
  }
  return messageErreur(e);
}

/** Après ce refus, l'écran est probablement périmé : rafraîchir les données. */
export const etatPreuvesChange = (e: unknown) =>
  e instanceof ErreurApi && (e.statut === 404 || e.statut === 409);

// --- Paramètres d'URL des listes -------------------------------------------------------------

type ParamsUrl = Record<string, string | string[] | undefined>;

const premier = (v: string | string[] | undefined): string | undefined =>
  (Array.isArray(v) ? v[0] : v) || undefined;

export interface ParametresRegistre {
  q?: string;
  type_source?: string;
  fiabilite?: string;
  dimension?: string;
  curseur?: string;
}

const TYPES_VALIDES = Object.keys(TYPE_SOURCE_LIBELLES);
const FIABILITES_VALIDES = Object.keys(FIABILITES);
const CODE_DIMENSION_URL = /^[a-z0-9_.-]{1,120}$/;

/** Paramètres du registre lus dans l'URL ; une valeur inconnue est écartée, jamais transmise. */
export function lireParametresRegistre(sp: ParamsUrl): ParametresRegistre {
  const q = premier(sp.q)?.trim().slice(0, 100);
  const type = premier(sp.type_source);
  const fiabilite = premier(sp.fiabilite);
  const dimension = premier(sp.dimension);
  const curseur = premier(sp.curseur);
  return {
    ...(q ? { q } : {}),
    ...(type && TYPES_VALIDES.includes(type) ? { type_source: type } : {}),
    ...(fiabilite && FIABILITES_VALIDES.includes(fiabilite) ? { fiabilite } : {}),
    ...(dimension && CODE_DIMENSION_URL.test(dimension) ? { dimension } : {}),
    ...(curseur && curseur.length <= 500 ? { curseur } : {}),
  };
}

function serialiser(p: Record<string, string | undefined>, extra: Record<string, string> = {}) {
  const u = new URLSearchParams();
  for (const [cle, valeur] of Object.entries({ ...p, ...extra })) {
    if (valeur) u.set(cle, valeur);
  }
  return u.toString();
}

export function requeteRegistre(p: ParametresRegistre): string {
  return serialiser({ ...p }, { limite: "30" });
}

/** Lien du registre avec les mêmes filtres et le curseur donné (`null` : début de la liste). */
export function hrefRegistreFiltre(
  missionId: string,
  p: ParametresRegistre,
  curseur: string | null,
): string {
  const filtres: Record<string, string | undefined> = { ...p, curseur: undefined };
  return hrefRegistre(missionId, serialiser(filtres, curseur ? { curseur } : {}));
}

export interface ParametresAssertions {
  q?: string;
  statut?: string;
  classe_risque?: string;
  curseur?: string;
}

const STATUTS_VALIDES = Object.keys(STATUTS_ASSERTION);
const CLASSES_VALIDES = ["R0", "R1", "R2", "R3"];

export function lireParametresAssertions(sp: ParamsUrl): ParametresAssertions {
  const q = premier(sp.q)?.trim().slice(0, 100);
  const statut = premier(sp.statut);
  const classe = premier(sp.classe_risque);
  const curseur = premier(sp.curseur);
  return {
    ...(q ? { q } : {}),
    ...(statut && STATUTS_VALIDES.includes(statut) ? { statut } : {}),
    ...(classe && CLASSES_VALIDES.includes(classe) ? { classe_risque: classe } : {}),
    ...(curseur && curseur.length <= 500 ? { curseur } : {}),
  };
}

export function requeteAssertions(p: ParametresAssertions): string {
  return serialiser({ ...p }, { limite: "30" });
}

export function hrefAssertionsFiltre(
  missionId: string,
  p: ParametresAssertions,
  curseur: string | null,
): string {
  const filtres: Record<string, string | undefined> = { ...p, curseur: undefined };
  return hrefAssertions(missionId, serialiser(filtres, curseur ? { curseur } : {}));
}
