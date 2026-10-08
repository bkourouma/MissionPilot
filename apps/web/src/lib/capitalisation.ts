import {
  aPermission,
  LONGUEUR_SECTION_RETOUR_MAX,
  NIVEAU_COMPETENCE_LIBELLES,
  SECTIONS_RETOUR,
  TYPE_RESULTAT_LIBELLES,
  TYPES_RESULTAT_RECHERCHE,
  type OrigineRetour,
  type Permission,
  type RetourVersion,
  type Role,
  type SectionRetour,
  type TypeResultatRecherche,
} from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import type { Resultat } from "./saisie";

/**
 * Rubrique « Connaissances » (capitalisation, PRD complémentaire §12) : types des réponses de
 * l'API, sous-pages, libellés, surlignage des résultats de recherche et lecture des saisies.
 * Aucun calcul : médianes, écarts, effectifs et niveaux viennent de l'API (moteurs purs).
 */

/* ----- Types des réponses ----- */

export interface ResultatRecherche {
  type: TypeResultatRecherche;
  id: string;
  titre: string;
  extrait: string | null;
  mission_id: string;
  mission_intitule: string;
  date: string;
}

export interface ReponseRecherche {
  q: string;
  par_type: Partial<Record<TypeResultatRecherche, { nombre: number; tronque: boolean }>>;
  elements: ResultatRecherche[];
}

export interface RetourResume {
  id: string;
  mission_id: string;
  mission_intitule: string;
  client: string;
  statut: "brouillon" | "valide";
  version_validee: number | null;
  valide_le: string | null;
  ouvert_le: string;
}

export type StatutContenu = "brouillon_ia" | "modifie" | "valide";

export interface VersionRetour extends RetourVersion {
  version: number;
  origine: OrigineRetour;
  statut_contenu: StatutContenu;
  chiffres_non_verifies: boolean;
  cree_par_nom: string | null;
  cree_le: string;
}

export interface RetourDetail {
  id: string;
  mission_id: string;
  statut: "brouillon" | "valide";
  version_validee: number | null;
  valide_le: string | null;
  ouvert_le: string;
  mission: { id: string; intitule: string; statut: string; client: string };
  version_courante: VersionRetour | null;
  version_validee_contenu: VersionRetour | null;
  historique: {
    version: number;
    origine: OrigineRetour;
    statut_contenu: StatutContenu;
    cree_par_nom: string | null;
    cree_le: string;
  }[];
}

export type NiveauEstimation = "contexte" | "brique" | "insuffisant";

export interface EstimationBrique {
  brique_code: string;
  niveau: NiveauEstimation;
  /** Absent (null) sous l'effectif minimum : jamais divulgué. */
  effectif_contexte: number | null;
  effectif_brique: number | null;
  facteurs_appliques: string[];
  /** Quartiles et extrêmes : null sous cinq observations. */
  resume: {
    effectif: number;
    min: number | null;
    q1: number | null;
    mediane: number;
    q3: number | null;
    max: number | null;
    atypiques: number | null;
  } | null;
  libelles: { mediane: string; q1: string | null; q3: string | null } | null;
}

export interface ReponseEstimation {
  effectif_minimum: number;
  tronque: boolean;
  elements: EstimationBrique[];
}

export interface GroupeDerogationsVue {
  cle: string;
  methode_code: string | null;
  brique_code: string;
  nature: string;
  missions: number;
  derogations: number;
  approuvees: number;
  refusees: number;
  demandees: number;
  motifs_visibles: number;
  mots_cles: { mot: string; occurrences: number }[];
  motifs: { representant: string; effectif: number }[];
  au_dessus_du_seuil: boolean;
  proposition: { id: string; statut: string; titre: string } | null;
}

export interface Competence {
  id: string;
  code: string;
  libelle: string;
  description: string | null;
  briques: string[];
  types_livrable: string[];
  active: boolean;
}

export interface CelluleCompetence {
  competence_id: string;
  niveau_valide: number | null;
  niveau_valide_le: string | null;
  niveau_en_attente: number | null;
  declaration_en_attente_id: string | null;
  /** Preuves, temps et dernier usage : absents de la matrice sans `budget.lire_jours`. */
  preuves?: number;
  centiemes?: number;
  jours?: string;
  derniere_preuve?: string | null;
  a_revoir: boolean;
}

export interface MatriceCompetences {
  competences: { id: string; code: string; libelle: string }[];
  lignes: {
    collaborateur: { id: string; nom: string; grade: string | null };
    cellules: CelluleCompetence[];
  }[];
}

/* ----- Sous-pages et droits ----- */

export interface SousPageConnaissances {
  id: string;
  libelle: string;
  href: string;
  permission: Permission;
  /** Seconde permission exigée en plus (l'estimation donne des jours : `budget.lire_jours`). */
  aussi?: Permission;
}

export const SOUS_PAGES_CONNAISSANCES: readonly SousPageConnaissances[] = [
  {
    id: "recherche",
    libelle: "Recherche",
    href: "/connaissances",
    permission: "connaissance.lire",
  },
  {
    id: "retours",
    libelle: "Retours d'expérience",
    href: "/connaissances/retours",
    permission: "connaissance.lire",
  },
  {
    id: "estimation",
    libelle: "Estimation",
    href: "/connaissances/estimation",
    permission: "connaissance.lire",
    aussi: "budget.lire_jours",
  },
  {
    id: "competences",
    libelle: "Compétences",
    href: "/connaissances/competences",
    permission: "temps.saisir",
  },
  {
    id: "derogations",
    libelle: "Évolutions du standard",
    href: "/connaissances/derogations",
    permission: "standard.gerer",
  },
];

/** Permissions dont l'une ouvre la rubrique. */
export const PERMISSIONS_RUBRIQUE: readonly Permission[] = [
  "connaissance.lire",
  "competence.lire",
  "competence.gerer",
  "standard.gerer",
];

export function sousPagesConnaissances(roles: readonly Role[]): SousPageConnaissances[] {
  return SOUS_PAGES_CONNAISSANCES.filter(
    (p) => aPermission(roles, p.permission) && (!p.aussi || aPermission(roles, p.aussi)),
  );
}

/** Droits d'affichage (l'API reste la source de vérité). */
export function droitsConnaissances(roles: readonly Role[]) {
  return {
    lire: aPermission(roles, "connaissance.lire"),
    rediger: aPermission(roles, "mission.planifier"),
    ia: aPermission(roles, "ia.utiliser"),
    matrice: aPermission(roles, "competence.lire"),
    /** Jours et preuves d'usage de la matrice : en plus, `budget.lire_jours` (FIN-02). */
    matriceJours: aPermission(roles, "competence.lire") && aPermission(roles, "budget.lire_jours"),
    gererCompetences: aPermission(roles, "competence.gerer"),
    comiteMethode: aPermission(roles, "standard.gerer"),
  };
}

/* ----- Libellés ----- */

export const libelleTypeResultat = (t: TypeResultatRecherche) => TYPE_RESULTAT_LIBELLES[t];

const ORIGINES: Record<OrigineRetour, string> = {
  gabarit: "Brouillon automatique",
  ia: "Brouillon IA",
  humain: "Rédaction",
};
export const libelleOrigine = (o: OrigineRetour) => ORIGINES[o];

const STATUTS_CONTENU: Record<StatutContenu, string> = {
  brouillon_ia: "Brouillon à relire",
  modifie: "Modifié",
  valide: "Validé",
};
export const libelleStatutContenu = (s: StatutContenu) => STATUTS_CONTENU[s];

export function tonaliteStatutRetour(statut: RetourDetail["statut"]): "succes" | "attention" {
  return statut === "valide" ? "succes" : "attention";
}

const SECTIONS: Record<SectionRetour, string> = {
  contexte: "Contexte",
  methode: "Méthode",
  ecarts: "Écarts",
  lecons: "Leçons",
};
export const libelleSection = (s: SectionRetour) => SECTIONS[s];

const NIVEAUX_ESTIMATION: Record<NiveauEstimation, string> = {
  contexte: "Missions du même contexte",
  brique: "Toutes les missions de la brique",
  insuffisant: "Historique insuffisant",
};
export const libelleNiveauEstimation = (n: NiveauEstimation) => NIVEAUX_ESTIMATION[n];

const NATURES: Record<string, string> = {
  retirer_brique: "Retrait",
  activer_brique: "Activation",
  adapter_brique: "Adaptation",
};
export const libelleNature = (n: string) => NATURES[n] ?? n;

export function libelleNiveauCompetence(n: number | null): string {
  if (n === null) return "—";
  return `${n} · ${NIVEAU_COMPETENCE_LIBELLES[n] ?? "?"}`;
}

/* ----- Recherche ----- */

const sansAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export interface Segment {
  texte: string;
  surligne: boolean;
}

/**
 * Découpe un texte en segments dont ceux qui commencent par un mot de la requête (sans tenir
 * compte des accents ni de la casse) sont surlignés : rendu en nœuds texte, jamais en HTML.
 */
export function segmentsSurlignes(texte: string, q: string): Segment[] {
  const mots = [
    ...new Set(
      sansAccents(q)
        .split(/[^a-z0-9]+/)
        .filter((m) => m.length >= 2),
    ),
  ];
  if (mots.length === 0 || texte === "") return texte === "" ? [] : [{ texte, surligne: false }];
  const normal = sansAccents(texte);
  // La normalisation garde la longueur caractère par caractère pour le français courant ;
  // sinon, pas de surlignage plutôt qu'un découpage faux.
  if (normal.length !== texte.length) return [{ texte, surligne: false }];
  const segments: Segment[] = [];
  const re = /[a-z0-9]+/g;
  let curseur = 0;
  for (let m = re.exec(normal); m; m = re.exec(normal)) {
    if (!mots.some((x) => m![0].startsWith(x))) continue;
    if (m.index > curseur) segments.push({ texte: texte.slice(curseur, m.index), surligne: false });
    segments.push({ texte: texte.slice(m.index, m.index + m[0].length), surligne: true });
    curseur = m.index + m[0].length;
  }
  if (curseur < texte.length) segments.push({ texte: texte.slice(curseur), surligne: false });
  return segments;
}

/** Lien d'un résultat vers son écran. */
export function hrefResultat(r: Pick<ResultatRecherche, "type" | "id" | "mission_id">): string {
  if (r.type === "connaissance") return `/connaissances/retours/${encodeURIComponent(r.id)}`;
  return `/missions/${encodeURIComponent(r.mission_id)}`;
}

export interface CritereRecherche {
  q: string;
  types: TypeResultatRecherche[];
}

/** Paramètres de la page de recherche → critères valides (requête vide si trop courte). */
export function lireCritereRecherche(
  params: Record<string, string | string[] | undefined>,
): CritereRecherche {
  const brut = typeof params.q === "string" ? params.q.trim().slice(0, 200) : "";
  const brutTypes = Array.isArray(params.types) ? params.types : [params.types ?? ""];
  const t = brutTypes.flatMap((x) => x.split(","));
  const types = TYPES_RESULTAT_RECHERCHE.filter((x) => t.includes(x));
  return { q: brut.length >= 2 ? brut : "", types };
}

export function cheminRecherche(c: CritereRecherche, limite = 10): string {
  const p = new URLSearchParams({ q: c.q, limite: String(limite) });
  if (c.types.length > 0) p.set("types", c.types.join(","));
  return `/api/capitalisation/recherche?${p}`;
}

/* ----- Retours : pagination ----- */

export function lireCurseurRetours(v: string | string[] | undefined): string | null {
  return typeof v === "string" && v !== "" && v.length <= 500 ? v : null;
}

export function cheminRetours(curseur: string | null, limite = 30): string {
  const q = new URLSearchParams({ limite: String(limite) });
  if (curseur) q.set("curseur", curseur);
  return `/api/capitalisation/retours?${q}`;
}

export const hrefRetours = (curseur: string | null) =>
  curseur
    ? `/connaissances/retours?curseur=${encodeURIComponent(curseur)}`
    : "/connaissances/retours";

/* ----- Lecture des saisies ----- */

export function lireVersionRetour(
  s: Record<SectionRetour, string>,
): Resultat<RetourVersion, SectionRetour> {
  const erreurs: Partial<Record<SectionRetour, string>> = {};
  const charge = {} as RetourVersion;
  for (const k of SECTIONS_RETOUR) {
    const v = s[k].trim();
    if (v === "") erreurs[k] = "Cette section est obligatoire.";
    else if (v.length > LONGUEUR_SECTION_RETOUR_MAX)
      erreurs[k] = `${LONGUEUR_SECTION_RETOUR_MAX} caractères au plus.`;
    charge[k] = v;
  }
  return Object.keys(erreurs).length > 0 ? { ok: false, erreurs } : { ok: true, charge };
}

const CODE = /^[a-z0-9_.-]{1,120}$/;

/** « a, b ; c » → codes de brique valides, sans doublon. */
export function lireCodes(v: string): { codes: string[]; invalides: string[] } {
  const elements = [
    ...new Set(
      v
        .split(/[,;\s]+/)
        .map((x) => x.trim())
        .filter((x) => x !== ""),
    ),
  ];
  return {
    codes: elements.filter((x) => CODE.test(x)),
    invalides: elements.filter((x) => !CODE.test(x)),
  };
}

export function lireEstimation(s: {
  briques: string;
  effectif: string;
}): Resultat<{ briques: string[]; effectif_minimum?: number }, "briques" | "effectif"> {
  const { codes, invalides } = lireCodes(s.briques);
  if (invalides.length > 0) {
    return { ok: false, erreurs: { briques: `Codes invalides : ${invalides.join(", ")}.` } };
  }
  if (codes.length === 0)
    return { ok: false, erreurs: { briques: "Indiquez au moins une brique." } };
  if (codes.length > 100) return { ok: false, erreurs: { briques: "100 briques au plus." } };
  if (s.effectif.trim() === "") return { ok: true, charge: { briques: codes } };
  const n = Number(s.effectif.trim());
  if (!Number.isInteger(n) || n < 3 || n > 20) {
    return { ok: false, erreurs: { effectif: "Un entier de 3 à 20." } };
  }
  return { ok: true, charge: { briques: codes, effectif_minimum: n } };
}

export function lireCompetence(s: {
  code: string;
  libelle: string;
  briques: string;
}): Resultat<{ code: string; libelle: string; briques: string[] }, "code" | "libelle" | "briques"> {
  const erreurs: Partial<Record<"code" | "libelle" | "briques", string>> = {};
  const code = s.code.trim();
  const libelle = s.libelle.trim();
  if (!CODE.test(code)) erreurs.code = "Minuscules, chiffres, point, tiret ou tiret bas.";
  if (libelle === "" || libelle.length > 200) erreurs.libelle = "Libellé de 1 à 200 caractères.";
  const { codes, invalides } = lireCodes(s.briques);
  if (invalides.length > 0) erreurs.briques = `Codes invalides : ${invalides.join(", ")}.`;
  if (codes.length > 50) erreurs.briques = "50 briques au plus.";
  return Object.keys(erreurs).length > 0
    ? { ok: false, erreurs }
    : { ok: true, charge: { code, libelle, briques: codes } };
}

export function lireNiveau(v: string): Resultat<{ niveau: number }, "niveau"> {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 4
    ? { ok: true, charge: { niveau: n } }
    : { ok: false, erreurs: { niveau: "Choisissez un niveau de 1 à 4." } };
}

const MESSAGES: Record<string, string> = {
  MISSION_NON_CLOTUREE: "Le retour d'expérience s'ouvre à la clôture de la mission.",
  RETOUR_VALIDE: "Ce retour d'expérience est validé : il ne change plus.",
  CHIFFRES_A_ACQUITTER:
    "Des nombres de cette version ne viennent pas des moteurs : relisez-les, puis cochez l'acquittement.",
  SEPARATION_DES_TACHES:
    "Un niveau ne se valide ni par la personne évaluée, ni par son déclarant (sauf associé).",
  PROPOSITION_EXISTANTE: "Une proposition est déjà soumise au comité méthode pour ce groupe.",
  SEUIL_NON_ATTEINT: "Ce groupe n'atteint pas le seuil de fréquence.",
  COLLABORATEUR_NON_RATTACHE: "Votre compte n'est rattaché à aucune fiche collaborateur.",
  COMPETENCE_EXISTANTE: "Une compétence porte déjà ce code.",
  DECLARATION_DECIDEE: "Cette déclaration a déjà été décidée.",
  DECLARATION_EN_ATTENTE: "Une déclaration est déjà en attente de décision pour cette compétence.",
  PLAFOND_DECLARATIONS: "Au plus 50 déclarations par compétence et par collaborateur.",
  VALIDATION_RESERVEE:
    "Le retour d'expérience se valide par un associé, le chef ou le directeur de la mission.",
  TROP_DE_RECHERCHES: "Trop de recherches à la suite : réessayez dans un instant.",
};

export function messageCapitalisation(e: unknown): string {
  if (e instanceof ErreurApi && MESSAGES[e.code]) return MESSAGES[e.code] as string;
  return messageErreur(e);
}
