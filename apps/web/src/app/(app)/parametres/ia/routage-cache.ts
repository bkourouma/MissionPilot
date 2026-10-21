import {
  CRITERE_ROUTAGE_LIBELLES,
  CRITERES_ROUTAGE_IA,
  TACHES_IA,
  type CritereRoutageIa,
  type TacheIa,
} from "@missionpilot/shared";
import type { RouteTacheIa } from "../../../../lib/ia";

/*
 * Routage des modèles par tâche et cache des réponses IA (AGT-06) : lecture DÉFENSIVE de ce que
 * GET /api/ia/parametres expose (`routage`, `cache_actif`, `cache_duree_heures`) et textes de la
 * page. Une réponse plus ancienne ou incomplète ne casse pas la page : le routage est simplement
 * absent, le cache est présenté comme désactivé (son état par défaut, le plus prudent).
 */

/** Ligne du routage telle que l'API l'expose (type partagé de lib/ia.ts). */
export type RouteTacheVue = RouteTacheIa;

/** État du cache des réponses (désactivé par défaut). */
export interface EtatCacheIa {
  actif: boolean;
  dureeHeures: number;
}

/** Durée de vie d'une entrée du cache si l'API ne la donne pas (même valeur que l'API). */
export const DUREE_CACHE_PAR_DEFAUT_HEURES = 24;

const estObjet = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const estTache = (v: unknown): v is TacheIa =>
  typeof v === "string" && (TACHES_IA as readonly string[]).includes(v);

const estCritere = (v: unknown): v is CritereRoutageIa =>
  typeof v === "string" && (CRITERES_ROUTAGE_IA as readonly string[]).includes(v);

/** Routage lu de la réponse de l'API ; les lignes mal formées sont écartées. */
export function lireRoutage(parametres: unknown): RouteTacheVue[] {
  if (!estObjet(parametres) || !Array.isArray(parametres.routage)) return [];
  const lignes: RouteTacheVue[] = [];
  for (const l of parametres.routage as unknown[]) {
    if (!estObjet(l) || !estTache(l.tache) || !estCritere(l.critere)) continue;
    if (typeof l.modele_recommande !== "string" || typeof l.modele_applique !== "string") continue;
    const plafond = l.plafond_jetons_sortie;
    lignes.push({
      tache: l.tache,
      modele_recommande: l.modele_recommande,
      modele_applique: l.modele_applique,
      personnalise: l.personnalise === true,
      critere: l.critere,
      motif: typeof l.motif === "string" ? l.motif : "",
      plafond_jetons_sortie:
        typeof plafond === "number" && Number.isInteger(plafond) && plafond > 0 ? plafond : null,
    });
  }
  return lignes;
}

/** État du cache lu de la réponse de l'API : désactivé sauf `cache_actif: true` explicite. */
export function lireEtatCache(parametres: unknown): EtatCacheIa {
  if (!estObjet(parametres)) return { actif: false, dureeHeures: DUREE_CACHE_PAR_DEFAUT_HEURES };
  const d = parametres.cache_duree_heures;
  return {
    actif: parametres.cache_actif === true,
    dureeHeures:
      typeof d === "number" && Number.isFinite(d) && d > 0 ? d : DUREE_CACHE_PAR_DEFAUT_HEURES,
  };
}

export const libelleCritere = (c: CritereRoutageIa) => CRITERE_ROUTAGE_LIBELLES[c] ?? c;

/** Plafond de jetons de sortie lisible (« 4 000 jetons »), « — » sans sortie de texte. */
export function libellePlafondJetons(n: number | null): string {
  if (n === null) return "—";
  return `${new Intl.NumberFormat("fr-FR").format(n).replace(/\u202f/g, "\u00a0")}\u00a0jetons`;
}

/** Charge du PUT /api/ia/parametres pour (dés)activer le cache. */
export const chargeCache = (actif: boolean) => ({ cache_actif: actif });

/** Message de succès après le réglage du cache. */
export const messageCache = (actif: boolean) =>
  actif
    ? "Cache des réponses activé : une génération strictement identique pourra être reprise sans nouvel appel facturé."
    : "Cache des réponses désactivé : les réponses gardées du cabinet ont été supprimées.";

/** Explication affichée à côté de l'interrupteur du cache. */
export function explicationCache(e: EtatCacheIa): string {
  const duree = `${e.dureeHeures}\u00a0heure${e.dureeHeures > 1 ? "s" : ""}`;
  const commun =
    `Une génération strictement identique (même prompt et même version, même modèle, mêmes données masquées) ` +
    `peut reprendre la réponse obtenue dans les ${duree} précédentes, sans nouvel appel facturé. ` +
    "Le contenu repris reste un brouillon IA à valider ; les plafonds, la vérification des chiffres et les droits s'appliquent comme d'habitude. " +
    "Jamais de cache pour le copilote, les entretiens, les contenus de clients ni une donnée identifiante restée en clair.";
  return e.actif
    ? `${commun} Le désactiver supprime aussitôt les réponses gardées du cabinet.`
    : `Désactivé par défaut. ${commun}`;
}
