import { attendre, type ContexteTenantDemo } from "../contexte.js";
import type { CleCompte } from "../cles.js";
import {
  methodeCabinet,
  methodeStandard,
  peuplerBrouillon,
  publier,
  type Ajouts,
  type MethodeBase,
} from "./standard-aide.js";
import {
  METHODE_DD,
  METHODE_REDRESSEMENT,
  type DefMethodeCabinet,
} from "./standard-methodes-donnees.js";
import {
  FLASH_V1,
  METHODE_KPI_BROUILLON,
  NOTATION_BROUILLON,
  PLAN_V1,
  PLAN_V2,
} from "./standard-variantes-donnees.js";

/*
 * Méthodes du cabinet : méthodes propres (due diligence, redressement, pilotage des KPI),
 * variantes du standard (plan stratégique, diagnostic flash, notation), versions successives,
 * brouillons laissés en cours. Tout passe par les routes `/api/methodes/**`.
 *
 * Séparation des tâches (STD-02, MPM08) : l'expert métier rédige, un AUTRE utilisateur (associé)
 * publie. Rejouable : chaque méthode est retrouvée par son code ; le contenu s'ajoute par code.
 */

/** Crée la méthode propre (brouillon v1) si besoin, la remplit, la publie si `publierPar`. */
async function assurerMethodePropre(
  ctx: ContexteTenantDemo,
  def: DefMethodeCabinet,
  auteur: CleCompte,
  publierPar: CleCompte | null,
): Promise<void> {
  let m = await methodeCabinet(ctx, def.code);
  if (!m) {
    const service = await ctx.proprietaire.query<{ id: string }>(
      "SELECT id FROM services_conseil WHERE cabinet_id IS NULL AND code = $1",
      [def.service],
    );
    if (!service.rows[0]) throw new Error(`Service « ${def.service} » introuvable.`);
    const r = await ctx.session(auteur).post("/api/methodes", {
      service_id: service.rows[0].id,
      code: def.code,
      libelle: def.libelle,
      description: def.description,
    });
    attendre(201, r, `méthode ${def.code}`);
    m = await methodeCabinet(ctx, def.code);
  }
  if (m?.brouillon) {
    await peuplerBrouillon(ctx, auteur, m.brouillon, def.contenu);
    if (publierPar) await publier(ctx, publierPar, m.brouillon);
  }
  ctx.journal(`  méthode ${def.code} : ${publierPar ? "publiée" : "brouillon"}.`);
}

/** Variante du cabinet d'une méthode du standard (brouillon v1), remplie puis publiée ou laissée. */
async function assurerVariante(
  ctx: ContexteTenantDemo,
  codeStandard: string,
  code: string,
  libelle: string,
  contenu: Ajouts,
  auteur: CleCompte,
  publierPar: CleCompte | null,
): Promise<MethodeBase> {
  let m = await methodeCabinet(ctx, code);
  if (!m) {
    const std = await methodeStandard(ctx, codeStandard);
    const r = await ctx
      .session(auteur)
      .post(`/api/methodes/${std.id}/variantes`, { code, libelle });
    attendre(201, r, `variante ${code}`);
    m = await methodeCabinet(ctx, code);
  }
  if (m?.brouillon) {
    await peuplerBrouillon(ctx, auteur, m.brouillon, contenu);
    if (publierPar) await publier(ctx, publierPar, m.brouillon);
  }
  ctx.journal(`  variante ${code} : ${publierPar ? "publiée" : "brouillon"}.`);
  return (await methodeCabinet(ctx, code)) as MethodeBase;
}

/** Version 2 d'une méthode du cabinet : création (notes obligatoires), contenu, publication. */
async function assurerVersion2(
  ctx: ContexteTenantDemo,
  code: string,
  notes: string,
  contenu: Ajouts,
  auteur: CleCompte,
  publierPar: CleCompte,
): Promise<void> {
  const m = await methodeCabinet(ctx, code);
  if (!m) throw new Error(`Méthode « ${code} » absente : créer d'abord sa version 1.`);
  let brouillon = m.brouillon;
  if (!brouillon) {
    const deja = await ctx.proprietaire.query(
      "SELECT 1 FROM methode_versions WHERE methode_id = $1 AND version >= 2",
      [m.id],
    );
    if (deja.rowCount) return; // version 2 déjà publiée
    const r = await ctx.session(auteur).post(`/api/methodes/${m.id}/versions`, {
      rebaser: false,
      notes_version: notes,
    });
    attendre(201, r, `version 2 de ${code}`);
    brouillon = (r.json() as { id: string }).id;
  }
  await peuplerBrouillon(ctx, auteur, brouillon, contenu);
  await publier(ctx, publierPar, brouillon);
  ctx.journal(`  ${code} : version 2 publiée.`);
}

export async function semerMethodes(ctx: ContexteTenantDemo): Promise<void> {
  // Méthodes propres au cabinet (rédigées par un expert métier, publiées par un associé).
  await assurerMethodePropre(ctx, METHODE_DD, "expert.metier", "associe");
  await assurerMethodePropre(ctx, METHODE_REDRESSEMENT, "expert.metier.2", "associe.2");
  await assurerMethodePropre(ctx, METHODE_KPI_BROUILLON, "expert.metier", null);

  // Variantes du standard : plan stratégique (2 versions), diagnostic flash, notation (brouillon).
  await assurerVariante(
    ctx,
    "plan_strategique",
    "plan_strategique_cabinet",
    "Plan stratégique (cabinet)",
    PLAN_V1,
    "expert.metier",
    "associe",
  );
  await assurerVersion2(
    ctx,
    "plan_strategique_cabinet",
    "Ajout d'une revue par un pair avant la restitution du plan, demandée par les directeurs de mission.",
    PLAN_V2,
    "expert.metier",
    "associe.2",
  );
  await assurerVariante(
    ctx,
    "diagnostic_flash",
    "diagnostic_flash_cabinet",
    "Diagnostic flash (cabinet)",
    FLASH_V1,
    "expert.metier.2",
    "associe",
  );
  await assurerVariante(
    ctx,
    "notation_entreprise",
    "notation_entreprise_cabinet",
    "Notation d'entreprise (cabinet, en cours de revue)",
    NOTATION_BROUILLON,
    "expert.metier.2",
    null,
  );
}
