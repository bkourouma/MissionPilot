import type { Api } from "./api.js";
import { creerMission } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";
import { ouvrirDossierRed, type ScenarioRed } from "./redressement-outils.js";

/*
 * Outils des tests du tableau de bord du redressement (RED-15, version interne) : adresses,
 * dossier « riche » (urgence au rouge, tension de trésorerie, covenants non respectés, actions en
 * retard) et dossiers neufs. Les corps de requêtes valides viennent de redressement-financement-outils.
 */

export const urlTableau = (dossierId: string): string =>
  `/api/redressement/dossiers/${dossierId}/tableau-de-bord`;
export const URL_PORTEFEUILLE = "/api/redressement/tableau-de-bord";

/** Mission et dossier neufs du cabinet A (le chef de mission ouvre), secteur au choix. */
export async function dossierNeuf(
  s: ScenarioRed,
  intitule: string,
  secteur = "general",
): Promise<{ dossierId: string; missionId: string }> {
  const m = await creerMission(s.a, { intitule });
  const d = await ouvrirDossierRed(s, m.id, { secteur });
  return { dossierId: d.id, missionId: m.id };
}

/** Évaluation d'urgence U2 : T1 oui, T2 partiellement, T3 non (trésorerie 63 %, rouge). */
export async function semerUrgenceRouge(par: Api, dossierId: string): Promise<void> {
  attendre(
    201,
    await par.post(`/api/redressement/dossiers/${dossierId}/urgences`, {
      reponses: { T1: "oui", T2: "partiellement", T3: "non" },
    }),
    "urgence",
  );
}

/** Action échue depuis longtemps (donc en retard à toute date de test). */
export async function semerActionEnRetard(
  par: Api,
  dossierId: string,
  responsableId: string,
  titre: string,
): Promise<void> {
  attendre(
    201,
    await par.post(`/api/redressement/dossiers/${dossierId}/actions`, {
      titre,
      volet: "quick_win",
      domaine: "tresorerie",
      echeance: "2026-01-05",
      responsable_id: responsableId,
    }),
    "action en retard",
  );
}
