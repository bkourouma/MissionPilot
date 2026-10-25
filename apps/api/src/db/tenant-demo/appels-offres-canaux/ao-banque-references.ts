import { pdfDemo } from "../../seed-demo-portail.js";
import { attendre, type ContexteTenantDemo } from "../contexte.js";
import type { AttestationDemo, ReferenceDemo } from "./donnees-banque-references.js";
import { REFERENCES_DEMO } from "./donnees-banque-references.js";
import { existe, missionDuCasting, sql, televerser } from "./outils.js";

/*
 * Références et attestations du Tenant démo, par les routes de la banque d'AO : références des
 * missions terminées du casting (liées à leur mission et à leur client) et références historiques,
 * nouvelle version motivée, pièces justificatives (PDF fictifs téléversés) dont une RETIRÉE.
 * Tables en ajout seul : les lignes portent la date du jour d'exécution ; les dates métier
 * (début, fin, attestation) sont celles de l'horloge fictive. Rejouable : clé = titre de la
 * version 1 pour la référence, (type, émetteur, date) pour la pièce.
 */

interface ContenuEnvoye {
  titre: string;
  client_nom: string;
  client_id: string | null;
  mission_id: string | null;
  pays: string;
  secteurs: string[];
  bailleur: string | null;
  montant: number;
  devise: string;
  date_debut: string;
  date_fin: string | null;
  role_cabinet: string;
  description: string;
}

async function contenuDe(ctx: ContexteTenantDemo, ref: ReferenceDemo): Promise<ContenuEnvoye> {
  const { client_nom, ...reste } = ref.contenu;
  let mission_id: string | null = null;
  let client_id: string | null = null;
  let nom = client_nom ?? "";
  if (ref.mission) {
    const m = await missionDuCasting(ctx, ref.mission);
    mission_id = m.id;
    client_id = m.clientId;
    const c = await sql<{ raison_sociale: string }>(
      ctx,
      "SELECT raison_sociale FROM clients WHERE id = $1",
      [m.clientId],
    );
    nom = c[0]?.raison_sociale ?? nom;
  }
  return { ...reste, client_nom: nom, client_id, mission_id };
}

async function idDeLaReference(ctx: ContexteTenantDemo, titre: string): Promise<string | null> {
  const r = await sql<{ id: string }>(
    ctx,
    `SELECT r.id FROM ao_references r
     JOIN ao_reference_versions v ON v.reference_id = r.id AND v.version = 1
     WHERE r.cabinet_id = $1 AND v.titre = $2`,
    [ctx.cabinetId, titre],
  );
  return r[0]?.id ?? null;
}

async function ajouterPiece(
  ctx: ContexteTenantDemo,
  referenceId: string,
  a: AttestationDemo,
): Promise<void> {
  const deja = await existe(
    ctx,
    `SELECT 1 FROM ao_attestations WHERE reference_id = $1 AND type = $2 AND emetteur = $3
       AND date_attestation = $4::date`,
    [referenceId, a.type, a.emetteur, a.date],
  );
  if (deja) return;
  const s = ctx.session(a.ajoutePar);
  const fichierId = await televerser(
    ctx,
    s,
    "/api/fichiers",
    a.fichier,
    pdfDemo(a.lignes[0] ?? a.fichier, [...a.lignes.slice(1), "Document fictif de demonstration."]),
    "application/pdf",
  );
  const r = await s.post(`/api/banque-ao/references/${referenceId}/attestations`, {
    fichier_id: fichierId,
    type: a.type,
    date_attestation: a.date,
    emetteur: a.emetteur,
  });
  attendre(201, r, `attestation ${a.fichier}`);
}

/** Retire (une fois) la pièce marquée « à retirer » : motif obligatoire, par un associé. */
async function retirerPieces(
  ctx: ContexteTenantDemo,
  referenceId: string,
  pieces: readonly AttestationDemo[],
): Promise<void> {
  for (const a of pieces) {
    if (!a.retrait) continue;
    const ligne = (
      await sql<{ id: string; retiree: boolean }>(
        ctx,
        `SELECT id, (retiree_le IS NOT NULL) AS retiree FROM ao_attestations
         WHERE reference_id = $1 AND type = $2 AND emetteur = $3 AND date_attestation = $4::date`,
        [referenceId, a.type, a.emetteur, a.date],
      )
    )[0];
    if (!ligne || ligne.retiree) continue;
    const r = await ctx.session("associe").post(`/api/banque-ao/attestations/${ligne.id}/retrait`, {
      motif: a.retrait,
    });
    attendre(200, r, `retrait de ${a.fichier}`);
  }
}

export async function semerReferences(ctx: ContexteTenantDemo): Promise<void> {
  for (const ref of REFERENCES_DEMO) {
    const contenu = await contenuDe(ctx, ref);
    let id = await idDeLaReference(ctx, contenu.titre);
    if (!id) {
      const r = await ctx.session(ref.createur).post("/api/banque-ao/references", contenu);
      attendre(201, r, `référence « ${contenu.titre} »`);
      id = (r.json() as { id: string }).id;
    }
    if (ref.maj) {
      const versions = (
        await sql<{ n: number }>(
          ctx,
          "SELECT count(*)::int AS n FROM ao_reference_versions WHERE reference_id = $1",
          [id],
        )
      )[0]?.n;
      if (versions === 1) {
        const r = await ctx
          .session(ref.maj.auteur)
          .post(`/api/banque-ao/references/${id}/versions`, {
            contenu: { ...contenu, ...ref.maj.changes },
            motif: ref.maj.motif,
          });
        attendre(201, r, `version 2 de « ${contenu.titre} »`);
      }
    }
    for (const a of ref.attestations) await ajouterPiece(ctx, id, a);
    await retirerPieces(ctx, id, ref.attestations);
  }
}
