import { lireMotif } from "./agents";
import { ErreurApi, messageErreur } from "./api";
import type { CvResume, ResultatOffreFinanciere } from "./banque-ao-types";
import type { SaisieOffreFinanciere } from "./banque-ao-saisie-offres";
import {
  validerReconfirmation,
  type ChampConfirmation,
  type SaisieConfirmation,
} from "./double-authentification";
import { montantVersSaisie, type Resultat } from "./saisie";

/* ----- Erreurs ----- */

const MESSAGES: Record<string, string> = {
  CV_EXISTANT: "Ce collaborateur a déjà un CV : ajoutez-lui une nouvelle version.",
  GABARIT_EXISTANT: "Un gabarit du cabinet porte déjà ce code.",
  FICHIER_DEJA_RATTACHE: "Ce fichier est déjà rattaché à une pièce.",
  VERSION_CONCURRENTE: "Une autre version vient d'être enregistrée : rechargez la page.",
  CV_ANONYME: "Ce CV est anonymisé : il n'est plus utilisable (ni export, ni nouvelle version).",
  VERSION_PERIMEE: "Une version plus récente existe : rechargez la page avant de valider.",
  VERSION_DEJA_VALIDEE: "Cette version est déjà validée.",
  CHIFFRES_A_ACQUITTER:
    "Le brouillon IA cite des nombres non vérifiés : relisez-les puis cochez l'acquittement.",
  TROP_D_EXPORTS_CV: "Trop d'exports de CV récents : réessayez dans quelques minutes.",
  RENDU_PDF_INDISPONIBLE: "Le rendu PDF est indisponible sur ce serveur : exportez en Word.",
  GENERATION_IA_ECHEC: "La rédaction par l'IA a échoué : réessayez ou partez du gabarit.",
};

/**
 * Refus 403 dont l'API explique la raison précise (séparation des tâches, retrait d'une pièce
 * d'autrui) : le message de l'API est affiché tel quel, au lieu du refus générique de rôle.
 */
const CODES_REFUS_EXPLICITES: ReadonlySet<string> = new Set([
  "APPROBATION_REQUISE",
  "RETRAIT_PIECE_INTERDIT",
]);

export function messageBanqueAo(e: unknown): string {
  if (e instanceof ErreurApi) {
    if (MESSAGES[e.code]) return MESSAGES[e.code] as string;
    if (CODES_REFUS_EXPLICITES.has(e.code) && e.message.trim() !== "") return e.message;
  }
  return messageErreur(e);
}

/** Motif d'une anonymisation (obligatoire) et reconfirmation d'identité, jointe sous `confirmation`. */
export const MOTIF_ANONYMISATION_MAX = 500;

export function lireAnonymisationCv(
  motif: string,
  confirmation: SaisieConfirmation,
): Resultat<{ motif: string; confirmation: Record<string, string> }, "motif" | ChampConfirmation> {
  const m = lireMotif(motif, MOTIF_ANONYMISATION_MAX);
  const c = validerReconfirmation(confirmation);
  if (m.ok && c.ok) {
    return { ok: true, charge: { motif: m.charge.motif, confirmation: { ...c.charge } } };
  }
  return {
    ok: false,
    erreurs: { ...(m.ok ? {} : m.erreurs), ...(c.ok ? {} : c.erreurs) },
  };
}

/* ----- Chemins ----- */

/** Lien d'une page de liste avec ses filtres et, facultatif, le curseur de la page suivante. */
export function hrefListe(
  chemin: string,
  filtres: URLSearchParams,
  curseur: string | null,
): string {
  const q = new URLSearchParams(filtres);
  q.delete("limite");
  q.delete("curseur");
  if (curseur) q.set("curseur", curseur);
  const s = q.toString();
  return s ? `${chemin}?${s}` : chemin;
}

/** Résultat enregistré → champs du formulaire (nouvelle version de l'offre financière). */
export function saisieDepuisOffreFinanciere(
  titre: string,
  r: ResultatOffreFinanciere,
): SaisieOffreFinanciere {
  const nombre = (n: number) => String(n).replace(".", ",");
  const prix = (m: number) => montantVersSaisie(m, r.devise);
  const tva = r.taxes.find((t) => t.assiette === "total_ht");
  return {
    titre,
    devise: r.devise,
    honoraires: r.honoraires
      .map((l) => [l.cle ?? "", l.libelle, nombre(l.quantite), prix(l.prix_unitaire)].join(" | "))
      .join("\n"),
    per_diem: r.per_diem
      .map((l) => [l.libelle, nombre(l.quantite), prix(l.prix_unitaire)].join(" | "))
      .join("\n"),
    debours: r.debours
      .map((l) => [l.libelle, nombre(l.quantite), prix(l.prix_unitaire)].join(" | "))
      .join("\n"),
    tva: tva ? nombre(tva.taux) : "",
  };
}

/* ----- Choix de l'offre technique (équipe et appel d'offres) ----- */

export interface ChoixListe {
  valeur: string;
  libelle: string;
}

/** CV proposés pour l'équipe d'une offre : jamais un CV anonymisé (409 côté API). */
export function choixCv(
  cv: readonly Pick<CvResume, "id" | "nom" | "titre" | "anonymise">[],
): ChoixListe[] {
  return cv
    .filter((c) => !c.anonymise)
    .map((c) => ({ valeur: c.id, libelle: c.titre ? `${c.nom} — ${c.titre}` : c.nom }));
}

/** Fiches d'appels d'offres proposées pour rattacher une offre : « référence — titre ». */
export function choixFiches(
  fiches: readonly { id: string; reference: string | null; titre: string }[],
): ChoixListe[] {
  return fiches.map((f) => ({
    valeur: f.id,
    libelle: f.reference ? `${f.reference} — ${f.titre}` : f.titre,
  }));
}
