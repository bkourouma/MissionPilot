import {
  evaluerGoNoGo,
  rapprocherAppelOffres,
  type StatutAppelOffres,
} from "@missionpilot/engines";
import { lireProfilCabinet } from "../../../appels-offres/fiches.js";
import type { CleCompte } from "../cles.js";
import type { ContexteTenantDemo } from "../contexte.js";
import type { AppelOffresDemo } from "./donnees-ao-liste.js";
import { heure, repondre, uid } from "./ao-fiches-reponse.js";
import type { EvalScenario, ScenarioAo } from "./donnees-ao-scenarios.js";
import { AO_ISSUS_DE_VEILLE } from "./donnees-ao-veille.js";
import { missionDuCasting } from "./outils.js";

/*
 * Historique ANTIDATÉ des appels d'offres clos de la banque d'AO (gagnés, perdus, abandonné).
 *
 * Les routes écrivent `cree_le = now()` et les tables d'historique sont en ajout seul (identité
 * figée par déclencheur) : ces appels d'offres sont donc écrits en SQL propriétaire à la date
 * fictive voulue, en recopiant EXACTEMENT ce que font les services (fiches.ts, go-no-go.ts,
 * exigences.ts, retroplanning.ts). Les chiffres sortent des moteurs (`evaluerGoNoGo`,
 * `rapprocherAppelOffres`, `retroPlanning`, `decouperExigences`). Les déclencheurs de contrôle
 * restent actifs : transitions, décision d'un associé, matrice satisfaite avant le dépôt.
 * Une transaction par appel d'offres : rejouable sans doublon (clé : référence).
 */

async function passer(
  ctx: ContexteTenantDemo,
  aoId: string,
  de: StatutAppelOffres | null,
  vers: StatutAppelOffres,
  motif: string | null,
  auteur: CleCompte,
  quand: string,
): Promise<void> {
  if (de !== null) {
    await ctx.proprietaire.query(
      "UPDATE appels_offres SET statut = $2, modifie_le = $3::timestamptz WHERE id = $1",
      [aoId, vers, quand],
    );
  }
  await ctx.proprietaire.query(
    `INSERT INTO appels_offres_evenements (cabinet_id, ao_id, de_statut, vers_statut, motif,
       auteur_id, cree_le) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)`,
    [ctx.cabinetId, aoId, de, vers, motif, uid(ctx, auteur), quand],
  );
}

async function evaluer(
  ctx: ContexteTenantDemo,
  aoId: string,
  numero: number,
  ev: EvalScenario,
): Promise<string> {
  // FIN-02 : la marge ne se saisit qu'avec `finance.lire` (et `ao.gerer`) : associés seulement.
  if (ev.margeBp !== null && ev.auteur !== "associe" && ev.auteur !== "associe.2") {
    throw new Error(`Marge saisie par « ${ev.auteur} » : réservée aux comptes financiers.`);
  }
  const resultat = evaluerGoNoGo({
    adequation: ev.adequation,
    references: { pertinentes: ev.referencesPertinentes, exigees: ev.referencesExigees },
    charge: { joursDisponibles: ev.joursDisponibles, joursRequis: ev.joursRequis },
    marge: ev.margeBp !== null ? { tauxBp: ev.margeBp, cibleBp: ev.margeCibleBp } : null,
    concurrence: { connus: ev.concurrentsConnus, forts: ev.concurrentsForts },
  });
  const entrees = {
    adequation: ev.adequation,
    references_pertinentes: ev.referencesPertinentes,
    references_exigees: ev.referencesExigees,
    jours_disponibles: ev.joursDisponibles,
    jours_requis: ev.joursRequis,
    concurrents_connus: ev.concurrentsConnus,
    concurrents_forts: ev.concurrentsForts,
    ...(ev.margeBp !== null
      ? { marge_estimee_bp: ev.margeBp, marge_cible_bp: ev.margeCibleBp }
      : {}),
  };
  const r = await ctx.proprietaire.query(
    `INSERT INTO ao_evaluations (cabinet_id, ao_id, numero, entrees, score, recommandation,
       resultat, marge_renseignee, auteur_id, cree_le)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz) RETURNING id`,
    [
      ctx.cabinetId,
      aoId,
      numero,
      JSON.stringify(entrees),
      resultat.score,
      resultat.recommandation,
      JSON.stringify(resultat),
      ev.margeBp !== null,
      uid(ctx, ev.auteur),
      heure(ev.jour, "10:30"),
    ],
  );
  return r.rows[0].id as string;
}

/** Écrit l'appel d'offres et tout son historique ; sans effet s'il existe déjà (clé : référence). */
export async function historiser(
  ctx: ContexteTenantDemo,
  ao: AppelOffresDemo,
  sc: ScenarioAo,
): Promise<boolean> {
  const deja = await ctx.proprietaire.query(
    "SELECT 1 FROM appels_offres WHERE cabinet_id = $1 AND lower(reference) = lower($2)",
    [ctx.cabinetId, ao.reference],
  );
  if (deja.rowCount) return false;
  const profil = await ctx.database.withTenant(ctx.cabinetId, (db) => lireProfilCabinet(db));
  const rap = rapprocherAppelOffres(
    {
      titre: ao.titre,
      objet: ao.objet,
      secteur: ao.secteur,
      pays: ao.pays,
      bailleur: ao.bailleur,
      motsCles: ao.mots_cles,
    },
    profil,
  );
  const veille = AO_ISSUS_DE_VEILLE[sc.cle];
  const mission = ao.mission ? (await missionDuCasting(ctx, ao.mission)).intitule : "";
  await ctx.proprietaire.query("BEGIN");
  try {
    const cree = heure(sc.creeLe, "09:00");
    const r = await ctx.proprietaire.query(
      `INSERT INTO appels_offres (cabinet_id, reference, titre, objet, bailleur, pays, secteur,
         montant_estime, devise, date_publication, date_limite, source, source_libelle, url, mots_cles,
         score_rapprochement, rapprochement, responsable_id, cree_par, cree_le, modifie_le)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
         $20::timestamptz, $20::timestamptz) RETURNING id`,
      [
        ctx.cabinetId,
        ao.reference,
        ao.titre,
        ao.objet,
        ao.bailleur,
        ao.pays,
        ao.secteur,
        ao.montant_estime,
        ao.devise,
        ao.date_publication,
        ao.date_limite,
        veille ? "import" : "saisie",
        veille ? veille.source.libelle : null,
        veille ? `https://avis.exemple.invalid/${ao.reference}` : null,
        [...ao.mots_cles],
        rap.score,
        JSON.stringify(rap),
        uid(ctx, sc.responsable),
        uid(ctx, sc.createur),
        cree,
      ],
    );
    const aoId = r.rows[0].id as string;
    await passer(ctx, aoId, null, "detecte", null, sc.createur, cree);
    const evaluations: string[] = [];
    for (const [i, ev] of sc.evaluations.entries()) {
      evaluations.push(await evaluer(ctx, aoId, i + 1, ev));
      if (i === 0)
        await passer(ctx, aoId, "detecte", "go_no_go", null, ev.auteur, heure(ev.jour, "10:45"));
    }
    const d = sc.decision;
    await ctx.proprietaire.query(
      `INSERT INTO ao_decisions (cabinet_id, ao_id, evaluation_id, decision, motif, decideur_id, cree_le)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)`,
      [
        ctx.cabinetId,
        aoId,
        evaluations[evaluations.length - 1],
        d.choix,
        d.motif,
        uid(ctx, d.decideur),
        heure(d.jour, "11:15"),
      ],
    );
    await passer(
      ctx,
      aoId,
      "go_no_go",
      d.choix === "go" ? "en_reponse" : "no_go",
      d.motif,
      d.decideur,
      heure(d.jour, "11:15"),
    );
    if (sc.reponse) {
      await repondre(ctx, aoId, ao, sc, sc.reponse);
      await passer(
        ctx,
        aoId,
        "en_reponse",
        "depose",
        sc.reponse.motifDepot,
        sc.reponse.deposant,
        heure(sc.reponse.depotJour, "16:00"),
      );
    }
    if (sc.issue) {
      await passer(
        ctx,
        aoId,
        "depose",
        sc.issue.statut,
        sc.issue.motif.replace("{mission}", mission),
        sc.issue.auteur,
        heure(sc.issue.jour, "14:00"),
      );
    }
    await ctx.proprietaire.query("COMMIT");
    return true;
  } catch (erreur) {
    await ctx.proprietaire.query("ROLLBACK");
    throw erreur;
  }
}
