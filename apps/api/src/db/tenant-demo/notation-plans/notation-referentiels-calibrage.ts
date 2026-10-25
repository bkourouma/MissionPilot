import type { ContexteTenantDemo } from "../contexte.js";
import { CALIBRAGES, INITIATIVES } from "./notation-referentiels-donnees.js";
import { exiger, existe, lire } from "./outils.js";

/*
 * Paramètres de confiance, bibliothèque d'initiatives et sessions de calibrage de la notation.
 * Tout passe par les routes /api/notation/** ; les mesures (accord entre évaluateurs, plan
 * d'action) sont calculées par les moteurs, jamais écrites ici. Idempotent par clé naturelle
 * (ligne de paramètres du cabinet, code d'initiative, titre de session, évaluateur).
 */

/** Seuil de confiance et cible de répondants du cabinet : un associé qui n'est pas expert métier. */
export async function semerParametres(ctx: ContexteTenantDemo): Promise<void> {
  if (
    await existe(ctx, "SELECT 1 FROM notation_parametres WHERE cabinet_id = $1", [ctx.cabinetId])
  ) {
    return;
  }
  const r = await ctx
    .session("associe")
    .put("/api/notation/parametres", { seuil_confiance: 0.55, repondants_cible: 3 });
  exiger(r, 200, "Paramètres de confiance de la notation");
}

/** Initiatives types et gains observés (ajout seul) du plan d'action de notation. */
export async function semerInitiatives(ctx: ContexteTenantDemo): Promise<void> {
  for (const def of INITIATIVES) {
    let ligne = (
      await lire<{ id: string; active: boolean }>(
        ctx,
        "SELECT id, active FROM notation_initiatives_types WHERE cabinet_id = $1 AND code = $2",
        [ctx.cabinetId, def.code],
      )
    )[0];
    const session = ctx.session(def.auteur);
    if (!ligne) {
      const r = await session.post("/api/notation/initiatives-types", {
        code: def.code,
        titre: def.titre,
        description: def.description,
        dimensions: def.dimensions,
        effort: def.effort,
        duree_mois: def.duree_mois,
      });
      exiger(r, 201, `Initiative ${def.code}`);
      ligne = { id: r.json().id as string, active: true };
    }
    for (const impact of def.impacts) {
      const present = await existe(
        ctx,
        `SELECT 1 FROM notation_initiatives_impacts WHERE initiative_id = $1 AND source = $2
           AND secteur IS NOT DISTINCT FROM $3 AND taille IS NOT DISTINCT FROM $4`,
        [ligne.id, impact.source, impact.secteur, impact.taille],
      );
      if (present) continue;
      const r = await session.post(`/api/notation/initiatives-types/${ligne.id}/impacts`, {
        secteur: impact.secteur,
        taille: impact.taille,
        gain: impact.gain,
        source: impact.source,
        observe_le: ctx.jour(-impact.il_y_a),
      });
      exiger(r, 201, `Impact de ${def.code}`);
    }
    if (def.retiree && ligne.active) {
      const r = await session.patch(`/api/notation/initiatives-types/${ligne.id}`, {
        active: false,
      });
      exiger(r, 200, `Retrait de l'initiative ${def.code}`);
    }
  }
}

/**
 * Sessions de calibrage entre évaluateurs : double cotation à l'aveugle (une cotation par cas et
 * par évaluateur, ajout seul). La session passée est close par un expert métier avec sa
 * conclusion ; la plus récente reste ouverte. Les niveaux suivent un niveau de référence par cas,
 * avec un écart d'au plus un niveau tiré à graine fixe.
 */
export async function semerCalibrages(ctx: ContexteTenantDemo): Promise<void> {
  const alea = ctx.alea.deriver("notation-calibrages");
  for (const def of CALIBRAGES) {
    let session = (
      await lire<{ id: string; cloturee_le: Date | null }>(
        ctx,
        "SELECT id, cloturee_le FROM notation_calibrations WHERE cabinet_id = $1 AND titre = $2",
        [ctx.cabinetId, def.titre],
      )
    )[0];
    if (!session) {
      const r = await ctx.session("expert.metier").post("/api/notation/calibrations", {
        titre: def.titre,
        cas: def.cas,
        niveaux: def.niveaux,
        tolerance: def.tolerance,
        notation_id: null,
      });
      exiger(r, 201, `Calibrage « ${def.titre} »`);
      session = { id: r.json().id as string, cloturee_le: null };
    }
    for (const cle of def.evaluateurs) {
      // Les tirages sont consommés même si la cotation existe déjà : résultat stable à la reprise.
      const cotations = def.cas.map((c, i) => {
        const reference = def.reference[i] as number;
        const ecart = alea.entier(-1, 1);
        const niveau = Math.min(def.niveaux, Math.max(1, reference + ecart));
        return {
          cas: c.code,
          niveau,
          motif:
            niveau !== reference
              ? "Cotation légèrement différente de la fiche d'ancrage : voir la discussion de la séance."
              : null,
        };
      });
      const dejaCote = await existe(
        ctx,
        `SELECT 1 FROM notation_calibration_cotations WHERE calibration_id = $1
           AND evaluateur_id = $2`,
        [session.id, ctx.utilisateurs[cle]],
      );
      if (dejaCote || session.cloturee_le) continue;
      const r = await ctx.session(cle).post(`/api/notation/calibrations/${session.id}/cotations`, {
        cotations,
      });
      exiger(r, 201, `Cotations de ${cle}`);
    }
    if (def.conclusion && !session.cloturee_le) {
      const r = await ctx
        .session("expert.metier")
        .post(`/api/notation/calibrations/${session.id}/cloturer`, { conclusion: def.conclusion });
      exiger(r, 200, `Clôture du calibrage « ${def.titre} »`);
    }
  }
}
