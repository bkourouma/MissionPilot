import { ajouterJours } from "@missionpilot/engines";
import { empreinteBilan } from "../../../redressement/cloture.js";
import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import {
  acteurs,
  appliquerSql,
  attendre,
  midi,
  type Acteurs,
  type MissionTrouvee,
} from "./commun.js";

/*
 * Outils du semis du redressement (missions « Brasseries du Wouri » et « Gabon Offshore Services »).
 *
 * - `appeler` : une route de l'API par la session d'un compte, statut attendu vérifié, JSON rendu ;
 * - antidatage : les routes horodatent « maintenant » (`cree_le`, `publiee_le`, `valide_le`,
 *   `clos_le`). Pour que le dossier paraisse avoir vécu pendant la mission, chaque ligne créée est
 *   remontée À SON JOUR juste après l'appel, par une requête LITTÉRALE (nom de table écrit en dur,
 *   jamais interpolé). On repère les lignes à remonter par leur parent (`dossier_id`…) et par
 *   « créée depuis le début de l'appel » (`cree_le >= debut`, horloge du serveur de base) : aucun
 *   identifiant de ligne n'a besoin d'être connu. Ces colonnes sont de simples horodatages de
 *   route (aucune règle métier n'en dépend, hors `clos_le` qui fixe les échéances du suivi).
 */

/** JSON de réponse des routes (forme libre selon la route). */
export type Json = Record<string, unknown>;

export const M = 1_000_000;
export const G = 1_000_000_000;

export const plus = (jour: string, n: number): string => ajouterJours(jour, n);

/* ----- Devise d'une mission ----- */

/** Conversion d'un montant écrit en XOF (données de la mission 7) vers la devise de la mission. */
export type Echelle = (montantXof: number) => number;

/** Identité : XOF et XAF sont à parité fixe, les montants ne changent pas. */
export const ECHELLE_IDENTITE: Echelle = (m) => m;

/**
 * Échelle simple, entière et cohérente. Les schémas attendent des UNITÉS MINEURES (`montantSchema`,
 * packages/shared/src/schemas/commun.ts) : XOF/XAF en francs, EUR/USD en CENTIMES. 1 million de XOF
 * des données = 5 000 USD = 500 000 centimes (donc un chiffre d'affaires de 9 600 millions de XOF
 * = 48 000 000 USD affichés, envoyés en 4 800 000 000 centimes). Les nombres qui ne sont pas des
 * montants (jours, taux, points de base, semaines) ne passent jamais par ici.
 */
export function echelleDevise(devise: string): Echelle {
  if (devise === "XOF" || devise === "XAF") return ECHELLE_IDENTITE;
  if (devise === "USD") return (m) => Math.round(m / 2);
  if (devise === "EUR") return (m) => Math.round((m * 100) / 656);
  throw new Error(`Devise « ${devise} » non prévue par le semis du redressement.`);
}

/** Devise de la mission (figée sur le dossier de redressement à son ouverture). */
export async function deviseDeMission(ctx: ContexteTenantDemo, missionId: string): Promise<string> {
  const r = await ctx.proprietaire.query(
    "SELECT devise FROM missions WHERE id = $1 AND cabinet_id = $2",
    [missionId, ctx.cabinetId],
  );
  const devise = (r.rows[0] as { devise: string } | undefined)?.devise;
  if (!devise) throw new Error(`Mission ${missionId} introuvable pour lire sa devise.`);
  return devise;
}

export type Methode = "get" | "post" | "patch";

/** Appelle une route avec la session donnée ; exige le statut attendu (200 par défaut). */
export async function appeler(
  session: SessionDemo,
  methode: Methode,
  url: string,
  corps: unknown,
  statut: number,
  quoi: string,
): Promise<Json> {
  const r =
    methode === "get"
      ? await session.get(url)
      : methode === "post"
        ? await session.post(url, corps ?? {})
        : await session.patch(url, corps);
  attendre(statut, r, quoi);
  return r.json() as Json;
}

/** POST attendu en 201. */
export const creer = (s: SessionDemo, url: string, corps: unknown, quoi: string): Promise<Json> =>
  appeler(s, "post", url, corps, 201, quoi);
/** POST attendu en 200 (validation, déplacement, statut). */
export const decider = (s: SessionDemo, url: string, corps: unknown, quoi: string): Promise<Json> =>
  appeler(s, "post", url, corps, 200, quoi);
export const lire = (s: SessionDemo, url: string, quoi: string): Promise<Json> =>
  appeler(s, "get", url, undefined, 200, quoi);

export const urlD = (dossierId: string, suffixe = ""): string =>
  `/api/redressement/dossiers/${dossierId}${suffixe}`;

/** Instant courant du serveur de base, à prendre AVANT l'appel dont les lignes seront remontées. */
export async function debutAppel(ctx: ContexteTenantDemo): Promise<string> {
  const r = await ctx.proprietaire.query("SELECT clock_timestamp()::text AS t");
  return (r.rows[0] as { t: string }).t;
}

/** Tables remontées par parent `dossier_id` (colonne `cree_le`) : requêtes littérales. */
const CREATION_PAR_DOSSIER = {
  red_urgences:
    "UPDATE red_urgences SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
  red_scores:
    "UPDATE red_scores SET cree_le = $1::timestamptz, date_reference = ($1::timestamptz AT TIME ZONE 'UTC')::date WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
  red_correspondances:
    "UPDATE red_correspondances SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
  red_tresorerie_versions:
    "UPDATE red_tresorerie_versions SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
  red_tresorerie_realises:
    "UPDATE red_tresorerie_realises SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
  red_creanciers:
    "UPDATE red_creanciers SET cree_le = $1::timestamptz, modifie_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
  red_creances:
    "UPDATE red_creances SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
  red_negociation_evenements:
    "UPDATE red_negociation_evenements SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
  red_actions:
    "UPDATE red_actions SET cree_le = $1::timestamptz, modifie_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
  red_action_evenements:
    "UPDATE red_action_evenements SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
  red_plan_versions:
    "UPDATE red_plan_versions SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
  red_checklists:
    "UPDATE red_checklists SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
  red_checklist_reponses:
    "UPDATE red_checklist_reponses SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
  red_causes_versions:
    "UPDATE red_causes_versions SET cree_le = $1::timestamptz, modifie_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
  red_causes_historique:
    "UPDATE red_causes_historique SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
  red_covenants_versions:
    "UPDATE red_covenants_versions SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
  red_financement_versions:
    "UPDATE red_financement_versions SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
  red_clotures:
    "UPDATE red_clotures SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
  red_suivi_plans:
    "UPDATE red_suivi_plans SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
  red_suivi_jalons:
    "UPDATE red_suivi_jalons SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
  red_suivi_releves:
    "UPDATE red_suivi_releves SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
  red_suivi_evenements:
    "UPDATE red_suivi_evenements SET cree_le = $1::timestamptz WHERE dossier_id = $2 AND cree_le >= $3::timestamptz",
} as const;
export type TableDossier = keyof typeof CREATION_PAR_DOSSIER;

/** Remonte à `jour` (midi UTC) les lignes de ces tables créées depuis `debut` pour ce dossier. */
export async function dater(
  ctx: ContexteTenantDemo,
  dossierId: string,
  debut: string,
  jour: string,
  ...tables: TableDossier[]
): Promise<void> {
  for (const t of tables) {
    await appliquerSql(ctx, CREATION_PAR_DOSSIER[t], [midi(jour), dossierId, debut]);
  }
}

/** Dates de validation, publication ou clôture posées par les routes à « maintenant ». */
const DATE_DECISION = {
  plan_valide:
    "UPDATE red_plan_versions SET valide_le = $1::timestamptz WHERE dossier_id = $2 AND valide_le >= $3::timestamptz",
  cloture_valide:
    "UPDATE red_clotures SET valide_le = $1::timestamptz WHERE dossier_id = $2 AND valide_le >= $3::timestamptz",
  causes_modifiee:
    "UPDATE red_causes_versions SET modifie_le = $1::timestamptz WHERE dossier_id = $2 AND modifie_le >= $3::timestamptz",
  causes_valide:
    "UPDATE red_causes_versions SET valide_le = $1::timestamptz, modifie_le = $1::timestamptz WHERE dossier_id = $2 AND valide_le >= $3::timestamptz",
  dossier_clos:
    "UPDATE red_dossiers SET clos_le = $1::timestamptz, modifie_le = $1::timestamptz WHERE id = $2 AND clos_le >= $3::timestamptz",
  dossier_modifie:
    "UPDATE red_dossiers SET modifie_le = $1::timestamptz WHERE id = $2 AND modifie_le >= $3::timestamptz",
  checklist_archivee:
    "UPDATE red_checklists SET archivee_le = $1::timestamptz WHERE dossier_id = $2 AND archivee_le >= $3::timestamptz",
} as const;
export type Decision = keyof typeof DATE_DECISION;

export async function dateDecision(
  ctx: ContexteTenantDemo,
  quoi: Decision,
  dossierId: string,
  debut: string,
  jour: string,
): Promise<void> {
  await appliquerSql(ctx, DATE_DECISION[quoi], [midi(jour), dossierId, debut]);
}

/** Création du dossier : sa date, et celle de sa dernière modification. */
export async function dateDossier(
  ctx: ContexteTenantDemo,
  dossierId: string,
  jour: string,
): Promise<void> {
  await appliquerSql(
    ctx,
    "UPDATE red_dossiers SET cree_le = $1::timestamptz, modifie_le = $1::timestamptz WHERE id = $2",
    [midi(jour), dossierId],
  );
}

/** Date de dernière modification d'une action (déplacement dans le kanban) et de sa fin. */
export async function dateAction(
  ctx: ContexteTenantDemo,
  actionId: string,
  jour: string,
): Promise<void> {
  await appliquerSql(ctx, "UPDATE red_actions SET modifie_le = $1::timestamptz WHERE id = $2", [
    midi(jour),
    actionId,
  ]);
}

/* ----- Paramétrage du cabinet (seuils, modèles de check-list) ----- */

const CREATION_SEUILS =
  "UPDATE red_seuils_versions SET cree_le = $1::timestamptz WHERE secteur = $2 AND cree_le >= $3::timestamptz AND cabinet_id = $4";
const PUBLICATION_SEUILS =
  "UPDATE red_seuils_versions SET publiee_le = $1::timestamptz WHERE secteur = $2 AND publiee_le >= $3::timestamptz AND cabinet_id = $4";
const CREATION_MODELES =
  "UPDATE red_checklist_modeles SET cree_le = $1::timestamptz WHERE code = $2 AND cree_le >= $3::timestamptz AND cabinet_id = $4";
const CREATION_VERSIONS_MODELE =
  "UPDATE red_checklist_versions SET cree_le = $1::timestamptz WHERE modele_id IN (SELECT id FROM red_checklist_modeles WHERE code = $2 AND cabinet_id = $4) AND cree_le >= $3::timestamptz AND cabinet_id = $4";
const PUBLICATION_VERSIONS_MODELE =
  "UPDATE red_checklist_versions SET publiee_le = $1::timestamptz WHERE modele_id IN (SELECT id FROM red_checklist_modeles WHERE code = $2 AND cabinet_id = $4) AND publiee_le >= $3::timestamptz AND cabinet_id = $4";

export async function dateSeuilsCrees(
  ctx: ContexteTenantDemo,
  secteur: string,
  debut: string,
  jour: string,
): Promise<void> {
  await appliquerSql(ctx, CREATION_SEUILS, [midi(jour), secteur, debut, ctx.cabinetId]);
}
export async function dateSeuilsPublies(
  ctx: ContexteTenantDemo,
  secteur: string,
  debut: string,
  jour: string,
): Promise<void> {
  await appliquerSql(ctx, PUBLICATION_SEUILS, [midi(jour), secteur, debut, ctx.cabinetId]);
}
export async function dateModeleCree(
  ctx: ContexteTenantDemo,
  code: string,
  debut: string,
  jour: string,
): Promise<void> {
  await appliquerSql(ctx, CREATION_MODELES, [midi(jour), code, debut, ctx.cabinetId]);
  await appliquerSql(ctx, CREATION_VERSIONS_MODELE, [midi(jour), code, debut, ctx.cabinetId]);
}
export async function dateVersionModeleCree(
  ctx: ContexteTenantDemo,
  code: string,
  debut: string,
  jour: string,
): Promise<void> {
  await appliquerSql(ctx, CREATION_VERSIONS_MODELE, [midi(jour), code, debut, ctx.cabinetId]);
}
export async function dateVersionModelePubliee(
  ctx: ContexteTenantDemo,
  code: string,
  debut: string,
  jour: string,
): Promise<void> {
  await appliquerSql(ctx, PUBLICATION_VERSIONS_MODELE, [midi(jour), code, debut, ctx.cabinetId]);
}

/** Date de génération du rapport de clôture et de son fichier. */
export async function dateRapport(
  ctx: ContexteTenantDemo,
  missionId: string,
  debut: string,
  jour: string,
): Promise<void> {
  await appliquerSql(
    ctx,
    "UPDATE rapports_mission SET genere_le = $1::timestamptz WHERE mission_id = $2 AND modele = 'cloture_redressement' AND genere_le >= $3::timestamptz",
    [midi(jour), missionId, debut],
  );
}

/** Date de saisie des états financiers du client posés par ce semis. */
export async function dateEtatsClient(
  ctx: ContexteTenantDemo,
  clientId: string,
  debut: string,
  jour: string,
): Promise<void> {
  await appliquerSql(
    ctx,
    "UPDATE dossier_etats_financiers SET cree_le = $1::timestamptz WHERE client_id = $2 AND cree_le >= $3::timestamptz",
    [midi(jour), clientId, debut],
  );
}

/* ----- Contexte de travail d'une mission ----- */

export interface Monde {
  ctx: ContexteTenantDemo;
  a: Acteurs;
  mission: MissionTrouvee;
  dossierId: string;
}

export { acteurs };

/** Identifiant du dossier de redressement d'une mission, ou null si elle n'en a pas. */
export async function dossierDeMission(
  ctx: ContexteTenantDemo,
  missionId: string,
): Promise<string | null> {
  const r = await ctx.proprietaire.query(
    "SELECT id FROM red_dossiers WHERE mission_id = $1 AND cabinet_id = $2",
    [missionId, ctx.cabinetId],
  );
  return (r.rows[0] as { id: string } | undefined)?.id ?? null;
}

/** Identifiant d'utilisateur d'un compte du cabinet (erreur claire s'il manque). */
export function uid(
  ctx: ContexteTenantDemo,
  cle: Parameters<ContexteTenantDemo["session"]>[0],
): string {
  const id = ctx.utilisateurs[cle];
  if (!id) throw new Error(`Utilisateur « ${cle} » introuvable dans le contexte.`);
  return id;
}

/**
 * Date de référence d'un bilan de clôture. La route la fixe au jour RÉEL du serveur et son
 * empreinte couvre le contenu (qui la porte) : après la création (brouillon jamais validé) ou la
 * validation (le contrôle de péremption rejoue le bilan à la date d'origine), la date de référence
 * du bilan, celle de son contenu et l'empreinte sont remontées au jour de CRÉATION du bilan (déjà
 * antidaté). L'empreinte d'origine est vérifiée avant modification.
 */
export async function dateReferenceBilan(ctx: ContexteTenantDemo, bilanId: string): Promise<void> {
  const r = await ctx.proprietaire.query(
    `SELECT contenu, empreinte, (cree_le AT TIME ZONE 'UTC')::date::text AS jour
       FROM red_clotures WHERE id = $1 AND cabinet_id = $2`,
    [bilanId, ctx.cabinetId],
  );
  const l = r.rows[0] as { contenu: Json; empreinte: string; jour: string } | undefined;
  if (!l) throw new Error(`Bilan de clôture ${bilanId} introuvable.`);
  if (empreinteBilan(l.contenu) !== l.empreinte) {
    throw new Error(
      "Empreinte du bilan de clôture non reproductible : date de référence inchangée.",
    );
  }
  const contenu = { ...l.contenu, date_reference: l.jour };
  await appliquerSql(
    ctx,
    "UPDATE red_clotures SET date_reference = $1::date, contenu = $2::jsonb, empreinte = $3 WHERE id = $4 AND cabinet_id = $5",
    [l.jour, JSON.stringify(contenu), empreinteBilan(contenu), bilanId, ctx.cabinetId],
  );
}
