/**
 * Référentiel de méthodes (lot STD, V3) côté web : types des réponses de l'API, libellés,
 * chemins, description en français des règles de modulation, et construction des corps de
 * requête depuis des formulaires (éditeur « sans code » : jamais de JSON brut saisi).
 * Logique pure, testée dans `methodes.test.ts`. Aucun calcul : la modulation, la cohérence
 * et la garde des dérogations sont décidées par l'API (moteurs de `packages/engines`).
 */
import {
  aPermission,
  briqueCreationSchema,
  CLASSE_RISQUE_LIBELLES,
  codeReferentielSchema,
  contexteModulationSchema,
  facteurCreationSchema,
  ETAPE_GARDE_DEROGATION_LIBELLES,
  NATURE_DEROGATION_LIBELLES,
  NIVEAU_AUTONOMIE_LIBELLES,
  ORIGINE_METHODE_LIBELLES,
  regleModulationSchema,
  type BriqueCreation,
  type ClasseRisque,
  type ComparateurModulation,
  type ConditionModulationApi,
  type ContexteModulationApi,
  type EffetModulationApi,
  type EtapeGardeDerogation,
  type FacteurCreation,
  type NatureDerogation,
  type NiveauAutonomie,
  type OrigineMethode,
  type RegleModulationApi,
  type Role,
  type StatutDerogation,
  type TypeFacteurContexte,
} from "@missionpilot/shared";
import { ErreurApi } from "./api";
import { decouperListe, lireNombre, type Resultat } from "./saisie";

// --- Types des réponses de l'API ------------------------------------------------------------

export interface MethodeResume {
  id: string;
  code: string;
  libelle: string;
  description: string | null;
  origine: OrigineMethode;
  parent_id: string | null;
  parent_libelle: string | null;
  service_code: string;
  service_libelle: string;
  derniere_publiee: { id: string; version: number; publie_le: string } | null;
  brouillon_id: string | null;
  variante_id: string | null;
}

export interface PageMethodes {
  elements: MethodeResume[];
  curseur_suivant: string | null;
}

export interface VersionResume {
  id: string;
  version: number;
  statut: "brouillon" | "publiee";
  notes_version: string | null;
  base_standard_id: string | null;
  base_standard_version: number | null;
  cree_le: string;
  publie_le: string | null;
  cree_par_nom: string | null;
  publie_par_nom: string | null;
}

export interface MethodeDetail {
  id: string;
  code: string;
  libelle: string;
  description: string | null;
  origine: OrigineMethode;
  service_libelle: string;
  parent: { id: string; libelle: string; code: string } | null;
  variante: { id: string; libelle: string } | null;
  versions: VersionResume[];
  mise_a_jour_standard: {
    base: { id: string; version: number };
    disponible: { id: string; version: number; notes_version: string | null };
  } | null;
}

export interface EtapeVersion {
  id: string;
  code: string;
  libelle: string;
  description: string | null;
  ordre: number;
}

export interface BriqueVersion {
  id: string;
  etape_id: string;
  etape_code: string;
  code: string;
  libelle: string;
  objet: string;
  entrees: string | null;
  moteur: string | null;
  agent: string | null;
  classe_risque: ClasseRisque;
  garde: string | null;
  sortie: string | null;
  definition_termine: string | null;
  temps_type_jours: number | null;
  profil_temps: string | null;
  niveau_autonomie_max: NiveauAutonomie;
  active_par_defaut: boolean;
  ordre: number;
}

export interface ElementVersion {
  id: string;
  brique_code: string | null;
  type: string;
  code: string;
  libelle: string;
  description: string | null;
  essentiel: boolean;
  actif_par_defaut: boolean;
}

export interface RubriqueVersion {
  id: string;
  brique_code: string | null;
  code: string;
  libelle: string;
  dimension: string | null;
  ancrages: {
    niveau: number;
    description: string;
    exemples: { contexte: string; texte: string }[];
  }[];
}

export interface DifferenceCollection {
  ajoutes: string[];
  retires: string[];
  modifies: { code: string; champs: string[] }[];
}

export type Differences = { identique: boolean } & Record<
  "etapes" | "briques" | "elements" | "rubriques" | "regles" | "cas_types",
  DifferenceCollection
>;

export interface VersionDetail {
  methode: {
    id: string;
    code: string;
    libelle: string;
    origine: OrigineMethode;
    cabinet_id: string | null;
  };
  version: {
    id: string;
    methode_id: string;
    version: number;
    statut: "brouillon" | "publiee";
    notes_version: string | null;
    base_standard_id: string | null;
    publie_le: string | null;
  };
  etapes: EtapeVersion[];
  briques: BriqueVersion[];
  elements: ElementVersion[];
  rubriques: RubriqueVersion[];
  regles: { id: string; code: string; regle: RegleModulationApi }[];
  cas_types: { id: string; code: string; libelle: string | null }[];
  modifiable: boolean;
  differences: {
    reference: { id: string; version: number; nature: "standard" | "precedente" };
    diff: Differences;
  } | null;
}

export interface AnomalieVersion {
  code: string;
  gravite: "erreur" | "avertissement";
  regle: string | null;
  chemin: string;
  message: string;
}

export interface ValidationVersion {
  valide: boolean;
  anomalies: AnomalieVersion[];
  cas_types: { reussi: boolean; reussis: number; echoues: number } | null;
}

export interface Facteur {
  id: string;
  code: string;
  libelle: string;
  description: string | null;
  type: TypeFacteurContexte;
  valeurs: { code: string; libelle: string }[] | null;
  min: number | null;
  max: number | null;
  porte_par: "dossier" | "mission";
  origine: "standard" | "cabinet";
}

export interface EffetApplique {
  cle: string;
  effet: EffetModulationApi;
  priorite: number;
  regles: string[];
}

export interface ResultatModulation {
  regles_declenchees: string[];
  effets: EffetApplique[];
  etat: {
    briques_actives: string[];
    classes_risque_relevees: Record<string, ClasseRisque>;
    recommandations_candidates: string[];
  };
  conflits: { cle: string; resolu: boolean; regle_retenue: string | null }[];
  journal: {
    regle: string;
    declenchee: boolean;
    active: boolean;
    effets_retenus: number;
    effets_ecartes: number;
    verifications: { facteur: string | null; lu: unknown; resultat: boolean }[];
  }[];
}

export interface Differentiel {
  identique: boolean;
  ajoutes: EffetApplique[];
  retires: EffetApplique[];
  modifies: { cle: string; avant: EffetApplique; apres: EffetApplique }[];
  regles_declenchees: string[];
  regles_eteintes: string[];
  variation_conflits_non_resolus: number;
}

export interface Simulation {
  avant: ResultatModulation;
  apres: ResultatModulation;
  differentiel: Differentiel;
}

export interface BriqueEffective extends BriqueVersion {
  active: boolean;
  origine: "methode" | "modulation" | "derogation";
  classe_risque_base: ClasseRisque;
  garde_requise: { etapes: EtapeGardeDerogation[]; quatre_yeux: boolean; signature: boolean };
  ajustements: Record<"ponderation" | "seuil" | "benchmark" | "gabarit" | "formulation", unknown>;
  adaptations: string[];
  derogations: string[];
}

export interface MethodeMission {
  liaison: {
    id: string;
    rang: number;
    evenement: "liaison" | "contexte" | "migration";
    methode_version_id: string;
    contexte: ContexteModulationApi;
    motif: string | null;
    cree_par_nom: string | null;
    cree_le: string;
  } | null;
  version?: {
    id: string;
    version: number;
    methode_id: string;
    methode_libelle: string;
    origine: OrigineMethode;
  };
  etapes?: { code: string; libelle: string; briques: BriqueEffective[] }[];
  elements?: (ElementVersion & { actif: boolean; origine: string })[];
  modulation?: ResultatModulation;
  recommandations_candidates?: string[];
  historique?: {
    id: string;
    rang: number;
    evenement: string;
    version: number;
    motif: string | null;
    cree_le: string;
    cree_par_nom: string | null;
  }[];
  mise_a_jour?: { id: string; version: number; notes_version: string | null } | null;
}

export interface Derogation {
  id: string;
  mission_id: string;
  mission_intitule?: string;
  brique_code: string;
  nature: NatureDerogation;
  description: string | null;
  motif: string;
  classe_risque: ClasseRisque;
  statut: StatutDerogation;
  demandeur_id: string;
  demandeur_nom: string | null;
  cree_le: string;
  decide_le: string | null;
  validations?: {
    etape: EtapeGardeDerogation;
    decision: string;
    acteur_nom: string | null;
    commentaire: string | null;
    cree_le: string;
  }[];
  garde?: {
    etapes_requises: EtapeGardeDerogation[];
    etapes_faites: EtapeGardeDerogation[];
    prochaine_etape: EtapeGardeDerogation | null;
  };
}

// --- Libellés --------------------------------------------------------------------------------

export const libelleOrigine = (o: OrigineMethode) => ORIGINE_METHODE_LIBELLES[o];
export const libelleClasse = (c: ClasseRisque) => `${c} · ${CLASSE_RISQUE_LIBELLES[c]}`;
export const libelleNiveau = (n: NiveauAutonomie) => `${n} · ${NIVEAU_AUTONOMIE_LIBELLES[n]}`;
export const libelleEtapeGarde = (e: EtapeGardeDerogation) => ETAPE_GARDE_DEROGATION_LIBELLES[e];
export const libelleNature = (n: NatureDerogation) => NATURE_DEROGATION_LIBELLES[n];

export const STATUT_DEROGATION: Record<
  StatutDerogation,
  { libelle: string; tonalite: "succes" | "attention" | "danger" }
> = {
  demandee: { libelle: "En attente", tonalite: "attention" },
  approuvee: { libelle: "Approuvée", tonalite: "succes" },
  refusee: { libelle: "Refusée", tonalite: "danger" },
};

export const ORIGINE_ETAT_LIBELLES = {
  methode: "Méthode",
  modulation: "Règle de contexte",
  derogation: "Dérogation",
} as const;

export const COMPARATEUR_LIBELLES: Record<ComparateurModulation, string> = {
  egal: "est",
  different: "n'est pas",
  inferieur: "est inférieur à",
  inferieur_ou_egal: "est inférieur ou égal à",
  superieur: "est supérieur à",
  superieur_ou_egal: "est supérieur ou égal à",
  dans: "est parmi",
  contient: "contient",
};

/** Comparateurs admis par type de facteur (même règle que le moteur). */
export const COMPARATEURS_PAR_TYPE: Record<TypeFacteurContexte, readonly ComparateurModulation[]> =
  {
    booleen: ["egal", "different"],
    nombre: [
      "egal",
      "different",
      "inferieur",
      "inferieur_ou_egal",
      "superieur",
      "superieur_ou_egal",
    ],
    enumeration: ["egal", "different", "dans"],
    liste: ["dans", "contient"],
  };

export const TYPES_EFFET_EDITEUR = [
  "activer_brique",
  "retirer_brique",
  "activer_item",
  "retirer_item",
  "ponderation",
  "seuil",
  "gabarit",
  "formulation",
  "benchmark",
  "recommandation_candidate",
  "relever_classe_risque",
] as const;
export type TypeEffetEditeur = (typeof TYPES_EFFET_EDITEUR)[number];

export const EFFET_LIBELLES: Record<TypeEffetEditeur, string> = {
  activer_brique: "Activer la brique",
  retirer_brique: "Retirer la brique",
  activer_item: "Activer l'item",
  retirer_item: "Retirer l'item",
  ponderation: "Pondérer",
  seuil: "Fixer le seuil de",
  gabarit: "Choisir le gabarit de",
  formulation: "Choisir la formulation de",
  benchmark: "Choisir le benchmark de",
  recommandation_candidate: "Proposer la recommandation",
  relever_classe_risque: "Relever la classe de risque de",
};

// --- Chemins ---------------------------------------------------------------------------------

export const hrefMethode = (id: string) => `/methodes/${id}`;
export const hrefVersion = (id: string) => `/methodes/versions/${id}`;
export const hrefSimulateur = (id: string) => `/methodes/versions/${id}/simulateur`;
export const hrefMissionMethode = (id: string) => `/methodes/missions/${id}`;

/** Contexte proposé depuis le dossier du client (GET /missions/:id/methode/contexte-propose). */
export interface ContexteDossierPropose {
  date: string;
  contexte: ContexteModulationApi;
  sources: {
    facteur: string;
    libelle: string;
    date_effet: string;
    fiabilite: string;
  }[];
  ecartes: { facteur: string; raison: string }[];
}

/** « Effectif au 01/06/2026, fiabilité B ; … » : provenance des valeurs pré-remplies. */
export function texteSourcesDossier(p: Pick<ContexteDossierPropose, "sources">): string {
  return p.sources
    .map((s) => {
      const [a, m, j] = s.date_effet.split("-");
      const date = a && m && j ? `${j}/${m}/${a}` : s.date_effet;
      return `${s.libelle} au ${date}${s.fiabilite ? `, fiabilité ${s.fiabilite}` : ""}`;
    })
    .join(" ; ");
}
export const cheminMethodes = (curseur?: string | null) =>
  `/api/methodes?limite=30${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ""}`;
export const hrefMethodes = (curseur?: string | null) =>
  curseur ? `/methodes?curseur=${encodeURIComponent(curseur)}` : "/methodes";

/** Curseur de pagination lu dans l'URL (chaîne courte), sinon null. */
export function lireCurseur(v: string | string[] | undefined): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= 500 ? v : null;
}

/** Sous-pages de la rubrique, selon les droits (confort d'affichage, l'API reste juge). */
export function ongletsMethodes(roles: readonly Role[]) {
  return [
    { id: "catalogue", libelle: "Catalogue", href: "/methodes" },
    ...(aPermission(roles, "mission.lire")
      ? [{ id: "missions", libelle: "Missions", href: "/methodes/missions" }]
      : []),
    { id: "derogations", libelle: "Dérogations", href: "/methodes/derogations" },
    { id: "dictionnaire", libelle: "Dictionnaire", href: "/methodes/dictionnaire" },
    { id: "comite", libelle: "Comité méthode", href: "/methodes/comite" },
  ];
}

export const peutGerer = (roles: readonly Role[]) => aPermission(roles, "standard.gerer");
export const peutDeroger = (roles: readonly Role[]) => aPermission(roles, "methode.deroger");
export const peutLier = (roles: readonly Role[]) => aPermission(roles, "mission.planifier");

// --- Description des règles ------------------------------------------------------------------

function libelleValeur(v: unknown, facteur?: Facteur): string {
  if (Array.isArray(v)) return v.map((x) => libelleValeur(x, facteur)).join(", ");
  if (typeof v === "boolean") return v ? "oui" : "non";
  if (typeof v === "string") return facteur?.valeurs?.find((x) => x.code === v)?.libelle ?? v;
  return String(v);
}

/** Condition en français (« Effectif est inférieur à 20 et … »). */
export function decrireCondition(c: ConditionModulationApi, facteurs: readonly Facteur[]): string {
  switch (c.type) {
    case "tous":
      return c.conditions.map((x) => decrireCondition(x, facteurs)).join(" et ");
    case "au_moins_un":
      return `(${c.conditions.map((x) => decrireCondition(x, facteurs)).join(" ou ")})`;
    case "non":
      return `non (${decrireCondition(c.condition, facteurs)})`;
    case "brique_active":
      return `la brique « ${c.brique} » est active`;
    case "comparaison": {
      const f = facteurs.find((x) => x.code === c.facteur);
      return `${f?.libelle ?? c.facteur} ${COMPARATEUR_LIBELLES[c.comparateur]} ${libelleValeur(c.valeur, f)}`;
    }
  }
}

/** Effet en français (« Activer la brique atelier_unique »). */
export function decrireEffet(e: EffetModulationApi): string {
  switch (e.type) {
    case "activer_brique":
    case "retirer_brique":
      return `${EFFET_LIBELLES[e.type]} « ${e.brique} »`;
    case "activer_item":
    case "retirer_item":
      return `${EFFET_LIBELLES[e.type]} « ${e.item} »`;
    case "recommandation_candidate":
      return `${EFFET_LIBELLES[e.type]} « ${e.recommandation} »`;
    case "relever_classe_risque":
      return `${EFFET_LIBELLES[e.type]} « ${e.cible} » à ${e.classe}`;
    case "ponderation":
    case "seuil":
      return `${EFFET_LIBELLES[e.type]} « ${e.cible} » : ${String(e.valeur).replace(".", ",")}`;
    default:
      return `${EFFET_LIBELLES[e.type]} « ${e.cible} » : ${e.choix}`;
  }
}

// --- Saisie d'un contexte (facteurs typés) ---------------------------------------------------

/** Valeur saisie d'un facteur : texte (nombre, énumération, oui/non), liste de codes, ou vide. */
export type SaisieContexte = Record<string, string | string[]>;

/** Saisie initiale depuis un contexte connu (contexte de la mission). */
export function saisieDepuisContexte(
  contexte: ContexteModulationApi | null | undefined,
): SaisieContexte {
  const s: SaisieContexte = {};
  for (const [code, v] of Object.entries(contexte ?? {})) {
    if (v === null || v === undefined) continue;
    s[code] = Array.isArray(v)
      ? v.map(String)
      : typeof v === "boolean"
        ? v
          ? "oui"
          : "non"
        : String(v);
  }
  return s;
}

/**
 * Saisie → contexte de l'API : facteurs vides omis (non renseignés), nombres à la française,
 * oui/non → booléen. Les erreurs sont indexées par code de facteur.
 */
export function construireContexte(
  saisie: SaisieContexte,
  facteurs: readonly Facteur[],
): Resultat<ContexteModulationApi, string> {
  const contexte: ContexteModulationApi = {};
  const erreurs: Record<string, string> = {};
  for (const f of facteurs) {
    const v = saisie[f.code];
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    if (f.type === "liste") {
      contexte[f.code] = Array.isArray(v) ? v : decouperListe(v);
    } else if (f.type === "booleen") {
      if (v !== "oui" && v !== "non") erreurs[f.code] = "Choisir oui ou non.";
      else contexte[f.code] = v === "oui";
    } else if (f.type === "nombre") {
      const n = typeof v === "string" ? lireNombre(v) : Number.NaN;
      if (n === null || Number.isNaN(n)) erreurs[f.code] = "Nombre attendu.";
      else if ((f.min !== null && n < f.min) || (f.max !== null && n > f.max)) {
        erreurs[f.code] = "Valeur hors des bornes du facteur.";
      } else contexte[f.code] = n;
    } else if (typeof v === "string") {
      if (f.valeurs && !f.valeurs.some((x) => x.code === v)) erreurs[f.code] = "Valeur inconnue.";
      else contexte[f.code] = v;
    }
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const p = contexteModulationSchema.safeParse(contexte);
  return p.success
    ? { ok: true, charge: p.data }
    : { ok: false, erreurs: { contexte: "Contexte invalide." } };
}

// --- Éditeur de règle (sans code) ------------------------------------------------------------

export interface SaisieComparaison {
  facteur: string;
  comparateur: ComparateurModulation | "";
  /** Texte saisi ; plusieurs valeurs séparées par des virgules pour « est parmi ». */
  valeur: string;
}

export interface SaisieEffet {
  type: TypeEffetEditeur;
  /** Brique, item, cible ou recommandation selon le type. */
  code: string;
  /** Choix (gabarit, formulation, benchmark), nombre (pondération, seuil) ou classe (R0–R3). */
  valeur: string;
}

export interface SaisieRegle {
  code: string;
  libelle: string;
  priorite: string;
  combinaison: "tous" | "au_moins_un";
  comparaisons: SaisieComparaison[];
  effets: SaisieEffet[];
}

export type ChampRegle = "code" | "libelle" | "priorite" | "comparaisons" | "effets";

export const saisieRegleVide = (): SaisieRegle => ({
  code: "",
  libelle: "",
  priorite: "10",
  combinaison: "tous",
  comparaisons: [{ facteur: "", comparateur: "", valeur: "" }],
  effets: [{ type: "activer_brique", code: "", valeur: "" }],
});

function valeurComparee(
  s: SaisieComparaison,
  f: Facteur,
): string | number | boolean | string[] | number[] | null {
  const brut = s.valeur.trim();
  if (brut === "") return null;
  if (f.type === "booleen") return brut === "oui" ? true : brut === "non" ? false : null;
  if (f.type === "nombre") {
    const n = lireNombre(brut);
    return n === null || Number.isNaN(n) ? null : n;
  }
  if (s.comparateur === "dans") return decouperListe(brut);
  if (f.type === "liste" && s.comparateur === "contient") {
    const l = decouperListe(brut);
    return l.length === 1 ? l[0]! : l;
  }
  return brut;
}

function effetDepuisSaisie(e: SaisieEffet): EffetModulationApi | null {
  const code = e.code.trim();
  const valeur = e.valeur.trim();
  if (!code) return null;
  switch (e.type) {
    case "activer_brique":
    case "retirer_brique":
      return { type: e.type, brique: code };
    case "activer_item":
    case "retirer_item":
      return { type: e.type, item: code };
    case "recommandation_candidate":
      return { type: e.type, recommandation: code };
    case "relever_classe_risque":
      return ["R0", "R1", "R2", "R3"].includes(valeur)
        ? { type: e.type, cible: code, classe: valeur as ClasseRisque }
        : null;
    case "ponderation":
    case "seuil": {
      const n = lireNombre(valeur);
      return n === null || Number.isNaN(n) ? null : { type: e.type, cible: code, valeur: n };
    }
    default:
      return valeur ? { type: e.type, cible: code, choix: valeur } : null;
  }
}

/** Formulaire → règle de l'API (forme du moteur), validée par le schéma partagé. */
export function construireRegle(
  s: SaisieRegle,
  facteurs: readonly Facteur[],
): Resultat<RegleModulationApi, ChampRegle> {
  const erreurs: Partial<Record<ChampRegle, string>> = {};
  if (!codeReferentielSchema.safeParse(s.code.trim()).success) {
    erreurs.code = "Code : minuscules, chiffres, « _ », « . » ou « - ».";
  }
  const priorite = Number(s.priorite);
  if (!Number.isInteger(priorite) || priorite < 0 || priorite > 1000) {
    erreurs.priorite = "Priorité entière de 0 à 1 000.";
  }
  const feuilles: ConditionModulationApi[] = [];
  for (const c of s.comparaisons) {
    const f = facteurs.find((x) => x.code === c.facteur);
    const v = f && c.comparateur ? valeurComparee(c, f) : null;
    if (
      !f ||
      !c.comparateur ||
      v === null ||
      !COMPARATEURS_PAR_TYPE[f.type].includes(c.comparateur)
    ) {
      erreurs.comparaisons = "Compléter chaque condition : facteur, comparaison et valeur.";
      continue;
    }
    feuilles.push({ type: "comparaison", facteur: f.code, comparateur: c.comparateur, valeur: v });
  }
  if (s.comparaisons.length === 0) erreurs.comparaisons = "Au moins une condition.";
  const effets = s.effets.map(effetDepuisSaisie);
  if (effets.length === 0 || effets.some((e) => e === null)) {
    erreurs.effets = "Compléter chaque effet (cible et valeur).";
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const condition: ConditionModulationApi =
    feuilles.length === 1 ? feuilles[0]! : { type: s.combinaison, conditions: feuilles };
  const p = regleModulationSchema.safeParse({
    code: s.code.trim(),
    ...(s.libelle.trim() ? { libelle: s.libelle.trim() } : {}),
    priorite,
    condition,
    effets,
  });
  if (!p.success)
    return { ok: false, erreurs: { effets: "Règle refusée : vérifier les valeurs." } };
  return { ok: true, charge: p.data };
}

// --- Éditeur de brique -----------------------------------------------------------------------

export interface SaisieBrique {
  etape_id: string;
  code: string;
  libelle: string;
  objet: string;
  entrees: string;
  moteur: string;
  agent: string;
  classe_risque: ClasseRisque;
  sortie: string;
  definition_termine: string;
  temps_type_jours: string;
  profil_temps: string;
  niveau_autonomie_max: NiveauAutonomie;
  active_par_defaut: boolean;
}

export type ChampBrique = keyof SaisieBrique;

export const saisieBriqueVide = (etapeId = ""): SaisieBrique => ({
  etape_id: etapeId,
  code: "",
  libelle: "",
  objet: "",
  entrees: "",
  moteur: "",
  agent: "",
  classe_risque: "R1",
  sortie: "",
  definition_termine: "",
  temps_type_jours: "",
  profil_temps: "",
  niveau_autonomie_max: "N1",
  active_par_defaut: true,
});

/** Niveau d'autonomie maximal admis par classe (même règle que le contrôle de cohérence). */
export const NIVEAU_MAX_PAR_CLASSE: Record<ClasseRisque, NiveauAutonomie> = {
  R0: "N4",
  R1: "N3",
  R2: "N2",
  R3: "N2",
};

export function niveauxAdmis(classe: ClasseRisque): NiveauAutonomie[] {
  const max = Number(NIVEAU_MAX_PAR_CLASSE[classe].slice(1));
  return (["N0", "N1", "N2", "N3", "N4"] as const).filter((n) => Number(n.slice(1)) <= max);
}

const vide = (v: string) => (v.trim() === "" ? null : v.trim());

export function validerBrique(s: SaisieBrique): Resultat<BriqueCreation, ChampBrique> {
  const erreurs: Partial<Record<ChampBrique, string>> = {};
  if (!s.etape_id) erreurs.etape_id = "Choisir l'étape.";
  if (!codeReferentielSchema.safeParse(s.code.trim()).success) {
    erreurs.code = "Code : minuscules, chiffres, « _ », « . » ou « - ».";
  }
  if (!s.libelle.trim()) erreurs.libelle = "Libellé obligatoire.";
  if (!s.objet.trim()) erreurs.objet = "Décrire l'objet de la brique.";
  const temps = s.temps_type_jours.trim() === "" ? null : lireNombre(s.temps_type_jours);
  if (
    temps !== null &&
    (Number.isNaN(temps) || temps < 0 || temps > 1000 || (temps * 4) % 1 !== 0)
  ) {
    erreurs.temps_type_jours = "Jours, par quart de jour (ex. 0,25 ou 1,5).";
  }
  if (!niveauxAdmis(s.classe_risque).includes(s.niveau_autonomie_max)) {
    erreurs.niveau_autonomie_max = `Classe ${s.classe_risque} : ${NIVEAU_MAX_PAR_CLASSE[s.classe_risque]} au plus.`;
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const p = briqueCreationSchema.safeParse({
    etape_id: s.etape_id,
    code: s.code.trim(),
    libelle: s.libelle.trim(),
    objet: s.objet.trim(),
    entrees: vide(s.entrees),
    moteur: vide(s.moteur),
    agent: vide(s.agent),
    classe_risque: s.classe_risque,
    sortie: vide(s.sortie),
    definition_termine: vide(s.definition_termine),
    temps_type_jours: temps,
    profil_temps: vide(s.profil_temps),
    niveau_autonomie_max: s.niveau_autonomie_max,
    active_par_defaut: s.active_par_defaut,
  });
  if (!p.success) return { ok: false, erreurs: { code: "Brique refusée : vérifier les champs." } };
  return { ok: true, charge: p.data };
}

/** Libellé → code de référentiel proposé (« Atelier de restitution » → atelier_de_restitution). */
export function codeDepuisLibelle(libelle: string): string {
  return libelle
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

// --- Lecture de la méthode -------------------------------------------------------------------

/** Briques regroupées par étape, dans l'ordre de la méthode. */
export function briquesParEtape(v: Pick<VersionDetail, "etapes" | "briques">) {
  return [...v.etapes]
    .sort((a, b) => a.ordre - b.ordre || a.code.localeCompare(b.code))
    .map((e) => ({
      etape: e,
      briques: v.briques
        .filter((b) => b.etape_id === e.id)
        .sort((a, b) => a.ordre - b.ordre || a.code.localeCompare(b.code)),
    }));
}

const COLLECTION_LIBELLES = {
  etapes: "Étapes",
  briques: "Briques",
  elements: "Éléments",
  rubriques: "Rubriques",
  regles: "Règles",
  cas_types: "Cas types",
} as const;

/** Différences lisibles : une ligne par collection touchée. */
export function resumeDifferences(d: Differences): string[] {
  if (d.identique) return [];
  return (Object.keys(COLLECTION_LIBELLES) as (keyof typeof COLLECTION_LIBELLES)[])
    .filter((c) => d[c].ajoutes.length + d[c].retires.length + d[c].modifies.length > 0)
    .map((c) => {
      const parts = [
        d[c].ajoutes.length ? `ajoutés : ${d[c].ajoutes.join(", ")}` : null,
        d[c].retires.length ? `retirés : ${d[c].retires.join(", ")}` : null,
        d[c].modifies.length ? `modifiés : ${d[c].modifies.map((m) => m.code).join(", ")}` : null,
      ].filter(Boolean);
      return `${COLLECTION_LIBELLES[c]} — ${parts.join(" ; ")}`;
    });
}

/** Messages propres aux codes d'erreur du référentiel (sinon message générique de l'API). */
export function messageMethodes(e: unknown): string | null {
  if (!(e instanceof ErreurApi)) return null;
  switch (e.code) {
    case "STANDARD_LECTURE_SEULE":
      return "Le standard MissionPilot ne se modifie pas : créez la variante du cabinet.";
    case "VERSION_PUBLIEE":
      return "Cette version est publiée : créez une nouvelle version pour la modifier.";
    case "VERSION_INCOHERENTE":
    case "NOTES_VERSION_REQUISES":
    case "CONTEXTE_INVALIDE":
    case "ETAPE_INATTENDUE":
    case "SEPARATION_DES_TACHES":
      return e.message;
    case "VARIANTE_EXISTANTE":
      return "Le cabinet a déjà une variante de cette méthode.";
    case "METHODE_DEJA_LIEE":
      return "La mission a déjà une méthode : changez son contexte ou migrez-la.";
    default:
      return null;
  }
}

// --- Dictionnaire : facteur du cabinet --------------------------------------------------------

export interface SaisieFacteur {
  code: string;
  libelle: string;
  type: TypeFacteurContexte;
  /** Une valeur par ligne : « code : libellé » (énumération ou liste). */
  valeurs: string;
  min: string;
  max: string;
  porte_par: "dossier" | "mission";
}

export type ChampFacteur = "code" | "libelle" | "valeurs" | "min" | "max";

export const saisieFacteurVide = (): SaisieFacteur => ({
  code: "",
  libelle: "",
  type: "enumeration",
  valeurs: "",
  min: "",
  max: "",
  porte_par: "mission",
});

/** Formulaire → corps de `POST /api/standard/facteurs`, validé par le schéma partagé. */
export function construireFacteur(s: SaisieFacteur): Resultat<FacteurCreation, ChampFacteur> {
  const erreurs: Partial<Record<ChampFacteur, string>> = {};
  if (!codeReferentielSchema.safeParse(s.code.trim()).success) erreurs.code = "Code invalide.";
  if (!s.libelle.trim()) erreurs.libelle = "Libellé obligatoire.";
  const avecValeurs = s.type === "enumeration" || s.type === "liste";
  const valeurs = s.valeurs
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .map((l) => {
      const [code, ...reste] = l.split(":");
      const c = (code ?? "").trim();
      return { code: c, libelle: reste.join(":").trim() || c };
    });
  if (
    avecValeurs &&
    (valeurs.length === 0 || valeurs.some((v) => !codeReferentielSchema.safeParse(v.code).success))
  ) {
    erreurs.valeurs = "Une valeur par ligne, « code : libellé », code en minuscules.";
  }
  const borne = (v: string) => (v.trim() === "" ? null : lireNombre(v));
  const min = s.type === "nombre" ? borne(s.min) : null;
  const max = s.type === "nombre" ? borne(s.max) : null;
  if (min !== null && Number.isNaN(min)) erreurs.min = "Nombre attendu.";
  if (max !== null && Number.isNaN(max)) erreurs.max = "Nombre attendu.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const p = facteurCreationSchema.safeParse({
    code: s.code.trim(),
    libelle: s.libelle.trim(),
    type: s.type,
    porte_par: s.porte_par,
    ...(avecValeurs ? { valeurs } : {}),
    ...(min !== null ? { min } : {}),
    ...(max !== null ? { max } : {}),
  });
  if (!p.success)
    return {
      ok: false,
      erreurs: { valeurs: "Facteur refusé : vérifier les valeurs et les bornes." },
    };
  return { ok: true, charge: p.data };
}
