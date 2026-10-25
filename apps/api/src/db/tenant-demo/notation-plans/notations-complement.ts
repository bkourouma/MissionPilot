import type { CleCompteCabinet } from "../cles.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { trouverMission, type MissionTrouvee } from "./casting.js";
import {
  COMPLEMENTS,
  EQUIPE_NOTATION,
  type DefComplement,
} from "./notations-complement-donnees.js";
import { assurerEnvoiNotation, assurerRepondants } from "./notations-complement-envois.js";
import { lierDiagnostic } from "./notations-complement-plans.js";
import { assurerCommentaires, assurerPlans, verifierLectures } from "./notations-extras.js";
import {
  assurerEquipe,
  envoiNotationClos,
  json,
  lierMethodeNotation,
  versionGrilleValidee,
} from "./notations-outils.js";
import { jouerVersions, type Action } from "./notations-parcours.js";
import { exiger, lire } from "./outils.js";

/*
 * Étape « notations-complement » de la phase « notation-plans » : notations PUBLIÉES
 * supplémentaires du cabinet « Tenant démo », pour obtenir des classes A à E variées (les missions
 * 2 et 9 ne donnent que B, C et D) et pour alimenter le lien du diagnostic des plans
 * (plan_diagnostic_notations, que la route n'accepte que vers une notation PUBLIÉE du MÊME client).
 *
 * CE QUI EST CRÉÉ (une notation, une seule version, par mission ; données : notations-complement-donnees.ts)
 * -----------------------------------------------------------------------------------------------------
 *   - mission 1 « Plan stratégique 2025-2028 — SICAFE »            : classe A, publiée ; plan 1 lié ;
 *   - mission 5 « Business plan bancable — Atlantique Retail »     : classe B, publiée ; plan 5 lié ;
 *   - mission 3 « Redressement — Brasseries du Wouri »             : classe E, publiée (pas de plan) ;
 *   - mission 6 « Plan stratégique 2026-2030 — Baobab Assurances » : classe D, publiée ; plan 6 lié.
 * Pour chacune : grille « competitivite-excellence » v1, envoi CLOS du modèle « notation_generique »
 * (3 répondants du portail, réponses de maturité choisie ; la classe, elle, sort du moteur), calcul
 * par la route, deux ajustements motivés modérés du chef de la mission, soumission par le
 * consultant, plan d'action et commentaire IA (brouillon IA, jamais validé d'office), suivi qualité
 * R3 SIGNÉ puis publication par un expert métier distinct du calculateur, du chef (ajusteur) et du
 * soumetteur. La mission est liée à la méthode « notation_entreprise » (journal des moteurs dans
 * notation_versions_methode, comme pour les missions 2 et 9).
 *
 * Chefs et directeurs de mission : retrouvés par SQL (ils diffèrent d'une mission à l'autre).
 * Les missions restent OUVERTES (aucun contournement de clôture).
 * Plan déjà PARTAGÉ au client (plan 1) : la route de lien retire le partage ; il est rétabli par
 * la route de partage du directeur (notations-complement-plans.ts).
 *
 * Idempotent : une notation par mission ; le parcours reprend à la dernière ligne écrite
 * (notations-parcours.ts) ; envoi, comptes de portail, plans, commentaires et lien sont contrôlés.
 */

interface Responsables {
  chef: CleCompteCabinet;
  directeur: CleCompteCabinet;
}

/** Clé de compte du cabinet correspondant à un utilisateur (chef et directeur de la mission). */
function cleDe(
  ctx: ContexteTenantDemo,
  utilisateurId: string | null,
  quoi: string,
): CleCompteCabinet {
  const trouve = Object.entries(ctx.utilisateurs).find(([, id]) => id === utilisateurId);
  if (!trouve) throw new Error(`${quoi} de la mission : aucun compte du casting ne correspond.`);
  return trouve[0] as CleCompteCabinet;
}

async function responsables(
  ctx: ContexteTenantDemo,
  mission: MissionTrouvee,
): Promise<Responsables> {
  const [m] = await lire<{ directeur_id: string | null; chef_id: string | null }>(
    ctx,
    "SELECT directeur_id, chef_id FROM missions WHERE id = $1",
    [mission.id],
  );
  return {
    chef: cleDe(ctx, m?.chef_id ?? null, "Chef"),
    directeur: cleDe(ctx, m?.directeur_id ?? null, "Directeur"),
  };
}

function actions(def: DefComplement, r: Responsables): readonly Action[] {
  return [
    { t: "calcul", par: def.calculateur, secteur: null, strategie: "ignorer" },
    ...def.ajustements.map((a): Action => ({
      t: "ajuster",
      par: r.chef,
      dimension: a.dimension,
      delta: a.delta,
      motif: a.motif,
    })),
    { t: "soumettre", par: def.calculateur },
    {
      t: "publier",
      par: def.publieur,
      qualite: {
        chef: r.chef,
        consultant: def.calculateur,
        second: def.secondExpert,
        directeur: r.directeur,
      },
    },
  ];
}

async function semerComplement(
  ctx: ContexteTenantDemo,
  def: DefComplement,
  crees: { n: number },
): Promise<void> {
  const mission = await trouverMission(ctx, def.mission);
  ctx.journal(`    notation complémentaire « ${mission.intitule} »…`);
  const r = await responsables(ctx, mission);
  await assurerEquipe(ctx, mission.id, r.chef, EQUIPE_NOTATION);
  await lierMethodeNotation(ctx, mission.id, r.chef, def.methode.contexte, def.methode.motif);

  const repondants = await assurerRepondants(ctx, mission.clientId, def.repondants, crees);
  await assurerEnvoiNotation(ctx, def, mission, r.directeur, repondants);

  const lecture = await ctx.session(r.chef).get(`/api/missions/${mission.id}/notation`);
  let notationId: string;
  if (lecture.statusCode === 404) {
    const c = await ctx.session(def.calculateur).post(`/api/missions/${mission.id}/notation`, {});
    exiger(c, 201, "création de la notation");
    notationId = json(c).id;
  } else {
    exiger(lecture, 200, "lecture de la notation");
    notationId = json(lecture).id;
  }

  await jouerVersions(ctx, {
    notationId,
    envoiId: await envoiNotationClos(ctx, mission.id),
    grilleVersionId: await versionGrilleValidee(ctx, def.grille),
    versions: [actions(def, r)],
  });
  await assurerPlans(ctx, notationId, [
    { version: 1, par: def.calculateur, capacite: def.capacitePlan },
  ]);
  await assurerCommentaires(ctx, notationId, [{ version: 1, par: def.calculateur }]);
  await verifierLectures(ctx, notationId, r.chef, [1]);

  const classe = await classeFinale(ctx, notationId);
  ctx.journal(
    `      mission ${def.mission.numero} : classe finale ${classe} (visée ${def.classeVisee})`,
  );
  await lierDiagnostic(ctx, mission, notationId, r.chef, r.directeur);
}

/** Classe de la version publiée lue par la route de rapport (score ajusté rejoué par le moteur). */
async function classeFinale(ctx: ContexteTenantDemo, notationId: string): Promise<string> {
  const res = await ctx.session("associe").get(`/api/notations/${notationId}/rapport?version=1`);
  exiger(res, 200, "rapport de la notation");
  const g = json(res).donnees?.global;
  return `${g?.classe ?? "?"} (${g?.score ?? "?"})`;
}

export async function semerNotationsComplement(ctx: ContexteTenantDemo): Promise<void> {
  const crees = { n: 0 };
  for (const def of COMPLEMENTS) await semerComplement(ctx, def, crees);
  ctx.journal(`    comptes de portail ouverts par cette étape : ${crees.n}`);
}
