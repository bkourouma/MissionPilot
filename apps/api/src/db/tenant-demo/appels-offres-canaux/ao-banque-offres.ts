import { attendre, type ContexteTenantDemo } from "../contexte.js";
import { APPELS_OFFRES_DEMO } from "./donnees-ao-liste.js";
import { OFFRES_TECHNIQUES_DEMO, type OffreTechniqueDemo } from "./donnees-banque-offres.js";
import { existe, sql } from "./outils.js";

/*
 * Offres techniques de la banque d'AO (AO-06), par les routes : brouillon rédigé par l'IA
 * SIMULÉE (aucune clé, aucun réseau : l'orchestrateur replie sur le gabarit déterministe), version
 * humaine qui remplace les repères du gabarit, puis VALIDATION par un compte qui n'est ni le
 * créateur, ni l'auteur d'une version, ni le demandeur de l'IA (MPW05, migration 0385). L'offre de
 * l'appel d'offres en cours reste « modifiée », non validée. Tables en ajout seul : les lignes
 * portent la date du jour d'exécution. Rejouable : clé = appel d'offres de l'offre.
 */

interface DetailOffre {
  id: string;
  statut: string;
  courante: {
    version: number;
    origine: string;
    sections: Record<string, string>;
    chiffres_non_verifies: boolean;
    validation: unknown;
  };
}

export async function ficheDe(ctx: ContexteTenantDemo, cle: string): Promise<string> {
  const ao = APPELS_OFFRES_DEMO.find((x) => x.cle === cle);
  if (!ao) throw new Error(`Appel d'offres « ${cle} » inconnu de la liste de référence.`);
  const l = (
    await sql<{ id: string }>(
      ctx,
      "SELECT id FROM appels_offres WHERE cabinet_id = $1 AND lower(reference) = lower($2)",
      [ctx.cabinetId, ao.reference],
    )
  )[0];
  if (!l) {
    throw new Error(
      `Appel d'offres ${ao.reference} absent : le module « ao-fiches » doit passer avant « ao-banque ».`,
    );
  }
  return l.id;
}

async function lire(ctx: ContexteTenantDemo, offreId: string): Promise<DetailOffre> {
  const r = await ctx.session("chef.mission").get(`/api/banque-ao/offres-techniques/${offreId}`);
  attendre(200, r, "lecture de l'offre technique");
  return r.json() as DetailOffre;
}

/** Crée le brouillon : IA simulée d'abord (compte `ia.utiliser`), gabarit déterministe en repli. */
async function creerBrouillon(
  ctx: ContexteTenantDemo,
  o: OffreTechniqueDemo,
  aoId: string,
  cvIds: Record<string, string>,
): Promise<string> {
  const corps = {
    titre: o.titre,
    appel_offres_id: aoId,
    contexte: o.contexte,
    cv_ids: o.experts.map((k) => cvIds[k]).filter((x): x is string => x !== undefined),
  };
  const s = ctx.session(o.createur);
  let r = await s.post("/api/banque-ao/offres-techniques", { ...corps, generation: "ia" });
  if (r.statusCode !== 201) {
    ctx.journal(
      `  offre ${o.cle} : IA simulée indisponible (${r.statusCode}), gabarit déterministe.`,
    );
    r = await s.post("/api/banque-ao/offres-techniques", { ...corps, generation: "gabarit" });
  }
  attendre(201, r, `offre technique ${o.cle}`);
  return (r.json() as { id: string }).id;
}

async function semerOffreTechnique(
  ctx: ContexteTenantDemo,
  o: OffreTechniqueDemo,
  cvIds: Record<string, string>,
): Promise<void> {
  const aoId = await ficheDe(ctx, o.cle);
  const ligne = (
    await sql<{ id: string }>(
      ctx,
      "SELECT id FROM ao_offres_techniques WHERE cabinet_id = $1 AND appel_offres_id = $2",
      [ctx.cabinetId, aoId],
    )
  )[0];
  const id = ligne?.id ?? (await creerBrouillon(ctx, o, aoId, cvIds));
  let detail = await lire(ctx, id);
  if (detail.courante.version === 1) {
    const r = await ctx
      .session(o.edition.auteur)
      .post(`/api/banque-ao/offres-techniques/${id}/versions`, {
        sections: {
          ...detail.courante.sections,
          comprehension: o.edition.comprehension,
          methodologie: o.edition.methodologie,
        },
        motif: o.edition.motif,
      });
    attendre(201, r, `version humaine de l'offre ${o.cle}`);
    detail = await lire(ctx, id);
  }
  if (!o.valideur) return;
  const validee = await existe(
    ctx,
    "SELECT 1 FROM ao_offre_technique_validations WHERE offre_id = $1",
    [id],
  );
  if (validee) return;
  const v = await ctx
    .session(o.valideur)
    .post(`/api/banque-ao/offres-techniques/${id}/validation`, {
      version: detail.courante.version,
      acquitte_chiffres: detail.courante.chiffres_non_verifies,
    });
  attendre(200, v, `validation de l'offre ${o.cle}`);
}

export async function semerOffresTechniques(
  ctx: ContexteTenantDemo,
  cvIds: Record<string, string>,
): Promise<void> {
  for (const o of OFFRES_TECHNIQUES_DEMO) await semerOffreTechnique(ctx, o, cvIds);
}
