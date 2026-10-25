import { veilleCleDedoublonnage, type VeilleAvisBrut } from "@missionpilot/engines";
import { collecter, ingerer, type BilanCollecte } from "../../../appels-offres/veille.js";
import { SOURCES_VEILLE } from "../../../appels-offres/veille-sources.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { resultatsDeLaBanque } from "./ao-veille-banque.js";
import { auteurDe, decisions, heure, sansDecision, transaction } from "./ao-veille-outils.js";
import {
  AVIS_INDEPENDANTS,
  JOUR_ACTIVATION_VEILLE,
  type AvisIndependant,
  type DecisionAvis,
} from "./donnees-ao-veille.js";
import { existe, sql } from "./outils.js";

/*
 * Veille d'appels d'offres SIMULÉE du Tenant démo : sources activées par la route, collecte des
 * sources simulées, avis saisis, résultats retenus puis transformés en fiche (les appels d'offres
 * de la banque, `ao-veille-banque.ts`), écartés avec motif, réexaminé. Aucun réseau.
 *
 * Les services de veille reçoivent la date fictive (`maintenant`) : occurrences et jours de
 * collecte sont antidatés. Les décisions sont en ajout seul : elles sont écrites en SQL
 * propriétaire à leur date, en recopiant `decider` ; les déclencheurs de contrôle (MQA02, MQA05)
 * restent actifs. Rejouable : un résultat qui a déjà ses décisions n'est pas retouché.
 */

const JOUR_COLLECTE = "2026-10-12";

async function activerSources(ctx: ContexteTenantDemo): Promise<void> {
  const chef = ctx.session("chef.mission");
  for (const s of SOURCES_VEILLE) {
    const active = await existe(
      ctx,
      "SELECT 1 FROM ao_veille_sources WHERE cabinet_id = $1 AND code = $2 AND active",
      [ctx.cabinetId, s.code],
    );
    if (active) continue;
    const r = await chef.put(`/api/appels-offres/veille/sources/${s.code}`, { active: true });
    if (r.statusCode !== 200) throw new Error(`Activation de ${s.code} : HTTP ${r.statusCode}.`);
    // La route écrit `now()` : la veille est en service depuis fin 2024 (colonne modifiable).
    const jour = s.code === "sim_presse" ? "2024-11-20" : JOUR_ACTIVATION_VEILLE;
    await ctx.proprietaire.query(
      `UPDATE ao_veille_sources SET modifie_le = $3::timestamptz
       WHERE cabinet_id = $1 AND code = $2 AND modifie_le > $3::timestamptz`,
      [ctx.cabinetId, s.code, heure(jour, "09:00")],
    );
  }
}

const PARCOURS_COLLECTE: Record<string, DecisionAvis[]> = {
  "SIM-MP-001": [
    {
      decision: "ecarter",
      jour: "2026-10-14",
      auteur: "associe.2",
      motif: "Audit légal des comptes : relève du commissariat aux comptes, hors de notre métier.",
    },
  ],
  "SIM-MP-002": [
    {
      decision: "retenir",
      jour: "2026-10-14",
      auteur: "directeur.mission",
      motif: "Gouvernance d'une société d'État : proche de notre diagnostic du ministère gabonais.",
    },
  ],
  "SIM-BL-010": [
    {
      decision: "ecarter",
      jour: "2026-10-15",
      auteur: "chef.mission",
      motif: "Évaluation de programme climatique : aucune référence ni expert environnement.",
    },
  ],
};

/** Collecte des trois sources simulées (une fois), puis premières décisions sur ses résultats. */
async function collecteSimulee(ctx: ContexteTenantDemo): Promise<void> {
  const deja = await existe(
    ctx,
    `SELECT 1 FROM ao_veille_occurrences
     WHERE cabinet_id = $1 AND jour = $2::date AND source_code <> 'saisie'`,
    [ctx.cabinetId, JOUR_COLLECTE],
  );
  if (!deja) {
    const auth = await auteurDe(ctx, "chef.mission");
    const bilan: BilanCollecte = await ctx.database.withTenant(ctx.cabinetId, (db) =>
      collecter(db, auth, undefined, new Date(heure(JOUR_COLLECTE, "08:30"))),
    );
    ctx.journal(`  collecte simulée : ${bilan.nouveaux} nouveaux, ${bilan.doublons} doublons.`);
    // Les résultats créés par la collecte portent `now()` : on les date du jour de collecte.
    await ctx.proprietaire.query(
      `UPDATE ao_veille_resultats SET cree_le = $3::timestamptz, modifie_le = $3::timestamptz
       WHERE cabinet_id = $1 AND statut = 'nouveau' AND cree_le > $2::timestamptz
         AND id IN (SELECT resultat_id FROM ao_veille_occurrences WHERE jour = $4::date)`,
      [ctx.cabinetId, heure("2026-10-13", "00:00"), heure(JOUR_COLLECTE, "08:30"), JOUR_COLLECTE],
    );
  }
  for (const [reference, liste] of Object.entries(PARCOURS_COLLECTE)) {
    const r = (
      await sql<{ id: string }>(
        ctx,
        "SELECT id FROM ao_veille_resultats WHERE cabinet_id = $1 AND reference = $2",
        [ctx.cabinetId, reference],
      )
    )[0];
    if (r && (await sansDecision(ctx, r.id))) {
      await transaction(ctx, () => decisions(ctx, r.id, liste));
    }
  }
}

async function ingererAvis(ctx: ContexteTenantDemo, a: AvisIndependant, brut: VeilleAvisBrut) {
  const auth = await auteurDe(ctx, "chef.mission");
  await ctx.database.withTenant(ctx.cabinetId, async (db) => {
    await ingerer(db, auth, a.source, [brut], new Date(heure(a.jourVu, "08:00")));
    for (const r of a.revus) {
      await ingerer(db, auth, r.source, [brut], new Date(heure(r.jour, "08:15")));
    }
  });
  await ctx.proprietaire.query(
    `UPDATE ao_veille_resultats SET cree_le = $3::timestamptz, modifie_le = $3::timestamptz
     WHERE cabinet_id = $1 AND cle = $2`,
    [ctx.cabinetId, veilleCleDedoublonnage(brut), heure(a.jourVu, "08:00")],
  );
}

/** Avis sans lien avec la banque : saisis ou collectés, puis traités (écartés, réexaminés, retenus). */
async function avisIndependants(ctx: ContexteTenantDemo): Promise<void> {
  for (const a of AVIS_INDEPENDANTS) {
    const brut: VeilleAvisBrut = {
      reference: a.reference,
      titre: a.titre,
      objet: a.objet,
      bailleur: a.bailleur,
      pays: a.pays,
      secteur: a.secteur,
      montant_estime: a.montant_estime,
      devise: a.devise,
      date_publication: a.date_publication,
      date_limite: a.date_limite,
      url: `https://avis.exemple.invalid/${a.reference}`,
      mots_cles: a.mots_cles,
    };
    const cle = veilleCleDedoublonnage(brut);
    const lire = async () =>
      (
        await sql<{ id: string }>(
          ctx,
          "SELECT id FROM ao_veille_resultats WHERE cabinet_id = $1 AND cle = $2",
          [ctx.cabinetId, cle],
        )
      )[0];
    if (!(await lire())) await ingererAvis(ctx, a, brut);
    const resultat = await lire();
    if (resultat && a.decisions.length > 0 && (await sansDecision(ctx, resultat.id))) {
      await transaction(ctx, () => decisions(ctx, resultat.id, a.decisions));
    }
  }
}

export async function semerVeilleAo(ctx: ContexteTenantDemo): Promise<void> {
  await activerSources(ctx);
  await collecteSimulee(ctx);
  await resultatsDeLaBanque(ctx);
  await avisIndependants(ctx);
}
