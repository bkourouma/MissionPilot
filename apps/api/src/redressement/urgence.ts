import { evaluerUrgence, VERSION_GRILLE_URGENCE, type ReponseUrgence } from "@missionpilot/engines";
import type {
  RedResultatUrgenceVue,
  RedUrgenceCreation,
  RedUrgenceVue,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { paginer } from "../http/outils.js";
import { passerEnDiagnostic, type DossierRed } from "./acces.js";
import { journalRed } from "./journal.js";
import { DEBIT_URGENCES, verifierDebit } from "./limites.js";
import { cleTriCreation, decoderCurseurCreation, type PageRed } from "./pagination.js";
import { iso, isoOuVide, personne, vueResultatUrgence } from "./vues.js";

/*
 * Questionnaire d'urgence (RED-01) : grille fermée du moteur (15 questions, 5 domaines), renseignée
 * par le consultant, voyants vert / orange / rouge par domaine. L'évaluation est calculée par le
 * moteur, conservée avec ses réponses et la version de la grille (ajout seul) : elle se rejoue.
 * Pas de réutilisation du module `questionnaires` (réservé au portail).
 */

const COLONNES = `u.id, u.grille_version, u.reponses, u.resultat, u.voyant, u.duree_secondes, u.commentaire,
  u.saisi_par, p.nom AS saisi_par_nom, u.cree_le`;

function vue(l: Record<string, unknown>): RedUrgenceVue {
  return {
    id: l.id as string,
    grille_version: l.grille_version as number,
    reponses: l.reponses as RedUrgenceVue["reponses"],
    resultat: l.resultat as RedResultatUrgenceVue,
    voyant: l.voyant as RedUrgenceVue["voyant"],
    duree_secondes: (l.duree_secondes as number | null) ?? null,
    commentaire: (l.commentaire as string | null) ?? null,
    saisi_par: personne(l.saisi_par as string, l.saisi_par_nom as string),
    cree_le: isoOuVide(l.cree_le as Date),
  };
}

/** Route 11 : historique des évaluations, les plus récentes d'abord. */
export async function listerUrgences(
  db: Db,
  dossier: DossierRed,
  q: { limite: number; curseur?: string | undefined },
): Promise<PageRed<RedUrgenceVue>> {
  const apres = decoderCurseurCreation(q.curseur);
  const r = await db.query(
    `SELECT ${COLONNES}, ${cleTriCreation("u")} AS cle_tri
     FROM red_urgences u JOIN utilisateurs p ON p.id = u.saisi_par
     WHERE u.dossier_id = $1 AND ($2::timestamptz IS NULL OR (u.cree_le, u.id) < ($2::timestamptz, $3::uuid))
     ORDER BY u.cree_le DESC, u.id DESC LIMIT $4`,
    [dossier.id, apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
  );
  const page = paginer(
    r.rows as (Record<string, unknown> & { cle_tri: string; id: string })[],
    q.limite,
  );
  return { elements: page.elements.map(vue), suivant: page.curseur_suivant };
}

/** Dernière évaluation (résumé du dossier) : identifiant, voyant, date et voyants par domaine. */
export async function derniereUrgence(db: Db, dossierId: string) {
  const r = await db.query(
    `SELECT u.id, u.voyant, u.resultat, u.cree_le FROM red_urgences u
     WHERE u.dossier_id = $1 ORDER BY u.cree_le DESC, u.id DESC LIMIT 1`,
    [dossierId],
  );
  return (
    (r.rows[0] as
      { id: string; voyant: string; resultat: RedResultatUrgenceVue; cree_le: Date } | undefined) ??
    null
  );
}

/** Route 12 : évaluation par le moteur (dossier verrouillé par l'appelant), plafond de débit, journal. */
export async function creerUrgence(
  db: Db,
  auth: Auth,
  dossier: DossierRed,
  corps: RedUrgenceCreation,
): Promise<RedUrgenceVue> {
  await verifierDebit(db, auth, DEBIT_URGENCES);
  // Le moteur refuse un code inconnu ou une réponse hors liste (400) ; jamais zéro par défaut.
  const resultat = vueResultatUrgence(
    evaluerUrgence(corps.reponses as Record<string, ReponseUrgence>),
  );
  const r = await db.query(
    `INSERT INTO red_urgences (cabinet_id, dossier_id, grille_version, reponses, resultat, voyant,
       duree_secondes, commentaire, saisi_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, cree_le`,
    [
      auth.cabinetId,
      dossier.id,
      VERSION_GRILLE_URGENCE,
      JSON.stringify(corps.reponses),
      JSON.stringify(resultat),
      resultat.voyant,
      corps.duree_secondes ?? null,
      corps.commentaire ?? null,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await passerEnDiagnostic(db, auth, dossier);
  await journalRed(db, auth, "red_urgence", "urgence", id, {
    dossier_id: dossier.id,
    voyant: resultat.voyant,
    grille_version: VERSION_GRILLE_URGENCE,
  });
  return {
    id,
    grille_version: VERSION_GRILLE_URGENCE,
    reponses: corps.reponses,
    resultat,
    voyant: resultat.voyant,
    duree_secondes: corps.duree_secondes ?? null,
    commentaire: corps.commentaire ?? null,
    saisi_par: personne(auth.utilisateurId, auth.nom),
    cree_le: iso(r.rows[0].cree_le as Date) ?? "",
  };
}
