import { createHash } from "node:crypto";
import {
  comparerContenusPlan,
  construireContenuPlan,
  evaluerPlanRedressement,
  organiserKanban,
  serialiserContenuPlan,
  type ActionCanonique,
  type ContenuPlan,
} from "@missionpilot/engines";
import {
  aPermission,
  type RedActionVue,
  type RedPlanVersionCreation,
  type RedPlanVersionVue,
  type RedPlanVue,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { estAssocie } from "../missions/acces.js";
import type { MissionAcces } from "../missions/acces.js";
import {
  exigerDossierRedValidation,
  exigerDossierRedVisible,
  type AccesDossierRed,
  type DossierRed,
} from "./acces.js";
import { lireActionsDossier, vueAction, versPlan, type ActionLue } from "./actions.js";
import { dateDuJour } from "./dates.js";
import { journalRed } from "./journal.js";
import { DEBIT_VERSIONS_PLAN, verifierDebit } from "./limites.js";
import { isoOuVide, personne, vueEcartPlan, vueEvaluationPlan } from "./vues.js";

/*
 * Plan de redressement en deux volets et versions de plan (RED-05, RED-07). L'avancement et l'écart
 * avec la version validée sont calculés à la LECTURE par le moteur. Une version de plan est un
 * instantané du plan soumis à validation : son `contenu` est CONSTRUIT par le code depuis les
 * actions (jamais reçu d'un client) et son empreinte (SHA-256 de la forme canonique) est recalculée
 * à la validation : si les actions ont changé, la validation est refusée (RED_PLAN_MODIFIE).
 * Un déplacement dans le kanban (statut, rang) ne change pas le plan. Validation réservée au
 * directeur de la mission (hypothèse métier à valider, VALIDATION_PLAN_RESERVEE_AU_DIRECTEUR), qui n'est
 * pas le créateur de la version (sauf associé) : séparation des tâches contrôlée ici ET en base (MPZ07). Le socle ne produit AUCUN livrable (ni PDF, ni rapport).
 */

const VERSIONS_MAX = 100;

/**
 * HYPOTHÈSE MÉTIER À VALIDER (recette 3a, décision prudente) : la validation d'une version du plan de
 * redressement est RÉSERVÉE au directeur de la mission du dossier (`missions.directeur_id`), en plus du
 * droit `redressement.valider` et de la séparation des tâches (le créateur d'une version ne la valide
 * pas, sauf associé). Une mission SANS directeur (`directeur_id` NULL) ne peut valider ni plan ni bilan
 * de clôture : 409 `DIRECTEUR_REQUIS` (il faut d'abord désigner un directeur de mission). Règle doublée
 * en base (migration 0492, MPZ07). La clôture du dossier garde la règle précédente.
 * Mettre à `false` pour revenir à la règle précédente côté API (la base reste stricte).
 */
export const VALIDATION_PLAN_RESERVEE_AU_DIRECTEUR = true;

/** Cet utilisateur est-il habilité, au regard de la réserve au directeur de la mission ? */
export function respecteReserveDirecteur(
  auth: Auth,
  mission: Pick<MissionAcces, "directeur_id">,
): boolean {
  return (
    !VALIDATION_PLAN_RESERVEE_AU_DIRECTEUR ||
    (mission.directeur_id !== null && mission.directeur_id === auth.utilisateurId)
  );
}

/** 409 `DIRECTEUR_REQUIS` : mission sans directeur, ni plan ni bilan de clôture ne se valident. */
export function exigerDirecteurDeMission(mission: Pick<MissionAcces, "directeur_id">): void {
  if (VALIDATION_PLAN_RESERVEE_AU_DIRECTEUR && mission.directeur_id === null) {
    throw new AppError(
      409,
      "DIRECTEUR_REQUIS",
      "Cette mission n'a pas de directeur : désignez un directeur de mission avant toute validation.",
    );
  }
}

interface VersionPlanLue {
  id: string;
  dossier_id: string;
  version: number;
  date_reference: string;
  /** Chargé seulement pour la version validée la plus récente, ou à la lecture d'une version précise. */
  contenu?: unknown;
  empreinte: string;
  statut: "brouillon" | "valide";
  cree_par: string;
  cree_par_nom: string;
  cree_le: Date;
  valide_par: string | null;
  valide_par_nom: string | null;
  valide_le: Date | null;
  motif_validation: string | null;
}

const COLONNES_SANS_CONTENU = `v.id, v.dossier_id, v.version, v.date_reference::text AS date_reference, v.empreinte,
  v.statut, v.cree_par, uc.nom AS cree_par_nom, v.cree_le, v.valide_par, uv.nom AS valide_par_nom, v.valide_le,
  v.motif_validation`;
const COLONNES = `${COLONNES_SANS_CONTENU}, v.contenu`;
const JOINTURES = `FROM red_plan_versions v JOIN utilisateurs uc ON uc.id = v.cree_par
  LEFT JOIN utilisateurs uv ON uv.id = v.valide_par`;

/** Contenu stocké (forme canonique du moteur) → ContenuPlan ; seuls les champs connus sont lus. */
export function contenuDepuisJson(json: unknown): ContenuPlan {
  const source = (json ?? {}) as { actions?: Record<string, unknown>[] };
  const actions: ActionCanonique[] = (source.actions ?? []).map((a) => ({
    numero: a.numero as number,
    titre: a.titre as string,
    volet: a.volet as ActionCanonique["volet"],
    domaine: a.domaine as ActionCanonique["domaine"],
    echeance: a.echeance as string,
    responsableId: a.responsableId as string,
    levierCode: (a.levierCode as string | null) ?? null,
    impactTresorerieUnique: (a.impactTresorerieUnique as number | null) ?? null,
    impactResultatAnnuel: (a.impactResultatAnnuel as number | null) ?? null,
  }));
  return { version: 1, actions };
}

/** Contenu du plan d'après les actions actuelles (abandonnées exclues), par le moteur. */
export function contenuActuel(actions: readonly ActionLue[]): ContenuPlan {
  return construireContenuPlan(actions.map(versPlan));
}

/** SHA-256 de la forme canonique (clés dans un ordre fixe) : l'empreinte d'un contenu de plan. */
export function empreinteContenu(c: ContenuPlan): string {
  return createHash("sha256").update(serialiserContenuPlan(c), "utf8").digest("hex");
}

const peutValiderRole = (auth: Auth): boolean =>
  aPermission(auth.roles, "redressement.valider") &&
  (auth.roles.includes("associe") || auth.roles.includes("directeur_mission"));

/** Confort d'affichage : même règle que la validation (l'API reste juge). */
function peutValider(
  auth: Auth,
  v: VersionPlanLue,
  derniere: number,
  dossier: DossierRed,
  mission: MissionAcces,
): boolean {
  return (
    v.statut === "brouillon" &&
    v.version === derniere &&
    dossier.statut !== "clos" &&
    peutValiderRole(auth) &&
    respecteReserveDirecteur(auth, mission) &&
    (v.cree_par !== auth.utilisateurId || estAssocie(auth))
  );
}

function vueVersion(v: VersionPlanLue, peut: boolean, avecContenu = false): RedPlanVersionVue {
  return {
    id: v.id,
    version: v.version,
    statut: v.statut,
    date_reference: v.date_reference,
    cree_par: personne(v.cree_par, v.cree_par_nom),
    cree_le: isoOuVide(v.cree_le),
    valide_par: v.valide_par ? personne(v.valide_par, v.valide_par_nom) : null,
    valide_le: v.valide_le ? isoOuVide(v.valide_le) : null,
    motif: v.motif_validation,
    peut_valider: peut,
    ...(avecContenu
      ? {
          contenu: {
            version: 1 as const,
            actions: contenuDepuisJson(v.contenu).actions.map((a) => ({
              numero: a.numero,
              titre: a.titre,
              volet: a.volet,
              domaine: a.domaine,
              echeance: a.echeance,
              responsable_id: a.responsableId,
              levier_code: a.levierCode,
              impact_tresorerie_unique: a.impactTresorerieUnique,
              impact_resultat_annuel: a.impactResultatAnnuel,
            })),
          },
        }
      : {}),
  };
}

/**
 * Versions d'un dossier (100 au plus), SANS leur contenu (jusqu'à 400 Ko chacune) : seul le contenu de la
 * version validée la plus récente est chargé, quand on le demande (écart avec le plan courant).
 */
async function versionsDossier(
  db: Db,
  dossierId: string,
  avecContenuValidee = false,
): Promise<VersionPlanLue[]> {
  const r = await db.query(
    `SELECT ${COLONNES_SANS_CONTENU} ${JOINTURES} WHERE v.dossier_id = $1 ORDER BY v.version DESC LIMIT $2`,
    [dossierId, VERSIONS_MAX],
  );
  const versions = r.rows as VersionPlanLue[];
  const validee = versions.find((v) => v.statut === "valide");
  if (avecContenuValidee && validee) {
    const c = await db.query("SELECT contenu FROM red_plan_versions WHERE id = $1", [validee.id]);
    validee.contenu = c.rows[0]?.contenu;
  }
  return versions;
}

/** Route 29 : kanban, évaluation du moteur, versions et écart avec la version validée. */
export async function lirePlan(
  db: Db,
  auth: Auth,
  { dossier, mission }: AccesDossierRed,
): Promise<RedPlanVue> {
  const dateReference = dateDuJour();
  const lues = await lireActionsDossier(db, dossier.id);
  const plan = lues.map(versPlan);
  const kanban = organiserKanban(plan);
  const parNumero = new Map(lues.map((a) => [a.numero, vueAction(a, dateReference)]));
  const vues = (liste: readonly { numero: number }[]): RedActionVue[] =>
    liste.flatMap((a) => {
      const v = parNumero.get(a.numero);
      return v ? [v] : [];
    });
  const versions = await versionsDossier(db, dossier.id, true);
  const derniere = versions[0]?.version ?? 0;
  const validee = versions.find((v) => v.statut === "valide") ?? null;
  return {
    kanban: {
      colonnes: {
        a_faire: vues(kanban.colonnes.a_faire),
        en_cours: vues(kanban.colonnes.en_cours),
        bloquee: vues(kanban.colonnes.bloquee),
        terminee: vues(kanban.colonnes.terminee),
      },
      abandonnees: vues(kanban.abandonnees),
    },
    evaluation: vueEvaluationPlan(evaluerPlanRedressement(plan, dateReference)),
    date_reference: dateReference,
    versions: versions.map((v) => vueVersion(v, peutValider(auth, v, derniere, dossier, mission))),
    version_validee: validee?.id ?? null,
    ecart_avec_version_validee: validee
      ? vueEcartPlan(
          comparerContenusPlan(construireContenuPlan(plan), contenuDepuisJson(validee.contenu)),
        )
      : null,
  };
}

/** Résumé du plan pour le dossier (route 5). */
export async function resumePlan(db: Db, dossier: DossierRed) {
  const dateReference = dateDuJour();
  const lues = await lireActionsDossier(db, dossier.id);
  const plan = lues.map(versPlan);
  const par: Record<string, number> = {
    a_faire: 0,
    en_cours: 0,
    bloquee: 0,
    terminee: 0,
    abandonnee: 0,
  };
  for (const a of lues) par[a.statut] = (par[a.statut] ?? 0) + 1;
  const versions = await versionsDossier(db, dossier.id, true);
  const validee = versions.find((v) => v.statut === "valide") ?? null;
  const evaluation = evaluerPlanRedressement(plan, dateReference);
  const ecart = validee
    ? comparerContenusPlan(construireContenuPlan(plan), contenuDepuisJson(validee.contenu))
    : null;
  return {
    actions_par_statut: par as Record<
      "a_faire" | "en_cours" | "bloquee" | "terminee" | "abandonnee",
      number
    >,
    en_retard: evaluation.enRetard.length,
    version_courante: versions[0]?.version ?? null,
    modifie_depuis_validation: ecart
      ? ecart.ajoutees.length + ecart.retirees.length + ecart.modifiees.length > 0
      : false,
  };
}

/** Route 35 : nouvelle version (brouillon), contenu construit par le moteur depuis les actions. */
export async function creerVersionPlan(
  db: Db,
  auth: Auth,
  { dossier, mission }: AccesDossierRed,
  corps: RedPlanVersionCreation,
): Promise<RedPlanVersionVue> {
  await verifierDebit(db, auth, DEBIT_VERSIONS_PLAN);
  const contenu = contenuActuel(await lireActionsDossier(db, dossier.id));
  const v = await db.query(
    "SELECT coalesce(max(version), 0) + 1 AS suivante FROM red_plan_versions WHERE dossier_id = $1",
    [dossier.id],
  );
  const version = v.rows[0].suivante as number;
  const r = await db.query(
    `INSERT INTO red_plan_versions (cabinet_id, dossier_id, version, date_reference, contenu, empreinte, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      auth.cabinetId,
      dossier.id,
      version,
      corps.date_reference ?? dateDuJour(),
      serialiserContenuPlan(contenu),
      empreinteContenu(contenu),
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await journalRed(db, auth, "red_plan_version", "creation", id, {
    dossier_id: dossier.id,
    version,
  });
  const lue = await lireVersion(db, id);
  return vueVersion(lue, peutValider(auth, lue, version, dossier, mission), true);
}

async function lireVersion(db: Db, id: string): Promise<VersionPlanLue> {
  const r = await db.query(`SELECT ${COLONNES} ${JOINTURES} WHERE v.id = $1`, [id]);
  if (!r.rows[0]) throw introuvable("Version de plan");
  return r.rows[0] as VersionPlanLue;
}

const separation = (message: string) => new AppError(403, "SEPARATION_DES_TACHES", message);

/**
 * Route 36 : validation d'une version (dossier verrouillé AVANT toute lecture dont une règle dépend).
 * Séparation des tâches, dernière version, contenu inchangé depuis la création, plan complet.
 */
export async function validerVersionPlan(
  db: Db,
  auth: Auth,
  id: string,
  corps: { motif?: string | null | undefined },
): Promise<RedPlanVersionVue> {
  const apercu = await db.query("SELECT dossier_id FROM red_plan_versions WHERE id = $1", [id]);
  if (!apercu.rows[0]) throw introuvable("Version de plan");
  const dossierId = apercu.rows[0].dossier_id as string;
  await exigerDossierRedVisible(db, auth, dossierId).catch(() => {
    throw introuvable("Version de plan");
  });
  const { dossier, mission } = await exigerDossierRedValidation(db, auth, dossierId);
  const versions = await versionsDossier(db, dossierId);
  const v = versions.find((x) => x.id === id);
  if (!v) throw introuvable("Version de plan");
  if (!peutValiderRole(auth)) {
    throw separation("Le plan est validé par un associé ou un directeur de mission.");
  }
  exigerDirecteurDeMission(mission);
  if (!respecteReserveDirecteur(auth, mission)) {
    throw new AppError(
      403,
      "VALIDATION_RESERVEE_DIRECTEUR",
      "Seul le directeur de la mission valide le plan de redressement.",
    );
  }
  if (v.cree_par === auth.utilisateurId && !estAssocie(auth)) {
    throw separation("Le créateur d'une version de plan ne la valide pas lui-même.");
  }
  if (v.statut !== "brouillon") {
    throw new AppError(409, "RED_TRANSITION_INVALIDE", "Cette version de plan est déjà validée.");
  }
  if (v.version !== (versions[0]?.version ?? 0)) {
    throw new AppError(
      409,
      "RED_VERSION_NON_CONSECUTIVE",
      "Une version plus récente existe : seule la dernière version du plan se valide.",
    );
  }
  const actions = await lireActionsDossier(db, dossierId);
  if (empreinteContenu(contenuActuel(actions)) !== v.empreinte) {
    throw new AppError(
      409,
      "RED_PLAN_MODIFIE",
      "Le plan a changé depuis la création de cette version : recréez une version.",
    );
  }
  const bloquants = evaluerPlanRedressement(
    actions.map(versPlan),
    v.date_reference,
  ).bloquantsValidation;
  if (bloquants.length > 0) {
    throw new AppError(
      409,
      "RED_PLAN_INCOMPLET",
      "Le plan est incomplet : il faut au moins une action, dont un quick win.",
      { manquants: [...bloquants] },
    );
  }
  await db.query(
    `UPDATE red_plan_versions SET statut = 'valide', valide_par = $2, valide_le = now(), motif_validation = $3
     WHERE id = $1`,
    [id, auth.utilisateurId, corps.motif ?? null],
  );
  await journalRed(db, auth, "red_plan_version", "validation", id, {
    dossier_id: dossierId,
    version: v.version,
  });
  if (dossier.statut === "ouvert" || dossier.statut === "diagnostic") {
    if (dossier.statut === "ouvert") {
      await db.query(
        "UPDATE red_dossiers SET statut = 'diagnostic', modifie_par = $2 WHERE id = $1",
        [dossierId, auth.utilisateurId],
      );
    }
    await db.query(
      "UPDATE red_dossiers SET statut = 'plan_valide', modifie_par = $2 WHERE id = $1",
      [dossierId, auth.utilisateurId],
    );
    await journalRed(db, auth, "red_dossier", "statut", dossierId, {
      de: dossier.statut,
      vers: "plan_valide",
    });
  }
  const lue = await lireVersion(db, id);
  return vueVersion(lue, false);
}
