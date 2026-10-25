import type { CleCompte } from "../cles.js";
import { attendre, type ContexteTenantDemo } from "../contexte.js";
import { ELEMENTS } from "./qualite-elements.js";
import { acteur, distribuer, uuidStable, type InfoMission } from "./qualite-outils.js";

/*
 * Suivis qualité ouverts AUJOURD'HUI sur le diagnostic flash de Teranga Logistique, par les vraies
 * routes (/api/qualite/**) sous l'identité de chaque acteur : ouverture, éléments à parcourir,
 * vérification de la définition de terminé, parcours, attestation, étape de la garde. Reprise
 * possible : chaque étape lit l'état du suivi avant d'écrire.
 *  - un état financier R3 en revue, avec une non-conformité ouverte (chiffres sans source) ;
 *  - une fiche R1 validée par son auteur.
 */

interface DetailSuivi {
  suivi: { id: string; statut: string };
  elements: { id: string; vu_par_moi: boolean }[];
  definition: { items: { id: string; controle: string; statut: string }[] };
  validations: { etape: string }[];
  temps_revue: { sessions: unknown[] };
}

async function lire(ctx: ContexteTenantDemo, cle: CleCompte, id: string): Promise<DetailSuivi> {
  const r = await ctx.session(cle).get(`/api/qualite/suivis/${id}`);
  attendre(200, r, "lecture du suivi qualité");
  return r.json() as DetailSuivi;
}

async function ouvrir(
  ctx: ContexteTenantDemo,
  info: InfoMission,
  cle: string,
  type: "etat" | "autre",
  libelle: string,
  auteurId: string,
): Promise<string | null> {
  const livrableId = uuidStable("qualite-vif", info.mission.id, cle);
  const existant = await ctx.proprietaire.query<{ id: string }>(
    "SELECT id FROM qualite_suivis WHERE type_livrable = $1 AND livrable_id = $2 AND version = 1",
    [type, livrableId],
  );
  if (existant.rows[0]) return existant.rows[0].id;
  const r = await ctx.session(info.chef.cle).post("/api/qualite/suivis", {
    mission_id: info.mission.id,
    type_livrable: type,
    livrable_id: livrableId,
    libelle,
    version: 1,
    auteur_id: auteurId,
  });
  attendre(201, r, `ouverture du suivi « ${libelle} »`);
  return (r.json() as DetailSuivi).suivi.id;
}

export async function semerSuivisDuJour(ctx: ContexteTenantDemo, info: InfoMission): Promise<void> {
  const chef = info.chef;
  const sChef = ctx.session(chef.cle);

  // 1. État financier R3 : retraitement des comptes, une non-conformité de traçabilité ouverte.
  const dist = distribuer(ctx, info, "R3", ctx.aujourdhui);
  const idA = await ouvrir(
    ctx,
    info,
    "retraitement",
    "etat",
    "Retraitement des comptes 2023-2025 — Teranga Logistique (version de travail)",
    dist.auteur.id,
  );
  if (idA) {
    let d = await lire(ctx, chef.cle, idA);
    if (d.elements.length === 0) {
      const modeles = ELEMENTS.retraitement;
      const r = await sChef.post(`/api/qualite/suivis/${idA}/elements`, {
        elements: modeles.map((m, i) => ({
          cle: `retraitement:${m.kind}:${i}`,
          kind: m.kind,
          libelle: m.libelle,
          ordre: i * 10,
        })),
      });
      attendre(200, r, "éléments du retraitement");
    }
    if (d.suivi.statut === "brouillon") {
      attendre(
        200,
        await sChef.post(`/api/qualite/suivis/${idA}/verification`),
        "vérification du retraitement",
      );
    }
    d = await lire(ctx, chef.cle, idA);
    // L'auteur parcourt une partie des éléments dans une session de revue encore ouverte.
    const sAuteur = ctx.session(dist.auteur.cle);
    const lus = (await lire(ctx, dist.auteur.cle, idA)).elements;
    const aLire = lus.some((e) => e.vu_par_moi) ? [] : lus.slice(0, 2);
    if (aLire.length > 0) {
      attendre(200, await sAuteur.post(`/api/qualite/suivis/${idA}/sessions`), "session de revue");
      for (const e of aLire)
        attendre(
          200,
          await sAuteur.post(`/api/qualite/suivis/${idA}/elements/${e.id}/vu`),
          "élément vu",
        );
    }
    // Un relecteur qui n'est pas l'auteur atteste le premier item manuel.
    const manuel = d.definition.items.find(
      (i) => i.controle === "manuel" && i.statut !== "atteste",
    );
    if (manuel && !d.definition.items.some((i) => i.statut === "atteste")) {
      const r = await ctx
        .session(acteur(ctx, "directeur.mission").cle)
        .post(`/api/qualite/suivis/${idA}/verification/${manuel.id}/attestation`, {
          commentaire:
            "Chiffres rapprochés des balances transmises par le client ; écarts mineurs expliqués.",
        });
      attendre(200, r, "attestation");
    }
  }

  // 2. Fiche R1 validée par son auteur (le chef de mission).
  const idB = await ouvrir(
    ctx,
    info,
    "fiche-entretiens",
    "autre",
    "Fiche de synthèse des entretiens de cadrage",
    chef.id,
  );
  if (idB) {
    let d = await lire(ctx, chef.cle, idB);
    if (d.elements.length === 0) {
      const r = await sChef.post(`/api/qualite/suivis/${idB}/elements`, {
        elements: ELEMENTS.note.map((m, i) => ({
          cle: `fiche:${m.kind}:${i}`,
          kind: m.kind,
          libelle: m.libelle,
          ordre: i * 10,
        })),
      });
      attendre(200, r, "éléments de la fiche");
    }
    if (d.suivi.statut === "brouillon") {
      attendre(
        200,
        await sChef.post(`/api/qualite/suivis/${idB}/verification`),
        "vérification de la fiche",
      );
    }
    d = await lire(ctx, chef.cle, idB);
    for (const e of d.elements.filter((x) => !x.vu_par_moi)) {
      attendre(
        200,
        await sChef.post(`/api/qualite/suivis/${idB}/elements/${e.id}/vu`),
        "élément vu",
      );
    }
    if (d.suivi.statut === "en_revue" && d.validations.length === 0) {
      const r = await sChef.post(`/api/qualite/suivis/${idB}/validations`, {
        etape: "validation_auteur",
        commentaire: "Fiche relue avant son versement au dossier de la mission.",
      });
      attendre(200, r, "validation de l'auteur");
    }
  }
}
