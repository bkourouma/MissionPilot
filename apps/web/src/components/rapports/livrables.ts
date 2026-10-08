/**
 * Rapports de service (SOC-07) : rapport de la notation publiée (NOT-07) et du plan stratégique
 * (PLA-11), en PDF ou Word, et PDF d'une facture. Logique pure, testée dans `livrables.test.ts`.
 *
 * L'API reste seule juge des droits et du contenu (`apps/api/src/rapports/notation.ts`,
 * `plan.ts`) : une notation n'est rendue que publiée ; un plan ne reproduit que ses contenus
 * validés. Rien n'est conservé dans le navigateur.
 */
import { ErreurApi } from "../../lib/api";
import type { FichierMeta } from "../../lib/fichiers";
import { messageRapport } from "../../lib/rapports";

export const TYPES_LIVRABLE = ["notation", "plan"] as const;
export type TypeLivrable = (typeof TYPES_LIVRABLE)[number];

export const FORMATS_LIVRABLE = ["pdf", "docx"] as const;
export type FormatLivrable = (typeof FORMATS_LIVRABLE)[number];

/** Rapport tel que listé par GET /api/notations/:id/rapports ou /api/plans/:id/rapports. */
export interface RapportLivrable {
  id: string;
  mission_id: string;
  modele: string;
  format: string;
  statut: string;
  niveau: string;
  notation_id: string | null;
  plan_id: string | null;
  version_source: number | null;
  genere_par: string;
  genere_le: string;
  fichier: FichierMeta;
}

export interface PageLivrables {
  elements: RapportLivrable[];
  curseur_suivant: string | null;
}

/** Réponse 201 de la génération. */
export interface LivrableCree {
  rapport: Omit<RapportLivrable, "fichier">;
  fichier: FichierMeta;
}

export const LIVRABLES: Record<
  TypeLivrable,
  { titre: string; bouton: string; segment: string; explication: string; version: string }
> = {
  notation: {
    titre: "Rapport de notation",
    bouton: "Générer le rapport de notation",
    segment: "notations",
    explication:
      "Le rapport reprend la dernière version publiée après la revue d'un expert métier : score global, scores par pilier, forces et faiblesses, ajustements motivés et évolution depuis la notation précédente. Une version en brouillon ou en revue n'est jamais rendue.",
    version: "Version de la notation",
  },
  plan: {
    titre: "Rapport du plan stratégique",
    bouton: "Générer le rapport du plan",
    segment: "plans",
    explication:
      "Le rapport reprend uniquement les contenus validés (diagnostic, SWOT, vision, axes, objectifs, initiatives) et le modèle financier (scénarios, états prévisionnels, indicateurs). Tant qu'un contenu ou le modèle reste à valider, le document porte le statut « Brouillon ».",
    version: "Version du modèle financier",
  },
};

export const FORMATS_LIVRABLE_LIBELLES: Record<FormatLivrable, { libelle: string; aide: string }> =
  {
    pdf: { libelle: "PDF", aide: "Pour lire et imprimer. Rendu plus long : jusqu'à 30 secondes." },
    docx: { libelle: "Word (.docx)", aide: "Document modifiable avant diffusion." },
  };

export const estFormatLivrable = (v: unknown): v is FormatLivrable =>
  typeof v === "string" && (FORMATS_LIVRABLE as readonly string[]).includes(v);

const segment = (id: string) => encodeURIComponent(id);

/** Nombre de rapports affichés dans le panneau (les plus récents). */
export const LIVRABLES_AFFICHES = 10;

/** POST de génération (version facultative : entier positif, sinon ignorée). */
export function cheminGenerationLivrable(
  type: TypeLivrable,
  id: string,
  format: FormatLivrable,
  version?: number | null,
): string {
  const q = new URLSearchParams({ format });
  if (typeof version === "number" && Number.isInteger(version) && version >= 1) {
    q.set("version", String(version));
  }
  return `/api/${LIVRABLES[type].segment}/${segment(id)}/rapports?${q.toString()}`;
}

/** GET de la liste des rapports de la notation ou du plan. */
export function cheminListeLivrables(type: TypeLivrable, id: string): string {
  return `/api/${LIVRABLES[type].segment}/${segment(id)}/rapports?limite=${LIVRABLES_AFFICHES}`;
}

/** Lien de téléchargement du PDF d'une facture (réponse en pièce jointe, sans cache). */
export function hrefFacturePdf(factureId: string): string {
  return `/api/factures/${segment(factureId)}/pdf`;
}

const STATUTS: Record<string, string> = { brouillon: "Brouillon", valide: "Validé" };
export const libelleStatutLivrable = (s: string) => STATUTS[s] ?? "Statut non reconnu";

export const libelleFormatLivrable = (f: string) =>
  estFormatLivrable(f) ? FORMATS_LIVRABLE_LIBELLES[f].libelle : "Fichier";

/** Phrase de succès après génération. */
export function messageLivrableCree(type: TypeLivrable, cree: LivrableCree): string {
  const statut =
    cree.rapport.statut === "valide"
      ? "au statut « Validé »"
      : "au statut « Brouillon » : des contenus restent à valider, relisez-le avant toute diffusion";
  return `${LIVRABLES[type].titre} au format ${libelleFormatLivrable(cree.rapport.format)}, ${statut}.`;
}

/** Message français pour chaque refus de la génération d'un rapport de service. */
export function messageLivrable(type: TypeLivrable, e: unknown): string {
  if (e instanceof ErreurApi) {
    if (e.code === "NOTATION_NON_PUBLIEE") {
      return "Aucune version publiée : la notation doit être soumise en revue puis publiée par un expert métier avant de produire son rapport.";
    }
    if (e.statut === 403) {
      return type === "notation"
        ? "Votre rôle ne vous permet pas de produire le rapport de cette notation."
        : "Votre rôle ne vous permet pas de produire le rapport de ce plan.";
    }
    if (e.statut === 404) {
      return type === "notation"
        ? "Cette notation, ou la version demandée, est introuvable ou ne vous est plus accessible."
        : "Ce plan, ou la version du modèle demandée, est introuvable ou ne vous est plus accessible.";
    }
  }
  return messageRapport(e);
}
