import type { CleCompteCabinet } from "../cles.js";
import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import { json } from "./notations-outils.js";
import { exiger, lire } from "./outils.js";

/*
 * Suivi qualité R3 d'une version de notation (QUA-01 à QUA-06), mené jusqu'à la SIGNATURE par les
 * vraies routes /api/qualite/... : vérification de la définition de terminé et attestations
 * (chef de mission), parcours des éléments de revue par chacun des quatre acteurs, validation du
 * consultant, relecture du chef, revue d'un second expert (quatre yeux), signature du directeur.
 * Le suivi lui-même est ouvert par la soumission en revue de la notation (notations.ts de l'API).
 * Reprise idempotente : chaque étape regarde l'état déjà atteint (statut du suivi, validations).
 */

export interface ActeursQualite {
  /** Vérifie la définition de terminé et relit en tant que chef de mission. */
  chef: CleCompteCabinet;
  /** Valide en tant que consultant (l'auteur de la soumission convient). */
  consultant: CleCompteCabinet;
  /** Second expert (quatre yeux) : ni l'auteur, ni le valideur consultant. */
  second: CleCompteCabinet;
  /** Directeur de la mission, signataire. */
  directeur: CleCompteCabinet;
}

interface Detail {
  suivi: { id: string; statut: string };
  elements: { id: string }[];
  definition: { items: { id: string; controle: string; statut: string }[] };
}

async function detail(s: SessionDemo, id: string): Promise<Detail> {
  const r = await s.get(`/api/qualite/suivis/${id}`);
  exiger(r, 200, "détail du suivi qualité");
  return json<Detail>(r);
}

/** Identifiant du suivi qualité de la version de notation, ou null s'il n'est pas ouvert. */
export async function suiviDeNotation(
  ctx: ContexteTenantDemo,
  notationId: string,
  numero: number,
): Promise<string | null> {
  const r = await lire<{ id: string }>(
    ctx,
    `SELECT id FROM qualite_suivis
      WHERE type_livrable = 'notation' AND livrable_id = $1 AND version = $2`,
    [notationId, numero],
  );
  return r[0]?.id ?? null;
}

/** Chaque élément de revue est parcouru (« vu ») par l'acteur, un à un. */
async function parcourir(s: SessionDemo, suiviId: string): Promise<void> {
  for (const e of (await detail(s, suiviId)).elements) {
    exiger(await s.post(`/api/qualite/suivis/${suiviId}/elements/${e.id}/vu`), 200, "élément vu");
  }
}

async function etapesFaites(ctx: ContexteTenantDemo, suiviId: string): Promise<Set<string>> {
  const r = await lire<{ etape: string }>(
    ctx,
    "SELECT etape FROM qualite_validations WHERE suivi_id = $1",
    [suiviId],
  );
  return new Set(r.map((l) => l.etape));
}

/** Mène le suivi de la version jusqu'à l'état « signé » (sans effet s'il l'est déjà). */
export async function signerSuiviNotation(
  ctx: ContexteTenantDemo,
  notationId: string,
  numero: number,
  a: ActeursQualite,
): Promise<void> {
  const id = await suiviDeNotation(ctx, notationId, numero);
  if (!id)
    throw new Error(`Suivi qualité de la version ${numero} introuvable (soumission faite ?).`);
  const chef = ctx.session(a.chef);
  let d = await detail(chef, id);
  if (d.suivi.statut === "signe") return;

  if (d.suivi.statut === "brouillon") {
    const verif = await chef.post(`/api/qualite/suivis/${id}/verification`);
    exiger(verif, 200, "vérification");
    for (const item of json<Detail>(verif).definition.items) {
      if (item.statut === "non_conforme") {
        throw new Error(`Suivi ${id} : item « ${item.id} » non conforme, signature impossible.`);
      }
      if (item.statut === "non_evaluable" || item.controle === "manuel") {
        const r = await chef.post(`/api/qualite/suivis/${id}/verification/${item.id}/attestation`, {
          commentaire: "Ajustements motivés relus et justifiés ; sources de la note vérifiées.",
        });
        exiger(r, 200, "attestation");
      }
    }
  }
  d = await detail(chef, id);
  if (d.suivi.statut !== "valide") {
    for (const cle of [a.consultant, a.chef, a.second, a.directeur]) {
      await parcourir(ctx.session(cle), id);
    }
    const faites = await etapesFaites(ctx, id);
    const etapes: [CleCompteCabinet, string, string][] = [
      [a.consultant, "validation_consultant", "Notation relue et assumée par le consultant."],
      [
        a.chef,
        "relecture_chef_mission",
        "Relecture du chef de mission : cohérence des ajustements.",
      ],
      [a.second, "revue_second_expert", "Seconde lecture indépendante (quatre yeux) : conforme."],
    ];
    for (const [cle, etape, commentaire] of etapes) {
      if (faites.has(etape)) continue;
      const r = await ctx.session(cle).post(`/api/qualite/suivis/${id}/validations`, {
        etape,
        commentaire,
      });
      exiger(r, 200, `validation ${etape}`);
    }
  }
  // Le signataire a parcouru la revue lui aussi (repris ici si un passage précédent a échoué).
  await parcourir(ctx.session(a.directeur), id);
  const r = await ctx.session(a.directeur).post(`/api/qualite/suivis/${id}/signature`, {
    commentaire: "Bon pour publication.",
  });
  exiger(r, 200, "signature du directeur de mission");
}
