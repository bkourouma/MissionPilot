import type {
  RedCausesListeVue,
  RedChecklistModelesVue,
  RedChecklistReferentielVue,
  RedChecklistsVue,
  RedChecklistVue,
} from "@missionpilot/shared";
import { chargerServeur } from "./api-serveur";
import {
  CHEMIN_CHECKLISTS_REFERENTIEL,
  cheminCauses,
  cheminChecklist,
  cheminChecklistsDossier,
  cheminModelesChecklists,
} from "./redressement-diagnostic";

/**
 * Chargements serveur de l'onglet Diagnostic et du paramétrage des modèles (dépend de
 * `next/headers` : à ne pas importer dans un composant client). Non testé directement.
 */

export const chargerReferentielChecklists = () =>
  chargerServeur<RedChecklistReferentielVue>(CHEMIN_CHECKLISTS_REFERENTIEL);

export const chargerModelesChecklists = (secteur?: string) =>
  chargerServeur<RedChecklistModelesVue>(cheminModelesChecklists(secteur));

export const chargerCausesDossier = (dossierId: string) =>
  chargerServeur<RedCausesListeVue>(cheminCauses(dossierId));

export type ChecklistsDossierChargees =
  { ok: true; checklists: RedChecklistVue[]; echecs: number } | { ok: false; message: string };

/**
 * Check-lists activées du dossier avec leur détail (items, réponses, évaluation du moteur) : la
 * liste puis un détail par check-list (30 au plus). Un détail illisible est compté, pas fatal.
 */
export async function chargerChecklistsDossier(
  dossierId: string,
  statut: "active" | "archivee" | "toutes" = "active",
): Promise<ChecklistsDossierChargees> {
  const liste = await chargerServeur<RedChecklistsVue>(cheminChecklistsDossier(dossierId, statut));
  if (!liste.ok) return { ok: false, message: liste.message };
  const details = await Promise.all(
    liste.donnees.checklists.map((c) => chargerServeur<RedChecklistVue>(cheminChecklist(c.id))),
  );
  const checklists: RedChecklistVue[] = [];
  let echecs = 0;
  for (const d of details) {
    if (d.ok) checklists.push(d.donnees);
    else echecs += 1;
  }
  return { ok: true, checklists, echecs };
}
