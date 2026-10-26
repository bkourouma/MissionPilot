import { lireParametresRapports } from "../../../rapports/parametres.js";
import { attendre, type ContexteTenantDemo } from "../contexte.js";
import { CASTING, CLES_MISSIONS, type CleMission, type ModuleLot } from "./commun.js";
import {
  evaluerMissionEnProposition,
  semerAcceptations,
  semerRelations,
  semerSatisfactions,
} from "./qualite-acceptation.js";
import { semerDefinitions } from "./qualite-definitions.js";
import { SUIVIS } from "./qualite-donnees.js";
import { dateOuverture, ecrireSuivi } from "./qualite-historique.js";
import { infoMission, type InfoMission } from "./qualite-outils.js";
import { semerSuivisDuJour } from "./qualite-vif.js";

/*
 * Module « qualite » (QUA-01 à QUA-04, QUA-06 à QUA-08) : qualité et responsabilité
 * professionnelle, SANS la revue à froid (étape `semerRevuesFroides`, après la clôture des
 * missions terminées).
 *
 *  1. relations entre clients (conflits d'intérêts) et leurs retraits ;
 *  2. définitions de « terminé » versionnées ;
 *  3. acceptation de chaque mission du casting (évaluation puis décision, conflits figés) ;
 *  4. suivis qualité des livrables : revue guidée, vérification, attestations, étapes de la garde
 *     par classe de risque, validation et signature (historique daté, séparation des tâches
 *     vérifiée par le moteur de garde) ;
 *  5. ce qui se passe aujourd'hui, par les vraies routes : suivis du diagnostic flash, évaluation
 *     d'acceptation de la mission en proposition, notes de jalons récentes ;
 *  6. satisfaction du client (jalons et clôture) ;
 *  7. contrôle : chaque suivi, acceptation et la synthèse se relisent par les routes sans violation.
 * Idempotent : suivis, définitions, relations, acceptations et notes sont retrouvés par clé naturelle.
 * Les chiffres des contenus viennent des moteurs (le module n'en calcule aucun) ; aucun contenu IA.
 */
export const semerQualite: ModuleLot = async (ctx) => {
  const infos = new Map<CleMission, InfoMission>();
  for (const [i, cle] of CLES_MISSIONS.entries()) infos.set(cle, await infoMission(ctx, cle, i));

  const mention = await ctx.database.withTenant(
    ctx.cabinetId,
    async (db) => (await lireParametresRapports(db)).mention_effective,
  );
  const dates = SUIVIS.filter((s) => s.type === "etat").map((s) => {
    const m = infos.get(s.mission);
    return dateOuverture(
      s,
      m?.mission.debut ?? CASTING[s.mission].debut,
      m?.mission.fin ?? CASTING[s.mission].fin,
    );
  });
  const premierEtat = [...dates].sort()[0] ?? ctx.debut;

  await semerRelations(ctx);
  const definitions = await semerDefinitions(ctx, premierEtat);
  await semerAcceptations(ctx, infos);
  let crees = 0;
  for (const spec of SUIVIS) {
    const info = infos.get(spec.mission);
    if (!info) throw new Error(`Mission ${spec.mission} absente du casting.`);
    if (await ecrireSuivi(ctx, spec, info, definitions, mention)) crees++;
  }
  const flash = infos.get("flash-teranga");
  if (flash) await semerSuivisDuJour(ctx, flash);
  await evaluerMissionEnProposition(ctx, infos);
  await semerSatisfactions(ctx, infos);
  await controler(ctx, infos);
  ctx.journal(
    `Qualité : ${crees} suivi(s) historique(s) ajouté(s), contrôle par les routes réussi.`,
  );
};

/** Relit par les routes ce qui vient d'être semé : aucune violation de garde, définitions cohérentes. */
async function controler(
  ctx: ContexteTenantDemo,
  infos: Map<CleMission, InfoMission>,
): Promise<void> {
  const associe = ctx.session("associe");
  const suivis = (
    await ctx.proprietaire.query<{ id: string; statut: string; libelle: string }>(
      "SELECT id, statut, libelle FROM qualite_suivis WHERE cabinet_id = $1 ORDER BY ouvert_le, id",
      [ctx.cabinetId],
    )
  ).rows;
  for (const s of suivis) {
    const r = await associe.get(`/api/qualite/suivis/${s.id}`);
    attendre(200, r, `relecture du suivi « ${s.libelle} »`);
    const d = r.json() as {
      garde: { violations: unknown[]; etapes_a_reconfirmer: unknown[] };
      definition: { satisfaite: boolean };
      signature: unknown;
    };
    const incoherent =
      d.garde.violations.length > 0 ||
      d.garde.etapes_a_reconfirmer.length > 0 ||
      ((s.statut === "valide" || s.statut === "signe") && !d.definition.satisfaite) ||
      (s.statut === "signe" && d.signature === null);
    if (incoherent) {
      throw new Error(`Suivi qualité « ${s.libelle} » incohérent : ${JSON.stringify(d.garde)}.`);
    }
  }
  for (const info of infos.values()) {
    const r = await associe.get(`/api/qualite/missions/${info.mission.id}/acceptation`);
    attendre(200, r, "acceptation");
  }
  attendre(200, await associe.get("/api/qualite/relations-clients"), "relations entre clients");
  attendre(200, await associe.get("/api/qualite/definitions"), "définitions de terminé");
  attendre(
    200,
    await associe.get("/api/qualite/satisfaction/synthese"),
    "synthèse de satisfaction",
  );
}
