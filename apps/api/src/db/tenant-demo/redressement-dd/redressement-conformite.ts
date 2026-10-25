import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import {
  appeler,
  creer,
  dateDecision,
  dater,
  debutAppel,
  decider,
  urlD,
  type Json,
} from "./redressement-outils.js";

/*
 * Conformité et financement d'un dossier de redressement : check-lists métier (RED-03), causes
 * racines (RED-04), covenants bancaires et plan de financement (RED-06). Exécution par les routes ;
 * les taux de complétude et de conformité, l'évaluation des covenants et les totaux du plan de
 * financement sont calculés par les moteurs. Les causes racines sont fabriquées par le GABARIT
 * déterministe (aucune clé d'IA) : brouillon IA, puis retouche (« modifié »), puis validation par
 * un compte qui n'est ni le demandeur ni l'auteur d'une retouche.
 */

/* ----- Check-lists ----- */

export type Activation =
  { origine: "depart"; code: string } | { origine: "modele"; modele_id: string };

export async function activerChecklist(
  ctx: ContexteTenantDemo,
  dossierId: string,
  par: SessionDemo,
  activation: Activation,
  jour: string,
): Promise<string> {
  const debut = await debutAppel(ctx);
  const c = await creer(par, urlD(dossierId, "/checklists"), activation, "check-list");
  await dater(ctx, dossierId, debut, jour, "red_checklists");
  return c.id as string;
}

export async function repondre(
  ctx: ContexteTenantDemo,
  dossierId: string,
  checklistId: string,
  par: SessionDemo,
  reponses: readonly unknown[],
  jour: string,
): Promise<void> {
  const debut = await debutAppel(ctx);
  await creer(
    par,
    `/api/redressement/checklists/${checklistId}/reponses`,
    { reponses },
    "réponses",
  );
  await dater(ctx, dossierId, debut, jour, "red_checklist_reponses");
}

/* ----- Causes racines ----- */

/** Demande de cartographie (gabarit sans IA) : brouillon IA, rang 1 de l'historique. */
export async function genererCauses(
  ctx: ContexteTenantDemo,
  dossierId: string,
  demandeur: SessionDemo,
  jour: string,
): Promise<Json> {
  const debut = await debutAppel(ctx);
  const vue = await creer(demandeur, urlD(dossierId, "/causes/generation"), {}, "causes racines");
  if (vue.gabarit !== true) {
    throw new Error("La cartographie des causes devait venir du gabarit (IA désactivée).");
  }
  await dater(ctx, dossierId, debut, jour, "red_causes_versions", "red_causes_historique");
  return vue;
}

/** Retouche par un consultant : nouveau rang « modifié » (texte de la première cause complété). */
export async function retoucherCauses(
  ctx: ContexteTenantDemo,
  dossierId: string,
  auteur: SessionDemo,
  vue: Json,
  precision: string,
  jour: string,
): Promise<void> {
  const causes = (vue.causes as Json[]).map((c) => ({
    id: c.id,
    domaine: c.domaine,
    libelle: c.libelle,
    description: c.description,
    confiance: c.confiance ?? null,
  }));
  const [premiere, ...suite] = causes;
  if (!premiere) throw new Error("Cartographie de causes vide.");
  const debut = await debutAppel(ctx);
  await appeler(
    auteur,
    "patch",
    `/api/redressement/causes/${vue.id}`,
    {
      causes: [
        { ...premiere, description: `${premiere.description} ${precision}`.slice(0, 1000) },
        ...suite,
      ],
    },
    200,
    "causes modifiées",
  );
  await dater(ctx, dossierId, debut, jour, "red_causes_historique");
  await dateDecision(ctx, "causes_modifiee", dossierId, debut, jour);
}

export async function validerCauses(
  ctx: ContexteTenantDemo,
  dossierId: string,
  valideur: SessionDemo,
  causesId: string,
  jour: string,
): Promise<void> {
  const debut = await debutAppel(ctx);
  await decider(valideur, `/api/redressement/causes/${causesId}/validation`, {}, "causes validées");
  await dater(ctx, dossierId, debut, jour, "red_causes_historique");
  await dateDecision(ctx, "causes_valide", dossierId, debut, jour);
}

/* ----- Covenants et plan de financement ----- */

export async function versionCovenants(
  ctx: ContexteTenantDemo,
  dossierId: string,
  par: SessionDemo,
  covenants: readonly unknown[],
  motif: string,
  jour: string,
): Promise<void> {
  const debut = await debutAppel(ctx);
  await creer(par, urlD(dossierId, "/covenants/versions"), { covenants, motif }, "covenants");
  await dater(ctx, dossierId, debut, jour, "red_covenants_versions");
}

export interface LigneFinancement {
  periode: number;
  sens: "emploi" | "ressource";
  nature: string;
  montant: number;
  libelle?: string;
}

export async function versionFinancement(
  ctx: ContexteTenantDemo,
  dossierId: string,
  par: SessionDemo,
  cadre: { date_debut: string; type_periode: "annee" | "semestre"; nombre_periodes: number },
  lignes: readonly LigneFinancement[],
  motif: string,
  jour: string,
): Promise<void> {
  const debut = await debutAppel(ctx);
  await creer(
    par,
    urlD(dossierId, "/financement/versions"),
    { ...cadre, lignes, motif },
    "financement",
  );
  await dater(ctx, dossierId, debut, jour, "red_financement_versions");
}
