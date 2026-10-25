import type { ContexteTenantDemo } from "../contexte.js";
import type { MissionTrouvee } from "./casting.js";
import type { ActeursMission, ComptesPortail } from "./kpi-acteurs.js";
import type { FenetreKpi } from "./kpi-fenetre.js";
import type { SpecKpi, SpecMissionKpi } from "./kpi-types.js";
import { exiger, lire } from "./outils.js";

/*
 * Définitions des KPI d'une mission, cibles (version initiale + révision) et contributeurs du
 * portail, par les VRAIES routes : POST /api/missions/:id/kpi, POST /api/kpi/:id/cibles,
 * PUT /api/kpi/:id/contributeurs. Le suivi débute le premier jour du mois précédant le début de la
 * mission (fenêtre de kpi-fenetre.ts). La clé naturelle d'un KPI est son libellé dans la mission : un
 * KPI déjà présent n'est jamais recréé (ni modifié).
 */

export interface KpiSeme {
  spec: SpecKpi;
  id: string;
  indice: number;
}

function corpsCreation(
  spec: SpecKpi,
  proprietaireId: string,
  debutSuivi: string,
): Record<string, string | number | boolean> {
  const corps: Record<string, string | number | boolean> = {
    libelle: spec.libelle,
    description: spec.description,
    unite: spec.unite,
    perspective: spec.perspective,
    sens: spec.sens,
    nature: spec.nature,
    frequence: "mensuelle",
    debut_suivi: debutSuivi,
    ponderation: spec.ponderation ?? 1,
    proprietaire_id: proprietaireId,
    cible: spec.cible,
  };
  if (spec.seuilVert !== undefined && spec.seuilOrange !== undefined) {
    corps.seuil_vert = spec.seuilVert;
    corps.seuil_orange = spec.seuilOrange;
  }
  if (spec.alerteHaut !== undefined) corps.alerte_haut = spec.alerteHaut;
  if (spec.alerteBas !== undefined) corps.alerte_bas = spec.alerteBas;
  if (spec.alerteVariation !== undefined) corps.alerte_variation = spec.alerteVariation;
  return corps;
}

/** Crée les KPI absents de la mission et complète leurs cibles et contributeurs. */
export async function synchroniserDefinitions(
  ctx: ContexteTenantDemo,
  mission: MissionTrouvee,
  spec: SpecMissionKpi,
  acteurs: ActeursMission,
  portail: ComptesPortail,
  fenetre: FenetreKpi,
): Promise<KpiSeme[]> {
  const chef = ctx.session(acteurs.chef);
  const directeur = ctx.session(acteurs.directeur);
  const existants = await lire<{ id: string; libelle: string }>(
    ctx,
    "SELECT id, libelle FROM kpi_definitions WHERE mission_id = $1",
    [mission.id],
  );
  const semes: KpiSeme[] = [];
  for (const [indice, k] of spec.kpis.entries()) {
    let id = existants.find((e) => e.libelle === k.libelle)?.id;
    if (!id) {
      const proprio = ctx.utilisateurs[k.proprio === "chef" ? acteurs.chef : acteurs.directeur];
      if (!proprio) throw new Error(`Propriétaire du KPI « ${k.libelle} » introuvable.`);
      const r = await (k.proprio === "chef" ? chef : directeur).post(
        `/api/missions/${mission.id}/kpi`,
        corpsCreation(k, proprio, fenetre.debut),
      );
      exiger(r, 201, `Création du KPI « ${k.libelle} » (${mission.intitule})`);
      id = r.json().id as string;
    }
    semes.push({ spec: k, id, indice });
    if (k.revision) await reviserCible(ctx, id, k, directeur);
    await designerContributeurs(ctx, id, k, portail, chef);
  }
  return semes;
}

async function reviserCible(
  ctx: ContexteTenantDemo,
  kpiId: string,
  k: SpecKpi,
  session: ReturnType<ContexteTenantDemo["session"]>,
): Promise<void> {
  const rev = k.revision;
  if (!rev) return;
  const debut = `${rev.mois}-01`;
  const deja = await lire(ctx, "SELECT 1 FROM kpi_cibles WHERE kpi_id = $1 AND a_partir_de = $2", [
    kpiId,
    debut,
  ]);
  if (deja.length > 0) return;
  const r = await session.post(`/api/kpi/${kpiId}/cibles`, {
    valeur: rev.valeur,
    a_partir_de: debut,
    motif: rev.motif,
  });
  exiger(r, 201, `Révision de la cible du KPI « ${k.libelle} »`);
}

async function designerContributeurs(
  ctx: ContexteTenantDemo,
  kpiId: string,
  k: SpecKpi,
  portail: ComptesPortail,
  session: ReturnType<ContexteTenantDemo["session"]>,
): Promise<void> {
  if (!k.portail) return;
  const voulus = k.portail.comptes
    .map((c) => portail[c])
    .map((cle) => (cle ? ctx.utilisateurs[cle] : undefined))
    .filter((id): id is string => !!id);
  if (voulus.length === 0) return;
  const actuels = await lire<{ utilisateur_id: string }>(
    ctx,
    "SELECT utilisateur_id FROM kpi_contributeurs WHERE kpi_id = $1",
    [kpiId],
  );
  if (voulus.every((v) => actuels.some((a) => a.utilisateur_id === v))) return;
  const r = await session.put(`/api/kpi/${kpiId}/contributeurs`, {
    utilisateurs: [...new Set([...actuels.map((a) => a.utilisateur_id), ...voulus])],
  });
  exiger(r, 200, `Contributeurs du KPI « ${k.libelle} »`);
}
