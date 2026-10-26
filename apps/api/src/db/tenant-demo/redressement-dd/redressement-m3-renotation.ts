import type { CleCompteCabinet } from "../cles.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { COMPLEMENTS, type DefComplement } from "../notation-plans/notations-complement-donnees.js";
import {
  assurerRepondants,
  type RepondantComplement,
} from "../notation-plans/notations-complement-envois.js";
import {
  envoiNotationClos,
  json,
  versionGrilleValidee,
} from "../notation-plans/notations-outils.js";
import { jouerVersions, type Action } from "../notation-plans/notations-parcours.js";
import { suiviDeNotation } from "../notation-plans/notations-qualite.js";
import { exiger, lire } from "../notation-plans/outils.js";
import { versionDe } from "../notation-plans/questionnaires-modeles.js";
import { creerProfil, genererReponses } from "../notation-plans/questionnaires-reponses.js";
import {
  acteursPour,
  assurerEquipe,
  etape,
  MISSIONS,
  trouverMission,
  type MissionTrouvee,
} from "./commun.js";
import { dateursRenotation, JOURS_RENOTATION as J } from "./redressement-m3-renotation-donnees.js";

/*
 * Seconde notation de la mission 3 « Redressement — Brasseries du Wouri » : « après redressement »
 * (novembre 2025), jouée AVANT le bilan de clôture pour que celui-ci voie deux versions publiées
 * (la première, classe E de mars 2025, et cette seconde, plus haute) et que l'item « notation
 * comparable » soit satisfait.
 *
 * Tout passe par les vraies routes : second envoi du modèle « notation_generique » (créé et envoyé
 * par le directeur de la mission, rempli et soumis depuis le portail par les trois mêmes
 * répondants que la version 1, date limite, clôture), puis, sur la notation EXISTANTE de la
 * mission, version 2 : calcul par le consultant (`POST /api/notations/:id/calculs` avec le nouvel
 * `envoi_id`), deux ajustements modérés du chef RÉEL de la mission, soumission par le consultant,
 * suivi qualité signé (chef, consultant, second expert, directeur), publication par l'expert métier
 * `expert.metier.2` (distinct du calculateur, du chef ajusteur et du soumetteur).
 *
 * Les scores et la classe sortent du moteur ; seule la maturité visée des réponses (0,52 contre
 * 0,18 en mars) et les ajustements motivés sont décrits ici. Les routes datent « maintenant » :
 * les dates sont remontées en novembre 2025 par des requêtes littérales (redressement-m3-renotation-
 * donnees.ts), uniquement sur des colonnes de dates, dans l'ordre chronologique. Les fonctions de
 * l'étape « notation-plans » ne sont pas modifiées : elles sont importées, sauf la création du
 * second envoi (leur `lireEnvoi` ne gère qu'un envoi par version de modèle), écrite ici.
 */

/** Maturité moyenne visée des réponses après redressement (vs 0,18 en mars 2025). */
const MATURITE_APRES = 0.52;

const AJUSTEMENTS: DefComplement["ajustements"] = [
  {
    dimension: "couts",
    delta: 2,
    motif:
      "Coût de revient par hectolitre de nouveau suivi chaque mois depuis la remise en service de la ligne.",
  },
  {
    dimension: "pilotage",
    delta: 2,
    motif:
      "Tableau de bord de trésorerie hebdomadaire rétabli et présenté en comité depuis septembre.",
  },
];

/** Clé de compte du cabinet correspondant à un utilisateur (chef et directeur réels de la mission). */
function cleDe(ctx: ContexteTenantDemo, utilisateurId: string, quoi: string): CleCompteCabinet {
  const trouve = Object.entries(ctx.utilisateurs).find(([, id]) => id === utilisateurId);
  if (!trouve) throw new Error(`${quoi} de la mission : aucun compte du casting ne correspond.`);
  return trouve[0] as CleCompteCabinet;
}

/**
 * Second envoi : création et envoi par le directeur, réponses saisies puis soumises depuis le
 * portail par les trois répondants, date limite, clôture. Retourne l'identifiant de l'envoi.
 */
async function envoyerSecondQuestionnaire(
  ctx: ContexteTenantDemo,
  def: DefComplement,
  mission: MissionTrouvee,
  directeur: CleCompteCabinet,
  repondants: readonly RepondantComplement[],
): Promise<string> {
  const precedent = await envoiNotationClos(ctx, mission.id);
  const versionId = await versionDe(ctx, "notation_generique", def.versionModele);
  const s = ctx.session(directeur);
  exiger(
    await s.post(`/api/missions/${mission.id}/questionnaires`, {
      version_id: versionId,
      mode: "par_fonction",
      repondants: repondants.map((x) => ({
        utilisateur_id: x.utilisateurId,
        fonction: x.fonction,
      })),
      relances_auto: true,
      date_limite: null,
    }),
    201,
    "second envoi de notation (brasseries)",
  );
  const [envoi] = await lire<{ id: string; definition: Parameters<typeof genererReponses>[0] }>(
    ctx,
    `SELECT id, definition FROM questionnaire_envois
      WHERE cabinet_id = $1 AND mission_id = $2 AND id <> $3 ORDER BY cree_le DESC LIMIT 1`,
    [ctx.cabinetId, mission.id, precedent],
  );
  if (!envoi) throw new Error("Second envoi de notation introuvable après création.");
  exiger(
    await s.post(`/api/questionnaires/envois/${envoi.id}/envoyer`),
    200,
    "envoi du second questionnaire",
  );

  const alea = ctx.alea.deriver("renotation-brasseries-apres-redressement");
  const profil = creerProfil(MATURITE_APRES, alea);
  for (const r of repondants) {
    const complet = genererReponses(envoi.definition, profil, r.biais, alea, J.reponses[0]);
    exiger(
      await r.session.patch(`/api/portail/questionnaires/${envoi.id}/reponses`, {
        reponses: complet,
      }),
      200,
      `Saisie de ${r.fonction} (seconde notation)`,
    );
    exiger(
      await r.session.post(`/api/portail/questionnaires/${envoi.id}/soumettre`),
      200,
      `Soumission de ${r.fonction} (seconde notation)`,
    );
  }
  exiger(
    await s.patch(`/api/questionnaires/envois/${envoi.id}`, { date_limite: J.limite }),
    200,
    "date limite du second questionnaire",
  );
  exiger(
    await s.post(`/api/questionnaires/envois/${envoi.id}/clore`),
    200,
    "clôture du second questionnaire",
  );
  return envoi.id;
}

/** Actions de la version 2, avec les mêmes rôles que la version 1 (chef et directeur réels). */
function actionsVersion2(
  def: DefComplement,
  chef: CleCompteCabinet,
  directeur: CleCompteCabinet,
): readonly Action[] {
  return [
    { t: "calcul", par: def.calculateur, secteur: null, strategie: "ignorer" },
    ...AJUSTEMENTS.map((a): Action => ({
      t: "ajuster",
      par: chef,
      dimension: a.dimension,
      delta: a.delta,
      motif: a.motif,
    })),
    { t: "soumettre", par: def.calculateur },
    {
      t: "publier",
      par: def.publieur,
      qualite: { chef, consultant: def.calculateur, second: def.secondExpert, directeur },
    },
  ];
}

export async function renoterM3(ctx: ContexteTenantDemo): Promise<void> {
  await etape(ctx, "redressement:m3:renotation", async () => {
    const mission = await trouverMission(ctx, MISSIONS.redressementTermine);
    const existe = await ctx.proprietaire.query(
      "SELECT 1 FROM notations WHERE mission_id = $1 AND cabinet_id = $2",
      [mission.id, ctx.cabinetId],
    );
    if (!existe.rowCount) {
      // La phase « notation-plans » n'est pas passée (semis partiel) : rien à renoter.
      ctx.journal("  mission 3 sans notation : re-notation ignorée.");
      return;
    }
    const a = await acteursPour(ctx, MISSIONS.redressementTermine);
    const chef = cleDe(ctx, a.chef.utilisateurId, "Chef");
    const directeur = cleDe(ctx, a.directeur.utilisateurId, "Directeur");
    const def = COMPLEMENTS.find((c) => c.cle === "complement-brasseries");
    if (!def) throw new Error("Notation complémentaire des Brasseries absente (notation-plans).");

    // Calculateur, experts et chef doivent pouvoir accéder à la mission (déjà membres le plus souvent).
    await assurerEquipe(
      ctx,
      mission.id,
      [def.calculateur, def.publieur, def.secondExpert].map((c) => ctx.utilisateurs[c] as string),
    );

    const lecture = await ctx.session(chef).get(`/api/missions/${mission.id}/notation`);
    exiger(lecture, 200, "lecture de la notation de la mission 3");
    const notation = json<{ id: string; versions: { numero: number; statut: string }[] }>(lecture);
    if (!notation.versions.some((v) => v.numero === 1 && v.statut === "publiee")) {
      throw new Error(
        "Notation de la mission 3 : la version 1 publiée est attendue (notation-plans).",
      );
    }
    if (notation.versions.some((v) => v.numero >= 2)) {
      throw new Error("Notation de la mission 3 : une version 2 existe déjà, rien à faire.");
    }

    // La version 1 ne doit pas porter une date postérieure à la version 2 (dates du semis).
    const envoiV1 = await envoiNotationClos(ctx, mission.id);
    const suiviV1 = await suiviDeNotation(ctx, notation.id, 1);
    if (await dateursRenotation.version1SiNecessaire(ctx, notation.id, envoiV1, suiviV1)) {
      ctx.journal("    version 1 antidatée (mars-avril 2025) pour précéder la version 2.");
    }

    const repondants = await assurerRepondants(ctx, mission.clientId, def.repondants, { n: 0 });
    const envoiId = await envoyerSecondQuestionnaire(ctx, def, mission, directeur, repondants);
    await dateursRenotation.envoi(ctx, envoiId);

    ctx.journal("    seconde notation « après redressement » (version 2)…");
    await jouerVersions(ctx, {
      notationId: notation.id,
      envoiId,
      grilleVersionId: await versionGrilleValidee(ctx, def.grille),
      versions: [[], actionsVersion2(def, chef, directeur)],
    });
    await dateursRenotation.version(
      ctx,
      notation.id,
      2,
      await suiviDeNotation(ctx, notation.id, 2),
    );

    const rapport = await ctx
      .session("associe")
      .get(`/api/notations/${notation.id}/rapport?version=2`);
    exiger(rapport, 200, "rapport de la version 2");
    const g = json(rapport).donnees?.global;
    ctx.journal(`      version 2 : score ${g?.score ?? "?"}, classe ${g?.classe ?? "?"}`);
  });
}
