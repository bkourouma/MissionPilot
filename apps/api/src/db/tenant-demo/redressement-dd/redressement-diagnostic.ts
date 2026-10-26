import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import type { MissionTrouvee } from "./commun.js";
import { assurerEquipe } from "./commun.js";
import {
  creer,
  dateDecision,
  dateDossier,
  dater,
  debutAppel,
  decider,
  dossierDeMission,
  lire,
  urlD,
  type Json,
} from "./redressement-outils.js";

/*
 * Briques communes du diagnostic d'un dossier de redressement (missions 3 et 7) : ouverture du
 * dossier, correspondance de postes, questionnaire d'urgence, score d'alerte. Les chiffres (voyants,
 * ratios, scores) sont calculés par les moteurs à partir des états du client et des réponses.
 * Chaque ligne est antidatée à son jour fictif (voir redressement-outils.ts).
 */

/** Ajoute l'équipe de la mission (les membres déjà présents sont ignorés). */
export async function constituerEquipe(
  ctx: ContexteTenantDemo,
  mission: MissionTrouvee,
  cles: Parameters<ContexteTenantDemo["session"]>[0][],
): Promise<void> {
  const ids = cles.map((c) => {
    const id = ctx.utilisateurs[c];
    if (!id) throw new Error(`Utilisateur « ${c} » introuvable dans le contexte.`);
    return id;
  });
  await assurerEquipe(ctx, mission.id, ids);
}

/** Ouvre le dossier de la mission (chef de mission) ; erreur claire s'il existe déjà. */
export async function ouvrirDossier(
  ctx: ContexteTenantDemo,
  mission: MissionTrouvee,
  chef: SessionDemo,
  intitule: string,
  secteur: string,
  jour: string,
): Promise<string> {
  if (await dossierDeMission(ctx, mission.id)) {
    throw new Error(`La mission « ${mission.nom} » a déjà un dossier de redressement.`);
  }
  const d = await creer(
    chef,
    `/api/missions/${mission.id}/redressement`,
    { intitule, secteur },
    "dossier de redressement",
  );
  await dateDossier(ctx, d.id as string, jour);
  return d.id as string;
}

/** Nouvelle version de la correspondance de postes (la dernière est la courante). */
export async function poserCorrespondance(
  ctx: ContexteTenantDemo,
  dossierId: string,
  par: SessionDemo,
  postes: unknown,
  motif: string | null,
  jour: string,
): Promise<void> {
  const debut = await debutAppel(ctx);
  await creer(
    par,
    urlD(dossierId, "/correspondances"),
    { postes, ...(motif ? { motif } : {}) },
    "correspondance de postes",
  );
  await dater(ctx, dossierId, debut, jour, "red_correspondances");
}

/** Une évaluation d'urgence. */
export async function saisirUrgence(
  ctx: ContexteTenantDemo,
  dossierId: string,
  par: SessionDemo,
  reponses: unknown,
  commentaire: string,
  jour: string,
): Promise<Json> {
  const debut = await debutAppel(ctx);
  const u = await creer(
    par,
    urlD(dossierId, "/urgences"),
    { reponses, commentaire, duree_secondes: 1_200 + (jour.charCodeAt(9) % 7) * 130 },
    "urgence",
  );
  await dater(ctx, dossierId, debut, jour, "red_urgences");
  return u;
}

/** Un score d'alerte précoce (seuils du secteur en vigueur à cet instant du semis). */
export async function saisirScore(
  ctx: ContexteTenantDemo,
  dossierId: string,
  par: SessionDemo,
  incidents: { rejets: number; retards: number; arrieres: boolean },
  jour: string,
): Promise<Json> {
  const debut = await debutAppel(ctx);
  const s = await creer(
    par,
    urlD(dossierId, "/scores"),
    {
      incidents: {
        rejets_bancaires_12m: incidents.rejets,
        retards_fournisseurs_90j: incidents.retards,
        arrieres_fiscaux_sociaux: incidents.arrieres,
      },
    },
    "score d'alerte",
  );
  await dater(ctx, dossierId, debut, jour, "red_scores");
  return s;
}

/** États financiers acceptés du client : les exercices déjà présents (aucune écriture). */
export async function exercicesAcceptes(session: SessionDemo, clientId: string): Promise<number[]> {
  const r = await lire(session, `/api/dossiers/${clientId}/etats-financiers`, "états du client");
  return (r.elements as Json[])
    .filter((e) => e.statut === "accepte")
    .map((e) => e.exercice as number);
}

/** Passe le dossier au statut « mise en œuvre » (plan validé requis). */
export async function passerEnMiseEnOeuvre(
  ctx: ContexteTenantDemo,
  dossierId: string,
  par: SessionDemo,
  jour: string,
): Promise<void> {
  const debut = await debutAppel(ctx);
  await decider(par, urlD(dossierId, "/statut"), { statut: "mise_en_oeuvre" }, "mise en œuvre");
  await dateDecision(ctx, "dossier_modifie", dossierId, debut, jour);
}
