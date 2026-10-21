/**
 * Groupes et filiales du dossier client (DOS-05, côté web) : logique pure de l'écran « Groupe »,
 * testée dans `dossier-groupes.test.ts`. Ces fonctions mettent en forme et valident des saisies ;
 * elles ne calculent aucun chiffre métier (structure de détention et consolidation sortent du
 * moteur `packages/engines/src/dossier/groupe.ts` par l'API). Un pourcentage affiché est
 * simplement des points de base divisés par 100 (10 000 points de base = 100 %).
 */
import {
  MOTIF_DETENTION_MAX,
  MOTIF_EXCLUSION_GROUPE_LIBELLES,
  participationCreationSchema,
  type IndicateurGroupe,
  type MotifExclusionGroupe,
  type VueGroupe,
} from "@missionpilot/shared";
import { formaterMontantMineur, formaterNombre, VALEUR_ABSENTE, type Devise } from "./format";
import { lireNombre, texteOuNull, type Resultat } from "./saisie";

// --- Types renvoyés par l'API ------------------------------------------------------------

/** Noeud de la structure : anonyme (ni identifiant ni nom) si le dossier n'est pas visible. */
export interface NoeudGroupe {
  visible: boolean;
  id?: string;
  nom?: string;
  niveau: number;
  part_directe_bps?: number | null;
  part_cumulee_bps: number;
}

export interface LienGroupe {
  detenteur_id: string;
  filiale_id: string;
  points_base: number;
  date_effet: string;
}

export interface IndicateursConsolides {
  actif: number | null;
  passif: number | null;
  charges: number | null;
  produits: number | null;
  resultat: number | null;
  marge_nette_bps: number | null;
}

export interface ExclusGroupe {
  id?: string;
  nom?: string;
  motif: MotifExclusionGroupe;
  motif_libelle: string;
}

export interface InclusGroupe {
  id: string;
  nom: string;
  part_cumulee_bps: number;
  controlee: boolean;
}

export interface ConsolidationApi {
  devise: Devise | null;
  exercice: number | null;
  partielle: boolean;
  /** Entités converties dans la devise de la racine (parité fixe XOF/XAF/EUR). */
  conversions?: { id: string; nom: string; de: string; vers: string }[];
  perimetre: { inclus: InclusGroupe[]; exclus: ExclusGroupe[] };
  integrale: IndicateursConsolides;
  proportionnelle: IndicateursConsolides;
  fiabilite: { moyenne_ponderee: number | null; ponderation: "part_cumulee" };
}

export interface ReglesGroupe {
  seuil_controle_points: number;
  base_points: number;
  profondeur_max: number;
  ponderation_fiabilite: string;
  conversion_devise: boolean;
  textes: string[];
}

export interface StructureGroupe {
  racine: NoeudGroupe;
  tete: NoeudGroupe;
  detenteurs: NoeudGroupe[];
  filiales: NoeudGroupe[];
  arbre_tete: NoeudGroupe[] | null;
  liens: LienGroupe[];
}

export interface GroupeApi {
  date: string;
  vue: VueGroupe;
  exercice: number | null;
  client: { id: string; nom: string };
  avertissement: string;
  regles: ReglesGroupe;
  indicateurs: Record<IndicateurGroupe, string>;
  structure: StructureGroupe;
  consolidation: ConsolidationApi;
}

export type PartieParticipation = { visible: true; id: string; nom: string } | { visible: false };

export interface ParticipationApi {
  id: string;
  detenteur: PartieParticipation;
  filiale: PartieParticipation;
  points_base: number;
  date_effet: string;
  fin_de_detention: boolean;
  motif: string | null;
  cree_par: { id: string; nom: string };
  cree_le: string;
}

const NBSP = String.fromCharCode(0xa0);
const NNBSP = String.fromCharCode(0x202f);

// --- Libellés ----------------------------------------------------------------------------

export const AVERTISSEMENT_GROUPE = "Lecture indicative, pas une consolidation comptable légale";
export const LIBELLE_NON_VISIBLE = "Dossier non visible avec vos droits";

export const LIBELLES_VUES: Record<VueGroupe, string> = {
  tete: "Depuis la société de tête",
  client: "Depuis ce dossier",
};

export function libelleMotifExclusion(motif: MotifExclusionGroupe): string {
  return MOTIF_EXCLUSION_GROUPE_LIBELLES[motif] ?? motif;
}

/** Nom d'un noeud ou d'une partie ; un dossier non visible n'a jamais de nom. */
export function libelleNoeud(n: { visible: boolean; nom?: string }): string {
  return n.visible && n.nom ? n.nom : LIBELLE_NON_VISIBLE;
}

export function libellePartie(p: PartieParticipation): string {
  return p.visible ? p.nom : LIBELLE_NON_VISIBLE;
}

// --- Dates ---------------------------------------------------------------------------------

const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Date valide AAAA-MM-JJ (jour calendaire existant) ? */
export function estDateIso(v: string): boolean {
  const m = DATE_ISO.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === v;
}

/** « 2026-10-20 » → « 20/10/2026 » ; « — » si absente ou invalide. */
export function formaterDateJour(v: string | null | undefined): string {
  if (!v) return VALEUR_ABSENTE;
  const m = DATE_ISO.exec(v.slice(0, 10));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : VALEUR_ABSENTE;
}

// --- Points de base <-> pourcentage -------------------------------------------------------

/** 3333 → 33,33 ; 10000 → 100. */
export function pointsVersPourcentage(points: number): number {
  return points / 100;
}

/** Part affichée : 6000 → « 60 % », 3333 → « 33,33 % », null → « — ». Espace insécable avant « % ». */
export function formaterPart(points: number | null | undefined): string {
  if (typeof points !== "number" || !Number.isFinite(points)) return VALEUR_ABSENTE;
  return `${formaterNombre(pointsVersPourcentage(points), 2)}${NBSP}%`;
}

/** Valeur à remettre dans un champ de saisie : 3333 → « 33,33 ». */
export function pointsVersSaisie(points: number): string {
  return formaterNombre(pointsVersPourcentage(points), 2).replace(/\s/g, "");
}

export const MESSAGE_POURCENTAGE =
  "Pourcentage attendu entre 0 et 100, avec au plus deux décimales (ex. 33,33).";

/** Pourcentage saisi (« 33,33 », « 60 % ») → points de base entiers, ou message d'erreur. */
export function lirePourcentage(
  saisie: string,
): { ok: true; points: number } | { ok: false; erreur: string } {
  const n = lireNombre(saisie.replace(/%/g, ""));
  if (n === null) return { ok: false, erreur: "Indiquez le pourcentage détenu." };
  if (Number.isNaN(n) || n < 0 || n > 100) return { ok: false, erreur: MESSAGE_POURCENTAGE };
  const points = Math.round(n * 100);
  if (Math.abs(n * 100 - points) > 1e-6) return { ok: false, erreur: MESSAGE_POURCENTAGE };
  return { ok: true, points };
}

// --- Montants et indicateurs -----------------------------------------------------------------

/** Valeur d'un indicateur : montant en unités mineures de la devise du groupe, ou marge en %. */
export function formaterIndicateur(
  cle: IndicateurGroupe,
  valeurs: IndicateursConsolides,
  devise: Devise | null,
): string {
  if (cle === "marge_nette") return formaterPart(valeurs.marge_nette_bps);
  return devise === null ? VALEUR_ABSENTE : formaterMontantMineur(valeurs[cle], devise);
}

export interface LigneIndicateur {
  cle: IndicateurGroupe;
  libelle: string;
  valeur: string;
}

const ORDRE_INDICATEURS: readonly IndicateurGroupe[] = [
  "actif",
  "passif",
  "charges",
  "produits",
  "resultat",
  "marge_nette",
];

/** Lignes d'un tableau de consolidation (six indicateurs, montants formatés). */
export function lignesIndicateurs(
  valeurs: IndicateursConsolides,
  devise: Devise | null,
  libelles: Record<IndicateurGroupe, string>,
): LigneIndicateur[] {
  return ORDRE_INDICATEURS.map((cle) => ({
    cle,
    libelle: libelles[cle],
    valeur: formaterIndicateur(cle, valeurs, devise),
  }));
}

/** Indice de fiabilité pondéré (0..1000) → « 640 sur 1 000 ». */
export function formaterFiabiliteGroupe(points: number | null): string {
  return points === null ? VALEUR_ABSENTE : `${formaterNombre(points, 0)} sur 1${NNBSP}000`;
}

export function libelleControle(controlee: boolean): string {
  return controlee
    ? "Contrôlée (part cumulée supérieure à 50 %)"
    : "Non contrôlée (comptée seulement en proportionnelle)";
}

// --- Arbre --------------------------------------------------------------------------------

export interface LigneArbre {
  cle: string;
  noeud: NoeudGroupe;
  /** Profondeur d'indentation (0 = première ligne du bloc). */
  profondeur: number;
  libelle: string;
  estDossier: boolean;
}

export interface BlocArbre {
  id: "detenteurs" | "dossier" | "filiales" | "tete";
  titre: string;
  lignes: LigneArbre[];
}

function trier(noeuds: readonly NoeudGroupe[]): NoeudGroupe[] {
  return [...noeuds].sort(
    (a, b) =>
      a.niveau - b.niveau ||
      b.part_cumulee_bps - a.part_cumulee_bps ||
      libelleNoeud(a).localeCompare(libelleNoeud(b), "fr"),
  );
}

function ligne(n: NoeudGroupe, i: number, profondeur: number, clientId: string): LigneArbre {
  return {
    cle: `${n.id ?? "anonyme"}-${n.niveau}-${i}`,
    noeud: n,
    profondeur,
    libelle: libelleNoeud(n),
    estDossier: n.visible && n.id === clientId,
  };
}

/**
 * Aplatit la structure en blocs lisibles, indentés selon le niveau. Vue « tête » : la société de
 * tête puis tout son arbre ; vue « dossier » : détenteurs (au-dessus), dossier, filiales.
 */
export function aplatirStructure(g: GroupeApi): BlocArbre[] {
  const s = g.structure;
  const clientId = g.client.id;
  if (g.vue === "tete" && s.arbre_tete) {
    const tete: NoeudGroupe = { ...s.tete, niveau: 0 };
    const noeuds = [tete, ...trier(s.arbre_tete)];
    return [
      {
        id: "tete",
        titre: "Structure du groupe depuis la société de tête",
        lignes: noeuds.map((n, i) => ligne(n, i, n.niveau, clientId)),
      },
    ];
  }
  const blocs: BlocArbre[] = [];
  if (s.detenteurs.length > 0) {
    blocs.push({
      id: "detenteurs",
      titre: "Détenteurs (au-dessus du dossier)",
      lignes: trier(s.detenteurs)
        .reverse()
        .map((n, i) => ligne(n, i, 0, clientId)),
    });
  }
  blocs.push({
    id: "dossier",
    titre: "Ce dossier",
    lignes: [ligne({ ...s.racine, id: clientId, nom: g.client.nom }, 0, 0, clientId)],
  });
  if (s.filiales.length > 0) {
    blocs.push({
      id: "filiales",
      titre: "Filiales (en dessous du dossier)",
      lignes: trier(s.filiales).map((n, i) => ligne(n, i, Math.max(0, n.niveau - 1), clientId)),
    });
  }
  return blocs;
}

// --- Participations en vigueur --------------------------------------------------------------

export interface ParticipationActive {
  id: string;
  detenteurId: string;
  detenteurNom: string;
  filialeId: string;
  filialeNom: string;
  points: number;
}

/**
 * Participations en vigueur à la date (dernier enregistrement de chaque paire dont la date
 * d'effet est antérieure ou égale, départagé par la date de saisie), hors fin de détention et
 * hors parties non visibles. Sélection d'affichage : le moteur reste seul juge côté API.
 */
export function participationsActives(
  historique: readonly ParticipationApi[],
  date: string,
): ParticipationActive[] {
  const retenues = new Map<string, ParticipationApi>();
  for (const p of historique) {
    if (!p.detenteur.visible || !p.filiale.visible || p.date_effet > date) continue;
    const cle = `${p.detenteur.id}>${p.filiale.id}`;
    const courante = retenues.get(cle);
    if (
      !courante ||
      p.date_effet > courante.date_effet ||
      (p.date_effet === courante.date_effet && p.cree_le > courante.cree_le)
    ) {
      retenues.set(cle, p);
    }
  }
  const actives: ParticipationActive[] = [];
  for (const p of retenues.values()) {
    if (p.points_base <= 0 || !p.detenteur.visible || !p.filiale.visible) continue;
    actives.push({
      id: p.id,
      detenteurId: p.detenteur.id,
      detenteurNom: p.detenteur.nom,
      filialeId: p.filiale.id,
      filialeNom: p.filiale.nom,
      points: p.points_base,
    });
  }
  return actives;
}

/** Libellé d'une ligne d'historique : « 60 % » ou « Fin de détention ». */
export function libelleParticipation(p: Pick<ParticipationApi, "points_base">): string {
  return p.points_base === 0 ? "Fin de détention" : formaterPart(p.points_base);
}

// --- Paramètres de l'écran -----------------------------------------------------------------

export interface ParametresGroupe {
  vue: VueGroupe;
  exercice?: number;
  date?: string;
}

const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function lireParametresGroupe(
  p: Record<string, string | string[] | undefined>,
): ParametresGroupe {
  const vue: VueGroupe = un(p.vue) === "client" ? "client" : "tete";
  const e = un(p.exercice);
  const exercice =
    e && /^\d{4}$/.test(e) && Number(e) >= 1990 && Number(e) <= 2100 ? Number(e) : undefined;
  const d = un(p.date);
  const date = d && estDateIso(d) && d >= "2000-01-01" && d <= "2100-12-31" ? d : undefined;
  return { vue, ...(exercice !== undefined ? { exercice } : {}), ...(date ? { date } : {}) };
}

/** Chaîne de requête de `GET /api/dossiers/:id/groupe` (et des liens de l'écran). */
export function requeteGroupe(p: ParametresGroupe): string {
  const r = new URLSearchParams();
  r.set("vue", p.vue);
  if (p.exercice !== undefined) r.set("exercice", String(p.exercice));
  if (p.date) r.set("date", p.date);
  return r.toString();
}

const enc = encodeURIComponent;
export const cheminApiGroupe = (id: string, p: ParametresGroupe) =>
  `/api/dossiers/${enc(id)}/groupe?${requeteGroupe(p)}`;
export const cheminApiParticipations = (id: string) => `/api/dossiers/${enc(id)}/participations`;
export const cheminGroupe = (id: string, p?: ParametresGroupe) =>
  `/dossiers/${enc(id)}/groupe${p ? `?${requeteGroupe(p)}` : ""}`;

// --- Saisie d'une participation --------------------------------------------------------------

export type SensParticipation = "detient" | "detenu";

export const OPTIONS_SENS: { valeur: SensParticipation; libelle: string }[] = [
  { valeur: "detient", libelle: "Ce dossier détient l'autre dossier (l'autre est sa filiale)" },
  {
    valeur: "detenu",
    libelle: "Ce dossier est détenu par l'autre dossier (l'autre est détenteur)",
  },
];

export interface SaisieParticipation {
  sens: SensParticipation;
  autre_id: string;
  pourcentage: string;
  date_effet: string;
  motif: string;
}

export type ChampParticipation = "autre_id" | "pourcentage" | "date_effet" | "motif";

export const saisieParticipationVide = (dateParDefaut = ""): SaisieParticipation => ({
  sens: "detient",
  autre_id: "",
  pourcentage: "",
  date_effet: dateParDefaut,
  motif: "",
});

export interface ChargeParticipation {
  detenteur_id: string;
  filiale_id: string;
  points_base: number;
  date_effet: string;
  motif?: string;
}

/** Une saisie à 0 % est une fin de détention : le motif devient obligatoire. */
export function estFinDeDetention(s: SaisieParticipation): boolean {
  const p = lirePourcentage(s.pourcentage);
  return p.ok && p.points === 0;
}

/**
 * Valide la saisie, alignée sur `participationCreationSchema` (paquet partagé), → corps de
 * `POST /api/dossiers/:id/participations`. Les règles d'ensemble (cycle, total > 100 %) restent
 * jugées par l'API, dont le message est affiché tel quel.
 */
export function validerParticipation(
  clientId: string,
  s: SaisieParticipation,
): Resultat<ChargeParticipation, ChampParticipation> {
  const erreurs: Partial<Record<ChampParticipation, string>> = {};
  if (!s.autre_id) erreurs.autre_id = "Choisissez l'autre dossier.";
  else if (s.autre_id === clientId)
    erreurs.autre_id = "Un dossier ne peut pas se détenir lui-même.";
  const pct = lirePourcentage(s.pourcentage);
  if (!pct.ok) erreurs.pourcentage = pct.erreur;
  if (!estDateIso(s.date_effet)) erreurs.date_effet = "Date d'effet attendue.";
  else if (s.date_effet < "2000-01-01" || s.date_effet > "2100-12-31") {
    erreurs.date_effet = "Date comprise entre 2000 et 2100 attendue.";
  }
  const motif = texteOuNull(s.motif);
  if (motif && motif.length > MOTIF_DETENTION_MAX) {
    erreurs.motif = `${MOTIF_DETENTION_MAX} caractères au plus.`;
  }
  if (pct.ok && pct.points === 0 && !motif) {
    erreurs.motif = "Le motif est obligatoire pour mettre fin à une détention.";
  }
  if (Object.keys(erreurs).length > 0 || !pct.ok) return { ok: false, erreurs };
  const charge: ChargeParticipation = {
    detenteur_id: s.sens === "detient" ? clientId : s.autre_id,
    filiale_id: s.sens === "detient" ? s.autre_id : clientId,
    points_base: pct.points,
    date_effet: s.date_effet,
    ...(motif ? { motif } : {}),
  };
  // Filet : le schéma partagé est la référence de l'API.
  const verif = participationCreationSchema.safeParse(charge);
  if (!verif.success) {
    const champ = verif.error.issues[0]?.path[0];
    const cible: ChampParticipation =
      champ === "motif" ? "motif" : champ === "date_effet" ? "date_effet" : "pourcentage";
    return { ok: false, erreurs: { [cible]: verif.error.issues[0]?.message ?? "Saisie refusée." } };
  }
  return { ok: true, charge };
}
