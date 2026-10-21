import {
  contenuAvancementSchema,
  LIBELLES_STATUT_AVANCEMENT_RAPPORT,
  LIBELLES_STATUT_COMMENTAIRE_AVANCEMENT,
  type AvancementModification,
  type StatutAvancementRapport,
  type StatutCommentaireAvancement,
} from "@missionpilot/shared";
import { lundiDeLaSemaine } from "@missionpilot/engines";
import type { NotificationCreee } from "../notifications/notifier.js";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Database, Db } from "../db/pool.js";
import { AppError, conflit, interdit, introuvable } from "../errors.js";
import { filtreVisibilite, voitToutesLesMissions } from "../missions/acces.js";
import {
  suggererCommentaire,
  type DependancesSuggestionAvancement,
  type RaisonRepliAvancement,
} from "./avancement-ia.js";
import {
  composerPourMission,
  COLONNES_MISSION_AVANCEMENT,
  type MissionAvancement,
} from "./avancement-lecture.js";

/*
 * Rapport d'avancement hebdomadaire au client (AUT-10) : service du cabinet. Le contenu chiffré vient
 * TOUJOURS du moteur (`composerPourMission`) ; le chef de mission ne modifie que la note d'introduction
 * et le commentaire, puis valide. Règles (doublées par le déclencheur de 0307, SQLSTATE MQU01/MQU02) :
 * - modifier, régénérer et valider : droit `avancement.valider` ET être associé, directeur ou chef de
 *   LA mission ; mission visible (404 sinon) ; brouillon seulement (409 sinon : un rapport validé est
 *   figé) ; verrou optimiste par `version` (409 sinon) ;
 * - une suggestion IA non relue (`brouillon_ia`) ne se valide pas ;
 * - le journal d'audit ne contient jamais le texte de l'introduction ni du commentaire.
 */

export const MISSIONS_PAR_LOT_AVANCEMENT = 25;
export const LOTS_MAX_AVANCEMENT = 40;

const lien = (missionId: string) => `/missions/${missionId}/avancement`;
export const lienAvancement = lien;

export const erreurVersion = () =>
  new AppError(
    409,
    "VERSION_CONFLIT",
    "Le rapport a changé depuis votre lecture : rechargez-le avant de continuer.",
  );
export const erreurRapportValide = () =>
  new AppError(409, "RAPPORT_VALIDE", "Rapport d'avancement validé : il est figé.");

/** Associé, ou directeur ou chef DE la mission : ceux qui modifient, régénèrent et valident. */
export function peutValiderAvancement(
  auth: Auth,
  mission: { chef_id: string | null; directeur_id: string | null },
): boolean {
  return (
    auth.roles.includes("associe") ||
    mission.chef_id === auth.utilisateurId ||
    mission.directeur_id === auth.utilisateurId
  );
}

/** Traduit les refus du déclencheur (0307) en erreurs HTTP ; toute autre erreur est relancée. */
export function traduireErreurAvancement(erreur: unknown): unknown {
  const code = (erreur as { code?: unknown } | null)?.code;
  if (code === "MQU01") return erreurRapportValide();
  if (code === "MQU02") return interdit();
  if (code === "MQU05") {
    return new AppError(409, "MISSION_NON_ACTIVE", "La mission n'est ni signée ni en cours.");
  }
  return erreur;
}

export interface LigneRapport {
  id: string;
  mission_id: string;
  mission_intitule: string;
  mission_statut: string;
  chef_id: string | null;
  directeur_id: string | null;
  semaine: string;
  statut: StatutAvancementRapport;
  contenu: unknown;
  introduction: string | null;
  commentaire: string | null;
  commentaire_ia: string | null;
  statut_commentaire: StatutCommentaireAvancement;
  version: number;
  genere_le: Date;
  modifie_le: Date;
  valide_par: string | null;
  valide_par_nom: string | null;
  valide_le: Date | null;
}

const COLONNES_RAPPORT = `r.id, r.mission_id, m.intitule AS mission_intitule,
  m.statut AS mission_statut, m.chef_id, m.directeur_id, r.semaine::text AS semaine, r.statut,
  r.contenu, r.introduction, r.commentaire, r.commentaire_ia, r.statut_commentaire, r.version,
  r.genere_le, r.modifie_le, r.valide_par, vu.nom AS valide_par_nom, r.valide_le`;

const DEPUIS_RAPPORT = `avancement_rapports r JOIN missions m ON m.id = r.mission_id
  LEFT JOIN utilisateurs vu ON vu.id = r.valide_par`;

/** Rapport visible par l'utilisateur (mission visible), sinon 404. `verrouiller` pose FOR UPDATE. */
export async function exigerRapport(
  db: Db,
  auth: Auth,
  id: string,
  verrouiller = false,
): Promise<LigneRapport> {
  const r = await db.query(
    `SELECT ${COLONNES_RAPPORT} FROM ${DEPUIS_RAPPORT}
     WHERE r.id = $1 AND ${filtreVisibilite(2, 3)} ${verrouiller ? "FOR UPDATE OF r" : ""}`,
    [id, voitToutesLesMissions(auth), auth.utilisateurId],
  );
  if (!r.rows[0]) throw introuvable("Rapport d'avancement");
  return r.rows[0] as LigneRapport;
}

/** Vue complète d'un rapport pour le cabinet (jamais de donnée financière : le contenu est celui du moteur). */
export function vueRapport(l: LigneRapport, auth: Auth): Record<string, unknown> {
  const contenu = contenuAvancementSchema.parse(l.contenu);
  return {
    id: l.id,
    mission_id: l.mission_id,
    mission_intitule: l.mission_intitule,
    semaine: l.semaine,
    semaine_fin: contenu.semaine_fin,
    statut: l.statut,
    statut_libelle: LIBELLES_STATUT_AVANCEMENT_RAPPORT[l.statut],
    contenu,
    introduction: l.introduction,
    commentaire: l.commentaire,
    commentaire_ia: l.commentaire_ia,
    statut_commentaire: l.statut_commentaire,
    statut_commentaire_libelle: LIBELLES_STATUT_COMMENTAIRE_AVANCEMENT[l.statut_commentaire],
    version: l.version,
    genere_le: l.genere_le,
    modifie_le: l.modifie_le,
    valide_par: l.valide_par ? { id: l.valide_par, nom: l.valide_par_nom } : null,
    valide_le: l.valide_le,
    peut_valider:
      l.statut === "brouillon" && l.mission_statut !== "cloturee" && peutValiderAvancement(auth, l),
  };
}

/** Ligne de liste : l'essentiel sans le contenu détaillé. */
export function vueLigneRapport(l: LigneRapport): Record<string, unknown> {
  const contenu = contenuAvancementSchema.parse(l.contenu);
  return {
    id: l.id,
    mission_id: l.mission_id,
    semaine: l.semaine,
    semaine_fin: contenu.semaine_fin,
    statut: l.statut,
    statut_libelle: LIBELLES_STATUT_AVANCEMENT_RAPPORT[l.statut],
    avancement_pourcentage: contenu.avancement.pourcentage,
    statut_commentaire: l.statut_commentaire,
    statut_commentaire_libelle: LIBELLES_STATUT_COMMENTAIRE_AVANCEMENT[l.statut_commentaire],
    version: l.version,
    genere_le: l.genere_le,
    valide_le: l.valide_le,
  };
}

/** Rapports d'une mission, du plus récent au plus ancien (page par semaine). */
export async function listerRapports(
  db: Db,
  missionId: string,
  limite: number,
  avant: string | undefined,
): Promise<{ lignes: LigneRapport[]; suivant: string | null }> {
  const r = await db.query(
    `SELECT ${COLONNES_RAPPORT} FROM ${DEPUIS_RAPPORT}
     WHERE r.mission_id = $1 AND ($2::date IS NULL OR r.semaine < $2::date)
     ORDER BY r.semaine DESC LIMIT $3`,
    [missionId, avant ?? null, limite + 1],
  );
  const lignes = r.rows as LigneRapport[];
  const page = lignes.slice(0, limite);
  return {
    lignes: page,
    suivant: lignes.length > limite ? (page[page.length - 1]?.semaine ?? null) : null,
  };
}

export function exigerBrouillonModifiable(auth: Auth, l: LigneRapport, version: number): void {
  if (l.statut === "valide") throw erreurRapportValide();
  if (!peutValiderAvancement(auth, l)) throw interdit();
  if (l.mission_statut === "cloturee") throw conflit("La mission est clôturée.");
  if (l.version !== version) throw erreurVersion();
}

/** Modifie l'introduction et/ou le commentaire d'un brouillon (jamais les chiffres). */
export async function modifierRapport(
  db: Db,
  auth: Auth,
  id: string,
  corps: AvancementModification,
): Promise<LigneRapport> {
  const l = await exigerRapport(db, auth, id, true);
  exigerBrouillonModifiable(auth, l, corps.version);
  const introduction = corps.introduction === undefined ? l.introduction : corps.introduction;
  const commentaire = corps.commentaire === undefined ? l.commentaire : corps.commentaire;
  let statutCommentaire = l.statut_commentaire;
  if (corps.commentaire !== undefined) {
    // Écrire (ou réécrire) le commentaire vaut relecture ; l'effacer rend le commentaire vide.
    statutCommentaire = corps.commentaire === null ? "vide" : "redige";
  }
  try {
    await db.query(
      `UPDATE avancement_rapports SET introduction = $2, commentaire = $3, statut_commentaire = $4,
         modifie_par = $5 WHERE id = $1`,
      [id, introduction, commentaire, statutCommentaire, auth.utilisateurId],
    );
  } catch (e) {
    throw traduireErreurAvancement(e);
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "avancement.modifie",
    entite: "avancement_rapport",
    entiteId: id,
    details: {
      mission_id: l.mission_id,
      semaine: l.semaine,
      champs: [
        ...(corps.introduction !== undefined ? ["introduction"] : []),
        ...(corps.commentaire !== undefined ? ["commentaire"] : []),
      ],
    },
  });
  return exigerRapport(db, auth, id);
}

/** Régénère le contenu chiffré d'un brouillon depuis le moteur (textes du chef conservés). */
export async function regenererRapport(
  db: Db,
  auth: Auth,
  id: string,
  version: number,
  maintenant: Date,
): Promise<LigneRapport> {
  const l = await exigerRapport(db, auth, id, true);
  exigerBrouillonModifiable(auth, l, version);
  const mission: MissionAvancement = {
    id: l.mission_id,
    intitule: l.mission_intitule,
    statut: l.mission_statut,
    client_id: "",
    chef_id: l.chef_id,
    directeur_id: l.directeur_id,
  };
  const contenu = await composerPourMission(
    db,
    auth.cabinetId,
    mission,
    l.semaine,
    maintenant.toISOString().slice(0, 10),
  );
  try {
    await db.query(
      `UPDATE avancement_rapports SET contenu = $2, genere_le = $3, modifie_par = $4 WHERE id = $1`,
      [id, JSON.stringify(contenu), maintenant, auth.utilisateurId],
    );
  } catch (e) {
    throw traduireErreurAvancement(e);
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "avancement.regenere",
    entite: "avancement_rapport",
    entiteId: id,
    details: { mission_id: l.mission_id, semaine: l.semaine },
  });
  return exigerRapport(db, auth, id);
}

/** Valide un brouillon : il devient visible du client sur le portail et figé. */
export async function validerRapport(
  db: Db,
  auth: Auth,
  id: string,
  version: number,
): Promise<LigneRapport> {
  const l = await exigerRapport(db, auth, id, true);
  exigerBrouillonModifiable(auth, l, version);
  if (l.statut_commentaire === "brouillon_ia") {
    throw new AppError(
      409,
      "COMMENTAIRE_IA_A_RELIRE",
      "Le commentaire proposé par l'IA doit être relu (réécrit ou effacé) avant la validation.",
    );
  }
  try {
    await db.query(
      `UPDATE avancement_rapports SET statut = 'valide', valide_par = $2, valide_le = now(),
         modifie_par = $2 WHERE id = $1`,
      [id, auth.utilisateurId],
    );
  } catch (e) {
    throw traduireErreurAvancement(e);
  }
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "avancement.valide",
    entite: "avancement_rapport",
    entiteId: id,
    details: { mission_id: l.mission_id, semaine: l.semaine, client_visible: true },
  });
  return exigerRapport(db, auth, id);
}

/** Fonction activée pour le cabinet (activée sans ligne). La colonne `envoi_email` n'est jamais lue. */
export async function fonctionActive(db: Db): Promise<boolean> {
  const r = await db.query("SELECT actif FROM avancement_parametres");
  return (r.rows[0]?.actif as boolean | undefined) ?? true;
}

export async function lireParametresAvancement(db: Db) {
  const r = await db.query("SELECT actif, modifie_le FROM avancement_parametres");
  return {
    actif: (r.rows[0]?.actif as boolean | undefined) ?? true,
    // Option d'envoi par e-mail : désactivée et non branchée (CHECK en base, aucun code d'envoi).
    envoi_email: false as const,
    modifie_le: (r.rows[0]?.modifie_le as Date | undefined) ?? null,
  };
}

export async function modifierParametresAvancement(db: Db, auth: Auth, actif: boolean) {
  await db.query(
    `INSERT INTO avancement_parametres (cabinet_id, actif, modifie_par)
     VALUES ($1, $2, $3)
     ON CONFLICT (cabinet_id) DO UPDATE
       SET actif = EXCLUDED.actif, modifie_par = EXCLUDED.modifie_par, modifie_le = now()`,
    [auth.cabinetId, actif, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "avancement.parametres",
    entite: "avancement_parametres",
    entiteId: auth.cabinetId,
    details: { actif },
  });
  return lireParametresAvancement(db);
}

/** Lundi (AAAA-MM-JJ) de la semaine de `date`. */
export const lundiDe = (date: Date): string => lundiDeLaSemaine(date.toISOString().slice(0, 10));

/**
 * Génération MANUELLE du brouillon d'une mission pour une semaine (le chef n'attend pas la tâche) :
 * mêmes règles que la tâche (mission signée ou en cours, fonction activée), idempotente.
 */
export async function genererRapportManuel(
  db: Db,
  auth: Auth,
  mission: MissionAvancement,
  semaine: string,
  maintenant: Date,
): Promise<{ id: string; cree: boolean }> {
  if (!peutValiderAvancement(auth, mission)) throw interdit();
  if (!["signee", "en_cours"].includes(mission.statut)) {
    throw new AppError(409, "MISSION_NON_ACTIVE", "La mission n'est ni signée ni en cours.");
  }
  if (!(await fonctionActive(db))) {
    throw new AppError(
      409,
      "FONCTION_DESACTIVEE",
      "Les rapports d'avancement hebdomadaires sont désactivés pour le cabinet.",
    );
  }
  const contenu = await composerPourMission(
    db,
    auth.cabinetId,
    mission,
    semaine,
    maintenant.toISOString().slice(0, 10),
  );
  const ins = await db.query(
    `INSERT INTO avancement_rapports (cabinet_id, mission_id, client_id, semaine, contenu, genere_le)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (mission_id, semaine) DO NOTHING RETURNING id`,
    [auth.cabinetId, mission.id, mission.client_id, semaine, JSON.stringify(contenu), maintenant],
  );
  if (ins.rows[0]) {
    const id = ins.rows[0].id as string;
    await journaliser(db, {
      cabinetId: auth.cabinetId,
      utilisateurId: auth.utilisateurId,
      action: "avancement.genere",
      entite: "avancement_rapport",
      entiteId: id,
      details: { mission_id: mission.id, semaine, origine: "manuelle" },
    });
    return { id, cree: true };
  }
  const existant = await db.query(
    "SELECT id FROM avancement_rapports WHERE mission_id = $1 AND semaine = $2",
    [mission.id, semaine],
  );
  return { id: existant.rows[0].id as string, cree: false };
}

/** Mission (colonnes du rapport) visible de l'utilisateur, sinon 404. */
export async function exigerMissionPourAvancement(
  db: Db,
  auth: Auth,
  missionId: string,
): Promise<MissionAvancement> {
  const r = await db.query(
    `SELECT ${COLONNES_MISSION_AVANCEMENT} FROM missions m
     WHERE m.id = $1 AND ${filtreVisibilite(2, 3)}`,
    [missionId, voitToutesLesMissions(auth), auth.utilisateurId],
  );
  if (!r.rows[0]) throw introuvable("Mission");
  return r.rows[0] as MissionAvancement;
}

/**
 * Suggestion MANUELLE d'un commentaire par l'IA (bouton « suggérer un commentaire ») : brouillon seulement,
 * droit `avancement.valider` (vérifié par la route) ET associé, directeur ou chef de la mission, version
 * lue comme verrou. L'utilisateur qui demande est celui d'imputation (son droit « ia.utiliser » compte).
 * Trois temps : lecture (transaction), appel IA HORS transaction, écriture sous verrou (la version doit
 * être inchangée). Un commentaire déjà rédigé n'est jamais écrasé (409). Repli IA : rien n'est écrit, le
 * motif est renvoyé. Le texte de la suggestion n'entre jamais dans le journal d'audit.
 */
export async function suggererCommentaireRapport(
  database: Database,
  deps: DependancesSuggestionAvancement,
  auth: Auth,
  id: string,
  version: number,
  maintenant: Date,
): Promise<{
  rapport: LigneRapport;
  suggestion: { obtenue: boolean; raison: RaisonRepliAvancement | null };
  notifications: (NotificationCreee | null)[];
}> {
  const lu = await database.withTenant(auth.cabinetId, async (db) => {
    const l = await exigerRapport(db, auth, id);
    exigerBrouillonModifiable(auth, l, version);
    if (l.statut_commentaire === "redige") throw commentaireDejaRedige();
    return l;
  });
  const r = await suggererCommentaire(
    deps,
    auth,
    contenuAvancementSchema.parse(lu.contenu),
    maintenant,
  );
  return database.withTenant(auth.cabinetId, async (db) => {
    const l = await exigerRapport(db, auth, id, true);
    if (r.type === "repli") {
      return {
        rapport: l,
        suggestion: { obtenue: false, raison: r.raison },
        notifications: r.notifications,
      };
    }
    exigerBrouillonModifiable(auth, l, version);
    if (l.statut_commentaire === "redige") throw commentaireDejaRedige();
    try {
      await db.query(
        `UPDATE avancement_rapports SET commentaire_ia = $2, statut_commentaire = 'brouillon_ia',
           modifie_par = $3 WHERE id = $1`,
        [id, r.commentaire, auth.utilisateurId],
      );
    } catch (e) {
      throw traduireErreurAvancement(e);
    }
    await journaliser(db, {
      cabinetId: auth.cabinetId,
      utilisateurId: auth.utilisateurId,
      action: "avancement.commentaire_ia_suggere",
      entite: "avancement_rapport",
      entiteId: id,
      details: { mission_id: l.mission_id, semaine: l.semaine, origine: "manuelle" },
    });
    return {
      rapport: await exigerRapport(db, auth, id),
      suggestion: { obtenue: true, raison: null },
      notifications: r.notifications,
    };
  });
}

const commentaireDejaRedige = () =>
  new AppError(
    409,
    "COMMENTAIRE_DEJA_REDIGE",
    "Un commentaire est déjà rédigé : effacez-le avant de demander une suggestion.",
  );
