/**
 * Veille multi-sources des appels d'offres (AO-01, lot 5b) : types des réponses de l'API,
 * libellés, chemins, lecture des filtres et contrôle du fichier à importer. Logique pure, testée
 * dans `appels-offres-veille.test.ts`.
 *
 * RÈGLE : score, raisons du rapprochement et dédoublonnage sont CALCULÉS par l'API (moteur
 * packages/engines/src/appels-offres/veille.ts). Ce module n'en recalcule rien. Les droits
 * ci-dessous sont un confort d'affichage ; l'API reste seule juge. Aucune adresse d'avis n'est
 * visitée par le serveur : le lien s'affiche, c'est à l'utilisateur de l'ouvrir.
 */
import {
  VEILLE_IMPORT_TEXTE_MAX,
  VEILLE_STATUT_LIBELLES,
  VEILLE_STATUTS,
  type VeilleStatut,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi, messageErreur } from "./api";
import type { Devise } from "./format";

// --- Types des réponses de l'API -------------------------------------------------------------

export interface SourceVeilleVue {
  code: string;
  libelle: string;
  simulee: boolean;
  active: boolean;
  modifie_le: string | null;
}

export interface ExpliqueVeille {
  raisons: string[];
  competencesTrouvees: string[];
  competencesMatriceTrouvees: string[];
}

export interface ResultatVeille {
  id: string;
  reference: string | null;
  titre: string;
  objet: string | null;
  bailleur: string | null;
  pays: string | null;
  secteur: string | null;
  montant_estime: number | null;
  devise: Devise;
  date_publication: string | null;
  date_limite: string | null;
  url: string | null;
  mots_cles: string[];
  statut: VeilleStatut;
  fiche_id: string | null;
  score_rapprochement: number;
  rapprochement: ExpliqueVeille;
  nb_occurrences?: number;
  sources?: string[] | null;
}

export interface PageResultatsVeille {
  elements: ResultatVeille[];
  total: number;
}

export interface ResumeVeille {
  total: number;
  plafond: number;
  par_statut: Record<VeilleStatut, number>;
  sources_actives: number;
}

export interface BilanVeille {
  lus: number;
  nouveaux: number;
  doublons: number;
  plafond: number;
  erreurs?: { ligne: number; message: string }[];
}

// --- Libellés ---------------------------------------------------------------------------------

export const libelleStatutVeille = (s: VeilleStatut) => VEILLE_STATUT_LIBELLES[s];

export function tonaliteStatutVeille(s: VeilleStatut): TonaliteStatut {
  if (s === "fiche_creee") return "succes";
  if (s === "retenu") return "attention";
  return "neutre";
}

export function tonaliteScoreVeille(score: number): TonaliteStatut {
  if (score >= 60) return "succes";
  if (score >= 30) return "attention";
  return "neutre";
}

/** Phrase de bilan d'une collecte ou d'un import. */
export function texteBilanVeille(b: BilanVeille): string {
  const morceaux = [
    `${b.lus} avis lu(s)`,
    `${b.nouveaux} nouveau(x)`,
    `${b.doublons} déjà connu(s)`,
  ];
  if (b.plafond > 0) morceaux.push(`${b.plafond} refusé(s) : plafond de résultats atteint`);
  if (b.erreurs && b.erreurs.length > 0) morceaux.push(`${b.erreurs.length} ligne(s) en erreur`);
  return `${morceaux.join(" ; ")}.`;
}

/** Détail des lignes en erreur d'un import, une phrase par ligne (10 au plus). */
export function texteErreursImport(erreurs: readonly { ligne: number; message: string }[]) {
  return erreurs.slice(0, 10).map((e) => `Ligne ${e.ligne} : ${e.message}`);
}

// --- Chemins et filtres -----------------------------------------------------------------------

export const CHEMIN_VEILLE = "/appels-offres/veille";
export const API_VEILLE = "/api/appels-offres/veille";
export const PAGE_VEILLE = 50;

export interface FiltresVeille {
  statut: VeilleStatut | "";
  q: string;
  score_min: string;
  page: number;
}

const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function lireFiltresVeille(p: Record<string, string | string[] | undefined>): FiltresVeille {
  const s = un(p.statut) ?? "";
  const m = un(p.score_min) ?? "";
  const page = Number.parseInt(un(p.page) ?? "1", 10);
  return {
    statut: (VEILLE_STATUTS as readonly string[]).includes(s) ? (s as VeilleStatut) : "",
    q: (un(p.q) ?? "").trim().slice(0, 100),
    score_min: /^(100|[1-9]?\d)$/.test(m) ? m : "",
    page: Number.isInteger(page) && page >= 1 && page <= 100 ? page : 1,
  };
}

export function cheminResultatsVeille(f: FiltresVeille): string {
  const r = new URLSearchParams({
    limite: String(PAGE_VEILLE),
    decalage: String((f.page - 1) * PAGE_VEILLE),
  });
  if (f.statut) r.set("statut", f.statut);
  if (f.q) r.set("q", f.q);
  if (f.score_min) r.set("score_min", f.score_min);
  return `${API_VEILLE}/resultats?${r.toString()}`;
}

export function hrefVeille(f: Partial<FiltresVeille> = {}): string {
  const r = new URLSearchParams();
  if (f.statut) r.set("statut", f.statut);
  if (f.q) r.set("q", f.q);
  if (f.score_min) r.set("score_min", f.score_min);
  if (f.page && f.page > 1) r.set("page", String(f.page));
  const s = r.toString();
  return s ? `${CHEMIN_VEILLE}?${s}` : CHEMIN_VEILLE;
}

// --- Fichier à importer -----------------------------------------------------------------------

export type VerdictFichier = { ok: true; format: "csv" | "json" } | { ok: false; message: string };

/** Contrôle avant lecture : extension .csv ou .json, 1 Mo au plus (l'API revérifie tout). */
export function verifierFichierImport(f: { name: string; size: number }): VerdictFichier {
  const nom = f.name.toLowerCase();
  const format = nom.endsWith(".json") ? "json" : nom.endsWith(".csv") ? "csv" : null;
  if (!format) return { ok: false, message: "Choisissez un fichier .csv ou .json." };
  if (f.size === 0) return { ok: false, message: "Le fichier est vide." };
  if (f.size > VEILLE_IMPORT_TEXTE_MAX) {
    return { ok: false, message: "Le fichier dépasse 1 Mo : découpez-le en plusieurs imports." };
  }
  return { ok: true, format };
}

// --- Erreurs ----------------------------------------------------------------------------------

/** Message d'une erreur de la veille : le texte de l'API pour les conflits métier. */
export function messageVeille(e: unknown): string {
  if (e instanceof ErreurApi) {
    if (e.code.startsWith("AO_VEILLE_") || e.code === "AO_REFERENCE_EXISTANTE") return e.message;
    if (e.statut === 404) return "Ce résultat de veille n'existe pas ou plus.";
    if (e.statut === 409) return e.message;
  }
  return messageErreur(e);
}
