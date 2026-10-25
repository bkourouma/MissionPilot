import type { ContexteTenantDemo } from "../contexte.js";
import { attendre } from "../contexte.js";
import { texteDossierAo } from "./donnees-ao-dossiers.js";
import type { AppelOffresDemo } from "./donnees-ao-liste.js";
import { existe, sql } from "./outils.js";

/*
 * Appel d'offres EN COURS (réponse en préparation) : écrit par les VRAIES ROUTES, avec le compte
 * qui a le droit (fiche : chef de mission ; marge et décision : associés ; extraction : IA
 * simulée, validée par le directeur de mission). Les dates sont celles du jour d'exécution
 * (les routes écrivent `now()`, qui est la date fictive du seed). Rejouable : chaque étape est
 * retrouvée par comptage avant d'être refaite.
 */

interface Ligne {
  id: string;
  statut: string;
  obligatoire: boolean;
  numero: number;
  libelle: string;
}

const compter = async (ctx: ContexteTenantDemo, texte: string, aoId: string): Promise<number> =>
  Number((await sql<{ n: string }>(ctx, texte, [aoId]))[0]?.n ?? 0);

/** Mélange de statuts de conformité (la matrice n'est pas prête au dépôt : il reste du travail). */
const PLAN_STATUTS: Record<number, { statut: string; commentaire?: string; piece?: string }> = {
  0: { statut: "conforme", piece: "RCCM de moins de trois mois (scan)" },
  1: { statut: "conforme", piece: "Attestations fiscale et sociale" },
  2: { statut: "en_cours" },
  4: {
    statut: "partiel",
    commentaire:
      "Deux références sur trois disponibles ; la troisième est en cours de validation client.",
  },
  5: {
    statut: "non_conforme",
    commentaire: "CV du formateur certifié manquant : candidat à remplacer.",
  },
};

export async function semerEnCours(ctx: ContexteTenantDemo, ao: AppelOffresDemo): Promise<void> {
  const chef = ctx.session("chef.mission");
  const associe = ctx.session("associe");
  const associe2 = ctx.session("associe.2");
  const directeur = ctx.session("directeur.mission");

  if (
    !(await existe(
      ctx,
      "SELECT 1 FROM appels_offres WHERE cabinet_id = $1 AND lower(reference) = lower($2)",
      [ctx.cabinetId, ao.reference],
    ))
  ) {
    const r = await chef.post("/api/appels-offres", {
      reference: ao.reference,
      titre: ao.titre,
      objet: ao.objet,
      bailleur: ao.bailleur,
      pays: ao.pays,
      secteur: ao.secteur,
      montant_estime: ao.montant_estime,
      devise: ao.devise,
      date_publication: ao.date_publication,
      date_limite: ao.date_limite,
      source_libelle: "Site du programme (saisie manuelle)",
      mots_cles: [...ao.mots_cles],
      responsable_id: ctx.utilisateurs["directeur.mission"],
    });
    attendre(201, r, `appel d'offres ${ao.reference}`);
  }
  const ligne = (
    await sql<{ id: string }>(
      ctx,
      "SELECT id FROM appels_offres WHERE cabinet_id = $1 AND lower(reference) = lower($2)",
      [ctx.cabinetId, ao.reference],
    )
  )[0];
  if (!ligne) throw new Error(`Appel d'offres ${ao.reference} introuvable après création.`);
  const aoId = ligne.id;
  const url = `/api/appels-offres/${aoId}`;
  const nbEval = () =>
    compter(ctx, "SELECT count(*) AS n FROM ao_evaluations WHERE ao_id = $1", aoId);

  // Go/no-go : première évaluation sans marge (chef), seconde avec marge (associé : finance.lire).
  const base = {
    references_exigees: 3,
    references_pertinentes: 3,
    jours_disponibles: 100,
    jours_requis: 140,
    concurrents_connus: 5,
    concurrents_forts: 2,
    adequation: 74,
  };
  if ((await nbEval()) < 1)
    attendre(201, await chef.post(`${url}/evaluations`, base), "évaluation 1");
  if ((await nbEval()) < 2) {
    attendre(
      201,
      await associe.post(`${url}/evaluations`, {
        ...base,
        jours_disponibles: 120,
        marge_estimee_bp: 2900,
        marge_cible_bp: 2500,
      }),
      "évaluation 2",
    );
  }
  if ((await compter(ctx, "SELECT count(*) AS n FROM ao_decisions WHERE ao_id = $1", aoId)) === 0) {
    const derniere = (
      await sql<{ id: string }>(
        ctx,
        "SELECT id FROM ao_evaluations WHERE ao_id = $1 ORDER BY numero DESC LIMIT 1",
        [aoId],
      )
    )[0];
    attendre(
      201,
      await associe2.post(`${url}/decision`, {
        evaluation_id: derniere?.id,
        decision: "go",
        motif:
          "Programme régional de référence pour l'accompagnement des PME à l'export : on répond avec l'équipe formation.",
      }),
      "décision go",
    );
  }

  // Dossier, extraction par l'IA simulée (brouillon), puis tri humain.
  if ((await compter(ctx, "SELECT count(*) AS n FROM ao_dossiers WHERE ao_id = $1", aoId)) === 0) {
    attendre(
      201,
      await chef.post(`${url}/dossiers`, {
        texte: texteDossierAo("cemac-formation", ao.titre, ao.bailleur),
      }),
      "dossier",
    );
  }
  if (
    (await compter(ctx, "SELECT count(*) AS n FROM ao_extractions WHERE ao_id = $1", aoId)) === 0
  ) {
    const dossier = (
      await sql<{ id: string }>(
        ctx,
        "SELECT id FROM ao_dossiers WHERE ao_id = $1 ORDER BY numero DESC LIMIT 1",
        [aoId],
      )
    )[0];
    const ext = await directeur.post(`${url}/extractions`, { dossier_id: dossier?.id, mode: "ia" });
    attendre(201, ext, "extraction");
    const brouillon = ext.json() as { id: string; nombre: number; chiffres_non_verifies: boolean };
    // Tri humain : la proposition 4 (validité de l'offre) est écartée, déjà couverte par la lettre de soumission.
    const retenues = Array.from({ length: brouillon.nombre }, (_, i) => i).filter((i) => i !== 3);
    attendre(
      200,
      await directeur.post(`/api/appels-offres/extractions/${brouillon.id}/decision`, {
        decision: "validee",
        retenues,
        acquitte_chiffres: brouillon.chiffres_non_verifies,
      }),
      "validation de l'extraction",
    );
  }

  // Suivi de la matrice (déclencheur : chaque état entre dans `ao_exigences_suivi`).
  const touchees = await compter(
    ctx,
    "SELECT count(*) AS n FROM ao_exigences WHERE ao_id = $1 AND (statut <> 'a_traiter' OR responsable_id IS NOT NULL)",
    aoId,
  );
  if (touchees === 0) {
    const matrice = (await chef.get(`${url}/exigences`)).json() as { exigences: Ligne[] };
    const equipe = [
      ctx.utilisateurs["chef.mission"],
      ctx.utilisateurs["consultant"],
      ctx.utilisateurs["directeur.mission"],
    ];
    for (const [i, x] of matrice.exigences.entries()) {
      const plan = x.obligatoire
        ? PLAN_STATUTS[i % 6]
        : { statut: "conforme", piece: "Éléments joints à l'offre" };
      const corps = { responsable_id: equipe[i % equipe.length], ...(plan ?? {}) };
      attendre(
        200,
        await chef.patch(`/api/appels-offres/exigences/${x.id}`, corps),
        `exigence ${x.numero}`,
      );
    }
  }

  // Rétro-planning, étape confiée par une tâche, décision go cochée, étape d'analyse en retard.
  if (
    (await compter(
      ctx,
      "SELECT count(*) AS n FROM ao_retroplanning_etapes WHERE ao_id = $1",
      aoId,
    )) === 0
  ) {
    const g = await chef.post(`${url}/retroplanning`, {});
    if (g.statusCode !== 201) {
      ctx.journal(`  rétro-planning de ${ao.reference} non généré (HTTP ${g.statusCode}).`);
      return;
    }
  }
  const etapes = (
    (await chef.get(`${url}/retroplanning`)).json() as {
      etapes: {
        id: string;
        code: string;
        faite: boolean;
        date_prevue: string;
        tache_id: string | null;
      }[];
    }
  ).etapes;
  const etape = (code: string) => etapes.find((e) => e.code === code);
  const decisionGo = etape("decision_go");
  if (decisionGo && !decisionGo.faite) {
    attendre(
      200,
      await associe.patch(`/api/appels-offres/retroplanning/${decisionGo.id}`, { faite: true }),
      "étape go cochée",
    );
  }
  const analyse = etape("analyse_dossier");
  if (analyse && analyse.date_prevue !== ctx.jour(-1)) {
    attendre(
      200,
      await directeur.patch(`/api/appels-offres/retroplanning/${analyse.id}`, {
        date_prevue: ctx.jour(-1),
      }),
      "étape d'analyse replanifiée",
    );
  }
  const equipeCv = etape("equipe_cv");
  if (equipeCv && !equipeCv.tache_id) {
    attendre(
      201,
      await directeur.post(`/api/appels-offres/retroplanning/${equipeCv.id}/tache`, {
        assignee_id: ctx.utilisateurs["consultant"],
        description: "Réunir les CV des quatre formateurs certifiés et les diplômes associés.",
      }),
      "étape confiée",
    );
  }
}
