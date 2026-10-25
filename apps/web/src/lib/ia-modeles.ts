/** IA : choix des modèles par tâche. */
import { TACHE_IA_LIBELLES, type TacheIa } from "@missionpilot/shared";
import type { ModeleTacheIa } from "./ia-parametres";
import type { Resultat } from "./saisie";

// --- Modèles par tâche -----------------------------------------------------------------------

export interface SaisieModele {
  tache: TacheIa;
  /** Suivre le modèle recommandé par CabinetPilot (il peut évoluer). */
  recommande: boolean;
  modele: string;
}

export type ChampModele = `modele_${TacheIa}`;

export const libelleTache = (t: TacheIa) => TACHE_IA_LIBELLES[t] ?? t;

export const saisiesModeles = (modeles: readonly ModeleTacheIa[]): SaisieModele[] =>
  modeles.map((m) => ({ tache: m.tache, recommande: !m.personnalise, modele: m.modele }));

export const ERREUR_MODELE_NON_AUTORISE =
  "Choisissez un modèle de la liste : seuls les modèles au tarif connu sont admis.";

/**
 * Modifications à envoyer : `null` rend une tâche au modèle recommandé, une chaîne fixe un
 * modèle choisi dans la liste FERMÉE `autorises` (`modeles_autorises` de l'API : un modèle hors
 * liste est refusé en 400) ; une tâche inchangée est omise (objet vide : rien à enregistrer).
 * Un modèle personnalisé qui n'est plus autorisé mais reste inchangé n'est pas renvoyé.
 */
export function chargeModeles(
  saisies: readonly SaisieModele[],
  actuels: readonly ModeleTacheIa[],
  autorises: readonly string[],
): Resultat<{ modeles: Partial<Record<TacheIa, string | null>> }, ChampModele> {
  const modeles: Partial<Record<TacheIa, string | null>> = {};
  const erreurs: Partial<Record<ChampModele, string>> = {};
  for (const s of saisies) {
    const actuel = actuels.find((m) => m.tache === s.tache);
    if (!actuel) continue;
    if (s.recommande) {
      if (actuel.personnalise) modeles[s.tache] = null;
      continue;
    }
    const inchange = actuel.personnalise && s.modele === actuel.modele;
    if (inchange) continue;
    if (!autorises.includes(s.modele)) {
      erreurs[`modele_${s.tache}`] = ERREUR_MODELE_NON_AUTORISE;
      continue;
    }
    modeles[s.tache] = s.modele;
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { modeles } };
}

/**
 * Choix proposés pour une tâche : les modèles autorisés par l'API (liste fermée, aucune saisie
 * libre) ; le modèle en place reste affiché (signalé) même s'il n'est plus autorisé.
 */
export function optionsModele(
  m: ModeleTacheIa,
  autorises: readonly string[],
): { valeur: string; libelle: string; desactivee?: boolean }[] {
  const options = [...autorises].sort().map((a) => ({
    valeur: a,
    libelle: a === m.recommande ? `${a} (recommandé)` : a,
  }));
  if (!autorises.includes(m.modele)) {
    options.unshift({ valeur: m.modele, libelle: `${m.modele} (plus autorisé : à remplacer)` });
  }
  return options;
}
