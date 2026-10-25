import { attendre, type ContexteTenantDemo } from "../contexte.js";
import { CASTING, CLES_TERMINEES, chargerMissions, type ModuleLot } from "./commun.js";
import { CAMPAGNES } from "./qualite-froide-donnees.js";
import { campagnePassee, type MissionCloturee } from "./qualite-froide-historique.js";
import { campagneDuJour } from "./qualite-froide-vif.js";

/*
 * Étape « revues à froid » (QUA-05) de la phase ia-qualite-standard. À lancer APRÈS la clôture des
 * cinq missions terminées du casting (fin de la phase « gestion ») : la revue à froid n'échantillonne
 * que des missions clôturées, et aucune route n'écrit sur une mission ouverte de cette façon. Cette
 * étape n'est donc PAS appelée par la phase ia-qualite-standard ; elle échoue avec un message clair
 * tant qu'une mission terminée n'est pas clôturée.
 *
 *  - deux campagnes passées (premier puis second semestre 2025), écrites avec leurs dates par SQL
 *    (déclencheurs d'ajout seul) : tirage reproductible du moteur, relecteurs indépendants, grille
 *    de huit critères, constats, clôture de campagne, plan d'amélioration et son historique ;
 *  - une campagne ouverte aujourd'hui par les vraies routes : revue terminée, revue en cours,
 *    actions du plan (dont une en cours).
 * Le score et la conclusion de chaque revue sortent du moteur `calculerRevueFroide`, jamais d'un
 * modèle de langage ; l'IA n'intervient pas. Idempotent par intitulé de campagne.
 */
export const semerRevuesFroides: ModuleLot = async (ctx) => {
  const missions = await chargerMissions(ctx);
  const ouvertes = CLES_TERMINEES.filter((cle) => !missions[cle]?.cloturee);
  if (ouvertes.length > 0) {
    throw new Error(
      "Revues à froid : les missions terminées du casting doivent être clôturées avant cette étape " +
        `(non clôturées ou absentes : ${ouvertes.map((c) => CASTING[c].intitule).join(" ; ")}). ` +
        "Elle s'exécute à la fin de la phase « gestion », après la clôture.",
    );
  }
  const r = await ctx.proprietaire.query<{ id: string; cloture: string }>(
    `SELECT id, to_char(cloturee_le AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS cloture
       FROM missions WHERE cabinet_id = $1 AND intitule = ANY($2::text[]) AND cloturee_le IS NOT NULL
      ORDER BY cloturee_le, id`,
    [ctx.cabinetId, CLES_TERMINEES.map((c) => CASTING[c].intitule)],
  );
  const cles = new Map(CLES_TERMINEES.map((c) => [missions[c]?.id, c]));
  const chronologie: MissionCloturee[] = r.rows.map((m) => {
    const cle = cles.get(m.id);
    if (!cle) throw new Error("Mission clôturée hors du casting.");
    return { cle, id: m.id, cloture: m.cloture };
  });
  if (chronologie.length < CLES_TERMINEES.length) {
    throw new Error("Revues à froid : une mission terminée n'a pas de date de clôture.");
  }

  let creees = 0;
  for (const [i, modele] of CAMPAGNES.entries()) {
    if (await campagnePassee(ctx, modele, chronologie, i + 1)) creees++;
  }
  await campagneDuJour(ctx, chronologie);
  await controler(ctx);
  // Au moins trois missions terminées doivent avoir été revues (campagnes passées et du jour).
  const revues = await ctx.proprietaire.query<{ n: string }>(
    "SELECT count(DISTINCT mission_id) AS n FROM qualite_froide_echantillon WHERE cabinet_id = $1",
    [ctx.cabinetId],
  );
  if (Number(revues.rows[0]?.n ?? 0) < 3) {
    throw new Error(
      `Revues à froid : ${revues.rows[0]?.n ?? 0} mission(s) revue(s) seulement (3 au moins attendues) : ` +
        "trop peu de missions terminées ont un relecteur indépendant (voir le journal).",
    );
  }
  ctx.journal(
    `Revues à froid : ${creees} campagne(s) passée(s) ajoutée(s), campagne du jour et contrôle réussis.`,
  );
};

/** Relit par les routes : tirage reproductible, plan et revues lisibles pour chaque campagne. */
async function controler(ctx: ContexteTenantDemo): Promise<void> {
  const associe = ctx.session("associe");
  const liste = await associe.get("/api/qualite/revue-froide/campagnes");
  attendre(200, liste, "liste des campagnes de revue à froid");
  const campagnes = (liste.json() as { elements: { id: string; intitule: string }[] }).elements;
  for (const c of campagnes) {
    const v = await associe.get(`/api/qualite/revue-froide/campagnes/${c.id}/verification`);
    attendre(200, v, `vérification du tirage de « ${c.intitule} »`);
    if (!(v.json() as { reproductible: boolean }).reproductible) {
      throw new Error(`Tirage non reproductible pour la campagne « ${c.intitule} ».`);
    }
    attendre(
      200,
      await associe.get(`/api/qualite/revue-froide/campagnes/${c.id}/plan`),
      "plan d'amélioration",
    );
  }
  attendre(
    200,
    await associe.get("/api/qualite/revue-froide/actions"),
    "actions du plan d'amélioration",
  );
}
