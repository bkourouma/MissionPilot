import type { z } from "zod";
import {
  aPermission,
  type redListeDossiersQuerySchema,
  RED_DOMAINES,
  type Devise,
  type RedDossierCreation,
  type RedDossierModification,
  type RedDossierResume,
  type RedDossierVue,
  type RedVoyant,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import { clauseSet } from "../db/outils.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { motifContient, paginer } from "../http/outils.js";
import { filtreVisibilite, voitToutesLesMissions } from "../missions/acces.js";
import {
  exigerDossierRedVisible,
  exigerOuverturePossible,
  peutEcrireDansDossier,
  type AccesDossierRed,
} from "./acces.js";
import { dernierScore } from "./alerte.js";
import { resumePassif } from "./creanciers.js";
import { journalRed } from "./journal.js";
import { cleTriCreation, decoderCurseurCreation, type PageRed } from "./pagination.js";
import { resumePlan } from "./plan.js";
import { etatsAcceptes } from "./etats.js";
import { calculerFiabilite } from "../dossier/fiabilite.js";
import { correspondanceCourante } from "./correspondances.js";
import { resumeTresorerie } from "./tresorerie.js";
import { derniereUrgence } from "./urgence.js";
import { iso, isoOuVide } from "./vues.js";

/*
 * Dossier de redressement (un par mission, lié à la mission et au client de celle-ci) : intitulé,
 * secteur, devise (copie de celle de la mission, figée) et statut (ouvert, diagnostic, plan validé,
 * mise en œuvre, clos). Les transitions sont fermées en base (MPZ06) : « plan validé » et « mise en
 * œuvre » exigent une version de plan validée ; « clos » est terminal. La vue du dossier ne montre
 * AUCUNE donnée du cabinet (honoraires, budget, coûts) : FIN-02 traduit, voir acces.ts règle 7.
 */

const RESUME_COLONNES = `d.id, d.mission_id, m.intitule AS mission_intitule, d.client_id, c.raison_sociale,
  d.intitule, d.secteur, d.devise, d.statut, d.cree_le,
  u.voyant AS dernier_voyant_urgence, s.niveau AS dernier_niveau_alerte, s.score AS dernier_score`;

const RESUME_DEPUIS = `FROM red_dossiers d JOIN missions m ON m.id = d.mission_id JOIN clients c ON c.id = d.client_id
  LEFT JOIN LATERAL (SELECT x.voyant FROM red_urgences x WHERE x.dossier_id = d.id
                     ORDER BY x.cree_le DESC, x.id DESC LIMIT 1) u ON true
  LEFT JOIN LATERAL (SELECT y.niveau, y.score FROM red_scores y WHERE y.dossier_id = d.id
                     ORDER BY y.cree_le DESC, y.id DESC LIMIT 1) s ON true`;

function resume(l: Record<string, unknown>): RedDossierResume {
  return {
    id: l.id as string,
    mission: { id: l.mission_id as string, intitule: l.mission_intitule as string },
    client: { id: l.client_id as string, raison_sociale: l.raison_sociale as string },
    intitule: l.intitule as string,
    secteur: l.secteur as RedDossierResume["secteur"],
    devise: l.devise as Devise,
    statut: l.statut as RedDossierResume["statut"],
    ouvert_le: isoOuVide(l.cree_le as Date),
    dernier_voyant_urgence: (l.dernier_voyant_urgence as RedVoyant | null) ?? null,
    dernier_niveau_alerte:
      (l.dernier_niveau_alerte as RedDossierResume["dernier_niveau_alerte"]) ?? null,
    dernier_score: (l.dernier_score as number | null) ?? null,
  };
}

/** Route 2 : dossiers des missions VISIBLES de l'appelant, les plus récents d'abord. */
export async function listerDossiers(
  db: Db,
  auth: Auth,
  q: z.infer<typeof redListeDossiersQuerySchema>,
): Promise<PageRed<RedDossierResume>> {
  const apres = decoderCurseurCreation(q.curseur);
  const r = await db.query(
    `SELECT ${RESUME_COLONNES}, ${cleTriCreation("d")} AS cle_tri ${RESUME_DEPUIS}
     WHERE ${filtreVisibilite(1, 2)}
       AND ($3::text IS NULL OR d.statut = $3) AND ($4::text IS NULL OR d.secteur = $4)
       AND ($5::uuid IS NULL OR d.client_id = $5)
       AND ($6::text IS NULL OR d.intitule ILIKE $6 OR m.intitule ILIKE $6 OR c.raison_sociale ILIKE $6)
       AND ($7::timestamptz IS NULL OR (d.cree_le, d.id) < ($7::timestamptz, $8::uuid))
     ORDER BY d.cree_le DESC, d.id DESC LIMIT $9`,
    [
      voitToutesLesMissions(auth),
      auth.utilisateurId,
      q.statut ?? null,
      q.secteur ?? null,
      q.client_id ?? null,
      motifContient(q.q),
      apres?.[0] ?? null,
      apres?.[1] ?? null,
      q.limite + 1,
    ],
  );
  const page = paginer(
    r.rows as (Record<string, unknown> & { cle_tri: string; id: string })[],
    q.limite,
  );
  return { elements: page.elements.map(resume), suivant: page.curseur_suivant };
}

/** Route 5 : vue complète du dossier (résumés calculés à la lecture par les moteurs). */
export async function vueDossier(
  db: Db,
  auth: Auth,
  acces: AccesDossierRed,
): Promise<RedDossierVue> {
  const { dossier, mission } = acces;
  const r = await db.query(`SELECT ${RESUME_COLONNES} ${RESUME_DEPUIS} WHERE d.id = $1`, [
    dossier.id,
  ]);
  const base = resume(r.rows[0] as Record<string, unknown>);
  const urgence = await derniereUrgence(db, dossier.id);
  const alerte = await dernierScore(db, dossier.id);
  const corr = await correspondanceCourante(db, dossier.id);
  const fiabilite = await calculerFiabilite(db, dossier.client_id);
  const peutEcrire = await peutEcrireDansDossier(db, auth, mission);
  const ouvert = dossier.statut !== "clos" && mission.statut !== "cloturee";
  const voyants = Object.fromEntries(RED_DOMAINES.map((d) => [d, "non_evalue"])) as Record<
    (typeof RED_DOMAINES)[number],
    RedVoyant
  >;
  if (urgence) {
    for (const d of RED_DOMAINES) {
      const x = urgence.resultat.domaines.find((y) => y.domaine === d);
      voyants[d] = x ? x.voyant : "non_evalue";
    }
  }
  return {
    ...base,
    modifie_le: isoOuVide(dossier.modifie_le),
    clos_le: iso(dossier.clos_le),
    motif_cloture: dossier.motif_cloture,
    urgence: urgence
      ? {
          id: urgence.id,
          voyant: urgence.voyant as RedVoyant,
          cree_le: isoOuVide(urgence.cree_le),
          voyants_par_domaine: voyants,
        }
      : null,
    alerte: alerte
      ? {
          id: alerte.id,
          score: alerte.score,
          niveau: alerte.niveau as NonNullable<RedDossierVue["alerte"]>["niveau"],
          cree_le: isoOuVide(alerte.cree_le),
          seuils_source: alerte.seuils_source as NonNullable<
            RedDossierVue["alerte"]
          >["seuils_source"],
          seuils_version: alerte.seuils_version,
        }
      : null,
    tresorerie: await resumeTresorerie(db, dossier.id),
    creanciers: await resumePassif(db, dossier.id),
    plan: await resumePlan(db, dossier),
    correspondance_version: corr?.version ?? null,
    etats_acceptes: (await etatsAcceptes(db, dossier.client_id)).length,
    analyses_indicatives: fiabilite.analysesIndicatives,
    droits: {
      ecrire: peutEcrire && ouvert && aPermission(auth.roles, "redressement.ecrire"),
      valider: ouvert && aPermission(auth.roles, "redressement.valider"),
    },
  };
}

/** Dossier d'une mission visible (route 4) : 404 RED_ABSENT si la mission n'en a pas. */
export async function dossierDeMission(db: Db, missionId: string): Promise<string> {
  const r = await db.query("SELECT id FROM red_dossiers WHERE mission_id = $1", [missionId]);
  if (!r.rows[0])
    throw new AppError(404, "RED_ABSENT", "Cette mission n'a pas de dossier de redressement.");
  return r.rows[0].id as string;
}

/** Route 3 : ouverture (mission modifiable, sans dossier). Devise et client sont ceux de la mission. */
export async function ouvrirDossier(
  db: Db,
  auth: Auth,
  missionId: string,
  corps: RedDossierCreation,
): Promise<RedDossierVue> {
  const mission = await exigerOuverturePossible(db, auth, missionId);
  const r = await db.query(
    `INSERT INTO red_dossiers (cabinet_id, mission_id, client_id, intitule, secteur, devise, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      auth.cabinetId,
      mission.id,
      mission.client_id,
      corps.intitule,
      corps.secteur,
      mission.devise,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await journalRed(db, auth, "red_dossier", "creation", id, {
    mission_id: mission.id,
    client_id: mission.client_id,
    secteur: corps.secteur,
  });
  return vueDossier(db, auth, await exigerDossierRedVisible(db, auth, id));
}

/** Route 6 : intitulé et secteur (le secteur ne rétroagit pas : un score garde l'instantané de ses seuils). */
export async function modifierDossier(
  db: Db,
  auth: Auth,
  acces: AccesDossierRed,
  corps: RedDossierModification,
): Promise<RedDossierVue> {
  const set = clauseSet(corps, 3);
  await db.query(`UPDATE red_dossiers SET ${set.sql}, modifie_par = $2 WHERE id = $1`, [
    acces.dossier.id,
    auth.utilisateurId,
    ...set.valeurs,
  ]);
  await journalRed(db, auth, "red_dossier", "modification", acces.dossier.id, {
    champs: Object.keys(corps).filter((k) => (corps as Record<string, unknown>)[k] !== undefined),
    // Valeurs avant et après du seul secteur (jamais l'intitulé).
    ...(corps.secteur !== undefined
      ? { secteur: { de: acces.dossier.secteur, vers: corps.secteur } }
      : {}),
  });
  return vueDossier(db, auth, await exigerDossierRedVisible(db, auth, acces.dossier.id));
}

/** Route 7 : « mise en œuvre » (plan validé requis) ou clôture (terminale, motivée). */
export async function changerStatutDossier(
  db: Db,
  auth: Auth,
  acces: AccesDossierRed,
  corps: { statut: "mise_en_oeuvre" | "clos"; motif?: string | null | undefined },
): Promise<RedDossierVue> {
  const { dossier } = acces;
  if (corps.statut === "mise_en_oeuvre") {
    if (dossier.statut !== "plan_valide") {
      throw new AppError(409, "RED_TRANSITION_INVALIDE", "La mise en œuvre exige un plan validé.");
    }
    await db.query(
      "UPDATE red_dossiers SET statut = 'mise_en_oeuvre', modifie_par = $2 WHERE id = $1",
      [dossier.id, auth.utilisateurId],
    );
  } else {
    await db.query(
      `UPDATE red_dossiers SET statut = 'clos', clos_le = now(), clos_par = $2, motif_cloture = $3,
         modifie_par = $2 WHERE id = $1`,
      [dossier.id, auth.utilisateurId, corps.motif ?? null],
    );
  }
  await journalRed(db, auth, "red_dossier", "statut", dossier.id, {
    de: dossier.statut,
    vers: corps.statut,
  });
  return vueDossier(db, auth, await exigerDossierRedVisible(db, auth, dossier.id));
}
