import { agregerTempsRevue, type TempsRevue } from "@missionpilot/engines";
import type { ElementRevueSaisi, KindElementRevue, TypeLivrable } from "@missionpilot/shared";
import { elementRevueSchema } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { conflit, introuvable } from "../errors.js";
import type { Suivi } from "./donnees.js";

/*
 * Revue guidée (QUA-03). Le relecteur parcourt d'abord les assertions fragiles, les chiffres et
 * les recommandations ; SA validation est refusée tant que LUI-MÊME n'a pas parcouru tous les
 * éléments obligatoires (un « vu » d'un autre relecteur ne le dispense pas : le risque visé est
 * celui qui valide sans lire). Le temps de revue est mesuré par sessions.
 *
 * SERVICE INTERNE pour les autres modules : `ajouterElementsRevue` dépose les éléments à parcourir
 * (assertions sans preuve, chiffres et leur source, recommandations) ; aucune dépendance en sens
 * inverse. Idempotent : une clé déjà déposée est ignorée.
 */

/** Plafond d'une session de revue (une session oubliée ouverte ne gonfle pas le temps mesuré). */
export const DUREE_SESSION_MAX_SECONDES = 7200;

export interface ElementRevueEntree {
  /** Clé stable chez l'appelant (ex. « plan:<id>:axe:<id> ») : re-déposer la même clé est sans effet. */
  cle: string;
  kind: KindElementRevue;
  libelle: string;
  ordre?: number;
  /** Défaut : vrai. */
  obligatoire?: boolean;
  /** Source d'un chiffre (preuve, moteur de calcul, donnée). */
  source?: string | null;
  /** Renvoi vers l'objet du module d'origine. */
  reference?: string | null;
}

export interface CibleSuivi {
  suiviId?: string;
  type?: TypeLivrable;
  livrableId?: string;
  version?: number;
}

/** Suivi non validé désigné par son identifiant, ou par (type, livrable, version) ; sinon 404. */
export async function trouverSuiviOuvert(db: Db, cible: CibleSuivi): Promise<Suivi> {
  const r = cible.suiviId
    ? await db.query("SELECT * FROM qualite_suivis WHERE id = $1", [cible.suiviId])
    : await db.query(
        `SELECT * FROM qualite_suivis WHERE type_livrable = $1 AND livrable_id = $2
           AND ($3::integer IS NULL OR version = $3)
         ORDER BY version DESC LIMIT 1`,
        [cible.type ?? null, cible.livrableId ?? null, cible.version ?? null],
      );
  const suivi = r.rows[0] as Suivi | undefined;
  if (!suivi) throw introuvable("Suivi qualité");
  return suivi;
}

/**
 * Dépose des éléments à parcourir sur le suivi d'un livrable (service interne : les modules plans,
 * rapports et preuves l'appellent dans LEUR transaction). `par` : l'utilisateur (ou null si un
 * agent). Aucun droit n'est vérifié ici : l'appelant a déjà exigé le sien. Refuse (409) un suivi
 * validé ou signé. Renvoie le nombre d'éléments ajoutés et ignorés (clé déjà déposée).
 */
export async function ajouterElementsRevue(
  db: Db,
  cabinetId: string,
  par: string | null,
  cible: CibleSuivi,
  elements: readonly ElementRevueEntree[],
): Promise<{ suivi_id: string; ajoutes: number; ignores: number }> {
  const suivi = await trouverSuiviOuvert(db, cible);
  if (suivi.statut === "valide" || suivi.statut === "signe") {
    throw conflit("Le suivi qualité est validé : le parcours de revue est clos.");
  }
  let ajoutes = 0;
  for (const brut of elements) {
    const e = elementRevueSchema.parse(brut as ElementRevueSaisi);
    const r = await db.query(
      `INSERT INTO qualite_revue_elements
         (cabinet_id, suivi_id, cle, kind, libelle, ordre, obligatoire, source, reference, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (suivi_id, cle) DO NOTHING RETURNING id`,
      [
        cabinetId,
        suivi.id,
        e.cle,
        e.kind,
        e.libelle,
        e.ordre,
        e.obligatoire,
        e.source ?? null,
        e.reference ?? null,
        par,
      ],
    );
    ajoutes += r.rows.length;
  }
  if (ajoutes > 0) {
    await journaliser(db, {
      cabinetId,
      utilisateurId: par,
      action: "qualite.elements.ajouter",
      entite: "qualite_suivi",
      entiteId: suivi.id,
      details: { ajoutes, ignores: elements.length - ajoutes },
    });
  }
  return { suivi_id: suivi.id, ajoutes, ignores: elements.length - ajoutes };
}

export interface ElementRevue {
  id: string;
  cle: string;
  kind: string;
  libelle: string;
  ordre: number;
  obligatoire: boolean;
  source: string | null;
  reference: string | null;
  /** L'utilisateur courant l'a parcouru. */
  vu_par_moi: boolean;
  vu_le: Date | null;
  /** Nombre de relecteurs l'ayant parcouru. */
  nb_vus: number;
}

/** Ordre du parcours : assertions fragiles, puis chiffres, puis recommandations. */
const ORDRE_KIND = `CASE e.kind WHEN 'assertion_fragile' THEN 0 WHEN 'chiffre' THEN 1 ELSE 2 END`;

export async function listerElements(
  db: Db,
  suiviId: string,
  utilisateurId: string,
): Promise<ElementRevue[]> {
  const r = await db.query(
    `SELECT e.id, e.cle, e.kind, e.libelle, e.ordre, e.obligatoire, e.source, e.reference,
       (SELECT v.vu_le FROM qualite_revue_vus v WHERE v.element_id = e.id AND v.utilisateur_id = $2) AS vu_le,
       (SELECT count(*)::int FROM qualite_revue_vus v WHERE v.element_id = e.id) AS nb_vus
     FROM qualite_revue_elements e WHERE e.suivi_id = $1
     ORDER BY ${ORDRE_KIND}, e.ordre, e.cree_le, e.id`,
    [suiviId, utilisateurId],
  );
  return r.rows.map((l) => ({ ...l, vu_par_moi: l.vu_le !== null })) as ElementRevue[];
}

export interface Parcours {
  obligatoires: number;
  vus: number;
  restants: number;
  complet: boolean;
}

/** Progression du relecteur : éléments obligatoires parcourus par LUI. */
export async function parcoursDe(
  db: Db,
  suiviId: string,
  utilisateurId: string,
): Promise<Parcours> {
  const r = await db.query(
    `SELECT count(*)::int AS obligatoires,
       count(v.id)::int AS vus
     FROM qualite_revue_elements e
     LEFT JOIN qualite_revue_vus v ON v.element_id = e.id AND v.utilisateur_id = $2
     WHERE e.suivi_id = $1 AND e.obligatoire`,
    [suiviId, utilisateurId],
  );
  const { obligatoires, vus } = r.rows[0] as { obligatoires: number; vus: number };
  return { obligatoires, vus, restants: obligatoires - vus, complet: vus >= obligatoires };
}

/** Marque un élément « vu » par le relecteur (idempotent). Le suivi doit être en revue. */
export async function marquerVu(
  db: Db,
  auth: Auth,
  suivi: Suivi,
  elementId: string,
): Promise<Parcours> {
  if (suivi.statut !== "en_revue" && suivi.statut !== "valide") {
    throw conflit("Le parcours de revue n'est ouvert que pendant la revue du livrable.");
  }
  const e = await db.query(
    "SELECT id FROM qualite_revue_elements WHERE id = $1 AND suivi_id = $2",
    [elementId, suivi.id],
  );
  if (!e.rows[0]) throw introuvable("Élément de revue");
  const r = await db.query(
    `INSERT INTO qualite_revue_vus (cabinet_id, suivi_id, element_id, utilisateur_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT (element_id, utilisateur_id) DO NOTHING RETURNING id`,
    [auth.cabinetId, suivi.id, elementId, auth.utilisateurId],
  );
  if (r.rows[0]) {
    await journaliser(db, {
      cabinetId: auth.cabinetId,
      utilisateurId: auth.utilisateurId,
      action: "qualite.element.vu",
      entite: "qualite_suivi",
      entiteId: suivi.id,
      details: { element_id: elementId },
    });
  }
  return parcoursDe(db, suivi.id, auth.utilisateurId);
}

export interface SessionRevue {
  id: string;
  utilisateur_id: string;
  debut: Date;
  fin: Date | null;
  duree_secondes: number | null;
}

/** Ouvre une session de revue (ou renvoie celle déjà ouverte par le relecteur). */
export async function demarrerSession(
  db: Db,
  auth: Auth,
  suivi: Suivi,
): Promise<{ session: SessionRevue; creee: boolean }> {
  if (suivi.statut !== "en_revue" && suivi.statut !== "valide") {
    throw conflit("Une session de revue ne s'ouvre que pendant la revue du livrable.");
  }
  const ouverte = await db.query(
    `SELECT id, utilisateur_id, debut, fin, duree_secondes FROM qualite_revue_sessions
     WHERE suivi_id = $1 AND utilisateur_id = $2 AND fin IS NULL`,
    [suivi.id, auth.utilisateurId],
  );
  if (ouverte.rows[0]) return { session: ouverte.rows[0] as SessionRevue, creee: false };
  const r = await db.query(
    `INSERT INTO qualite_revue_sessions (cabinet_id, suivi_id, utilisateur_id)
     VALUES ($1, $2, $3) RETURNING id, utilisateur_id, debut, fin, duree_secondes`,
    [auth.cabinetId, suivi.id, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "qualite.session.demarrer",
    entite: "qualite_suivi",
    entiteId: suivi.id,
  });
  return { session: r.rows[0] as SessionRevue, creee: true };
}

/** Clôt SA session de revue ; 404 si elle n'existe pas ou n'est pas la sienne. */
export async function terminerSession(
  db: Db,
  auth: Auth,
  sessionId: string,
): Promise<{ suivi_id: string; session: SessionRevue }> {
  const s = await db.query(
    `SELECT s.suivi_id, s.fin FROM qualite_revue_sessions s
     WHERE s.id = $1 AND s.utilisateur_id = $2 FOR UPDATE OF s`,
    [sessionId, auth.utilisateurId],
  );
  if (!s.rows[0]) throw introuvable("Session de revue");
  if (s.rows[0].fin) throw conflit("Cette session de revue est déjà terminée.");
  const r = await db.query(
    `UPDATE qualite_revue_sessions
     SET fin = now(),
         duree_secondes = LEAST(floor(extract(epoch FROM (now() - debut)))::integer, $2)
     WHERE id = $1 RETURNING id, utilisateur_id, debut, fin, duree_secondes`,
    [sessionId, DUREE_SESSION_MAX_SECONDES],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "qualite.session.terminer",
    entite: "qualite_suivi",
    entiteId: s.rows[0].suivi_id as string,
    details: { duree_secondes: r.rows[0].duree_secondes },
  });
  return { suivi_id: s.rows[0].suivi_id as string, session: r.rows[0] as SessionRevue };
}

export interface TempsRevueSuivi {
  sessions: SessionRevue[];
  synthese: TempsRevue;
}

/** Sessions du suivi et temps agrégé par le moteur (sessions closes seulement). */
export async function tempsDeRevue(db: Db, suiviId: string): Promise<TempsRevueSuivi> {
  const r = await db.query(
    `SELECT id, utilisateur_id, debut, fin, duree_secondes FROM qualite_revue_sessions
     WHERE suivi_id = $1 ORDER BY debut, id`,
    [suiviId],
  );
  const sessions = r.rows as SessionRevue[];
  const durees = sessions.flatMap((s) => (s.duree_secondes === null ? [] : [s.duree_secondes]));
  return { sessions, synthese: agregerTempsRevue(durees) };
}
