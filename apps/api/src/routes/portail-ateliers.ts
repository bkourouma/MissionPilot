import type { FastifyPluginAsync } from "fastify";
import {
  portailAtelierMethodeParamsSchema,
  portailAtelierParamsSchema,
  portailAteliersQuerySchema,
} from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import {
  avecPortail,
  exigerPortail,
  introuvablePortail,
  journaliserPortail,
  type AccesPortail,
} from "../portail/acces.js";
import { methodesActives, optionsDe, type AtelierDb } from "../plans/ateliers.js";
import {
  deposerContribution,
  lireCorpsContribution,
  lireMaContribution,
  verrouillerContributions,
} from "../plans/ateliers-contributions.js";
import { traduireErreurAtelier } from "../plans/ateliers-erreurs.js";
import { traduireErreurPlan } from "../plans/erreurs.js";

/*
 * Ateliers stratégiques côté portail (PLA-15, SPEC lot 5a) : le dirigeant du client INVITÉ à un atelier
 * OUVERT voit son énoncé, ses options et SA contribution, et la dépose ou la remplace tant que l'atelier
 * est ouvert. Rien d'autre : jamais d'agrégat, de contribution d'un autre, de synthèse IA, de nom d'un
 * membre du cabinet, ni d'identifiant du plan ou de la mission (projection explicite).
 *
 * Permission `portail.ateliers.participer` (rôle client_dirigeant seul ; contributeur et investisseur
 * reçoivent 403). Même 404 pour un atelier inexistant, d'un autre client ou cabinet, non invité ou non
 * ouvert. Chaque requête filtre EN PLUS explicitement sur le client, l'utilisateur et le statut (double
 * barrière avec les politiques RLS `portail` des migrations 0425 et 0426). Routes listées une à une
 * dans LISTE_BLANCHE_PORTAIL (portail/garde.ts).
 */

const DEPUIS = `plan_ateliers a
  JOIN plan_atelier_participants p ON p.atelier_id = a.id AND p.utilisateur_id = $2 AND p.partie = 'client'`;
const FILTRE = "a.client_id = $1 AND a.statut = 'ouvert'";

interface LignePortail {
  id: string;
  titre: string;
  consigne: string;
  methode_vote: boolean;
  methode_priorisation: boolean;
  methode_matrice: boolean;
  budget_points: number;
  plafond_par_option: number | null;
  axe_x_libelle: string;
  axe_x_inverse: boolean;
  axe_y_libelle: string;
  axe_y_inverse: boolean;
  ouvert_le: Date;
}

const COLONNES = `a.id, a.titre, a.consigne, a.methode_vote, a.methode_priorisation, a.methode_matrice,
  a.budget_points, a.plafond_par_option, a.axe_x_libelle, a.axe_x_inverse, a.axe_y_libelle,
  a.axe_y_inverse, a.ouvert_le`;

/** Atelier ouvert où CE dirigeant est invité, sinon 404 (même réponse dans tous les cas). */
async function monAtelier(db: Db, acces: AccesPortail, id: string): Promise<LignePortail> {
  const r = await db.query(`SELECT ${COLONNES} FROM ${DEPUIS} WHERE ${FILTRE} AND a.id = $3`, [
    acces.clientId,
    acces.auth.utilisateurId,
    id,
  ]);
  if (!r.rows[0]) throw introuvablePortail();
  return r.rows[0] as LignePortail;
}

const methodesDe = (l: LignePortail) => methodesActives(l);

export const routesPortailAteliers: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    throw traduireErreurPlan(traduireErreurAtelier(error));
  });

  app.get("/portail/ateliers", async (request) => {
    const acces = exigerPortail(request, "portail.ateliers.participer");
    const q = portailAteliersQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return avecPortail(app, acces, async (db) => {
      const r = await db.query(
        `SELECT lpad(((extract(epoch FROM a.ouvert_le) * 1000000)::bigint)::text, 17, '0') AS cle_tri,
           ${COLONNES},
           EXISTS (SELECT 1 FROM plan_atelier_contributions c
                   WHERE c.atelier_id = a.id AND c.utilisateur_id = $2) AS a_contribue
         FROM ${DEPUIS}
         WHERE ${FILTRE}
           AND ($3::text IS NULL
                OR (lpad(((extract(epoch FROM a.ouvert_le) * 1000000)::bigint)::text, 17, '0'), a.id)
                   < ($3, $4::uuid))
         ORDER BY a.ouvert_le DESC, a.id DESC LIMIT $5`,
        [
          acces.clientId,
          acces.auth.utilisateurId,
          apres?.[0] ?? null,
          apres?.[1] ?? null,
          q.limite + 1,
        ],
      );
      const page = paginer(
        r.rows as (LignePortail & { cle_tri: string; a_contribue: boolean })[],
        q.limite,
      );
      await journaliserPortail(db, acces, "portail_lecture", "plan_atelier", null, {
        nombre: page.elements.length,
      });
      return {
        elements: (page.elements as (LignePortail & { a_contribue: boolean })[]).map((l) => ({
          id: l.id,
          titre: l.titre,
          methodes: methodesDe(l),
          ouvert_le: l.ouvert_le,
          a_contribue: l.a_contribue,
        })),
        curseur_suivant: page.curseur_suivant,
      };
    });
  });

  app.get("/portail/ateliers/:id", async (request) => {
    const acces = exigerPortail(request, "portail.ateliers.participer");
    const { id } = portailAtelierParamsSchema.parse(request.params);
    return avecPortail(app, acces, async (db) => {
      const l = await monAtelier(db, acces, id);
      const [options, contribution] = await Promise.all([
        optionsDe(db, id),
        lireMaContribution(db, id, acces.auth.utilisateurId),
      ]);
      await journaliserPortail(db, acces, "portail_lecture", "plan_atelier", id);
      return {
        id: l.id,
        titre: l.titre,
        consigne: l.consigne,
        methodes: methodesDe(l),
        // « budget » est une clé écartée des réponses du portail : points à répartir au vote.
        points_a_repartir: l.budget_points,
        plafond_points_par_option: l.plafond_par_option,
        axes: {
          x: { libelle: l.axe_x_libelle, inverse: l.axe_x_inverse },
          y: { libelle: l.axe_y_libelle, inverse: l.axe_y_inverse },
        },
        ouvert_le: l.ouvert_le,
        options: options.map((o) => ({ id: o.id, libelle: o.libelle, description: o.description })),
        ma_contribution: contribution,
      };
    });
  });

  app.put("/portail/ateliers/:id/contribution/:methode", async (request) => {
    const acces = exigerPortail(request, "portail.ateliers.participer");
    const { id, methode } = portailAtelierMethodeParamsSchema.parse(request.params);
    const corps = lireCorpsContribution(methode, request.body);
    return avecPortail(app, acces, async (db) => {
      // Verrou partagé AVANT de lire le statut : la clôture attend les contributions en cours.
      await verrouillerContributions(db, id);
      const l = await monAtelier(db, acces, id);
      const atelier = { ...l, statut: "ouvert" } as unknown as AtelierDb;
      const depot = await deposerContribution(
        db,
        atelier,
        {
          cabinetId: acces.auth.cabinetId,
          utilisateurId: acces.auth.utilisateurId,
          clientId: acces.clientId,
        },
        methode,
        corps,
        introuvablePortail,
      );
      await journaliserPortail(db, acces, "portail_atelier_contribution", "plan_atelier", id, {
        methode,
        version: depot.version,
        lignes: depot.lignes,
      });
      return { methode, version: depot.version };
    });
  });
};
