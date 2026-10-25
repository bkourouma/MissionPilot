import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import {
  creer,
  dateDecision,
  dateRapport,
  dater,
  debutAppel,
  decider,
  lire,
  urlD,
  type Json,
} from "./redressement-outils.js";

/*
 * Clôture d'un dossier de redressement et suivi post-mission (RED-08, RED-09). Le bilan de
 * clôture est CONSTRUIT par le serveur depuis les moteurs (jamais saisi) ; il se valide avant la
 * clôture du dossier, par le DIRECTEUR de la mission (compte différent du créateur du bilan). La
 * clôture fixe `clos_le`, sur lequel le moteur du suivi calcule les échéances des jalons (6 et 12
 * mois) : la date de clôture est donc remontée à son jour fictif AVANT la création du plan de
 * suivi. Le rapport de clôture n'existe que pour un bilan validé.
 */

/** Nouveau bilan (brouillon) depuis l'état courant du dossier. */
export async function construireBilan(
  ctx: ContexteTenantDemo,
  dossierId: string,
  par: SessionDemo,
  jour: string,
): Promise<Json> {
  const debut = await debutAppel(ctx);
  const b = await creer(par, urlD(dossierId, "/clotures"), {}, "bilan de clôture");
  await dater(ctx, dossierId, debut, jour, "red_clotures");
  return b;
}

export async function validerBilan(
  ctx: ContexteTenantDemo,
  dossierId: string,
  directeur: SessionDemo,
  bilanId: string,
  motif: string,
  jour: string,
): Promise<void> {
  const debut = await debutAppel(ctx);
  await decider(
    directeur,
    `/api/redressement/clotures/${bilanId}/validation`,
    { motif },
    "validation du bilan de clôture",
  );
  await dateDecision(ctx, "cloture_valide", dossierId, debut, jour);
}

/** Clôture du dossier (motif d'au moins 10 caractères), par le directeur de la mission. */
export async function cloreDossier(
  ctx: ContexteTenantDemo,
  dossierId: string,
  directeur: SessionDemo,
  motif: string,
  jour: string,
): Promise<void> {
  const debut = await debutAppel(ctx);
  await decider(
    directeur,
    urlD(dossierId, "/statut"),
    { statut: "clos", motif },
    "clôture du dossier",
  );
  await dateDecision(ctx, "dossier_clos", dossierId, debut, jour);
}

/** Rapport de clôture (document Word) d'un bilan validé. */
export async function genererRapportCloture(
  ctx: ContexteTenantDemo,
  missionId: string,
  bilanId: string,
  par: SessionDemo,
  jour: string,
): Promise<void> {
  const debut = await debutAppel(ctx);
  await creer(
    par,
    `/api/redressement/clotures/${bilanId}/rapports?format=docx`,
    {},
    "rapport de clôture",
  );
  await dateRapport(ctx, missionId, debut, jour);
}

/* ----- Suivi post-mission ----- */

/** Plan de suivi (jalons à 6 et 12 mois après la clôture) : dossier clos requis. */
export async function creerPlanSuivi(
  ctx: ContexteTenantDemo,
  dossierId: string,
  par: SessionDemo,
  jour: string,
): Promise<Json> {
  const debut = await debutAppel(ctx);
  const suivi = await creer(par, urlD(dossierId, "/suivi"), {}, "plan de suivi");
  await dater(ctx, dossierId, debut, jour, "red_suivi_plans", "red_suivi_jalons");
  return suivi;
}

export async function saisirReleve(
  ctx: ContexteTenantDemo,
  dossierId: string,
  par: SessionDemo,
  jalonId: string,
  releve: { jour: string; ratios: Record<string, number>; commentaire: string },
  jourSaisie: string,
): Promise<void> {
  const debut = await debutAppel(ctx);
  await creer(
    par,
    urlD(dossierId, "/suivi/releves"),
    {
      jalon_id: jalonId,
      date_releve: releve.jour,
      source: "saisie",
      ratios: releve.ratios,
      commentaire: releve.commentaire,
    },
    "relevé de suivi",
  );
  await dater(ctx, dossierId, debut, jourSaisie, "red_suivi_releves");
}

export async function evenementJalon(
  ctx: ContexteTenantDemo,
  dossierId: string,
  par: SessionDemo,
  jalonId: string,
  evenement: { type: "realise" | "reporte"; dateEffet: string; motif?: string },
  jourSaisie: string,
): Promise<void> {
  const debut = await debutAppel(ctx);
  await creer(
    par,
    urlD(dossierId, `/suivi/jalons/${jalonId}/evenements`),
    {
      type: evenement.type,
      date_effet: evenement.dateEffet,
      ...(evenement.motif ? { motif: evenement.motif } : {}),
    },
    `événement ${evenement.type} du jalon`,
  );
  await dater(ctx, dossierId, debut, jourSaisie, "red_suivi_evenements");
}

export async function jalonsDuSuivi(
  par: SessionDemo,
  dossierId: string,
): Promise<{ id: string; rang: number; date_prevue: string }[]> {
  const suivi = await lire(par, urlD(dossierId, "/suivi"), "suivi");
  return suivi.jalons as { id: string; rang: number; date_prevue: string }[];
}
