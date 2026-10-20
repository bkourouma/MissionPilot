import type { FastifyPluginAsync } from "fastify";
import {
  ddPortailListeQuerySchema,
  ddPortailParamSchema,
  ddPortailPieceParamSchema,
} from "@missionpilot/shared";
import { traduireErreurDueDiligence } from "../due-diligence/erreurs.js";
import { curseurNumero } from "../due-diligence/journal.js";
import {
  exigerPieceVisible,
  fichierDePiece,
  publicationsVisibles,
  publicationVisible,
} from "../due-diligence/portail-investisseur.js";
import { paginer } from "../http/outils.js";
import {
  avecPortail,
  exigerPortail,
  introuvablePortail,
  journaliserPortail,
} from "../portail/acces.js";
import { horsContextePortail } from "../portail/contexte.js";
import { FichierAbsent, stockageDe } from "../stockage/index.js";
import { contentDisposition } from "../stockage/nom.js";

/*
 * Portail investisseur de la due diligence, routes du PORTAIL (migration 0509), montées sous /api
 * et listées UNE PAR UNE dans `LISTE_BLANCHE_PORTAIL` (motif exact, GET et HEAD). Lecture seule :
 * aucune route d'écriture.
 *
 * - Permission `portail.dd.lire` (investisseur seul) et rattachement actif (`exigerPortail`) :
 *   401 sans session, 403 pour un rôle du portail sans ce droit ou un rôle du cabinet (aucune
 *   ressource n'est révélée par ce refus, qui dépend du seul rôle).
 * - Lectures dans `avecPortail` (politiques RESTRICTIVES de 0509) AVEC le filtre explicite de
 *   `due-diligence/portail-investisseur.ts` : publication inexistante, d'un autre client ou cabinet,
 *   compte non invité sur le dossier, option du cabinet désactivée, publication retirée, pièce
 *   d'une autre publication : le MÊME 404. La liste est simplement vide.
 * - Téléchargement : contrôle d'abord dans `avecPortail`, puis lecture INTERNE par
 *   `horsContextePortail` (rapports et fichiers sont fermés au portail) qui revérifie tout
 *   explicitement (sortie inventoriée par test/portail-contexte.test.ts) ; en-têtes : pièce jointe,
 *   nosniff, bac à sable, aucune mise en cache.
 * - Chaque accès est journalisé dans la même transaction (`journaliserPortail`) : identifiants et
 *   comptes seulement.
 */

const PERMISSION = "portail.dd.lire" as const;

export const routesDueDiligencePortailInvestisseur: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    throw traduireErreurDueDiligence(error);
  });

  app.get("/portail/due-diligence/publications", async (request) => {
    const acces = exigerPortail(request, PERMISSION);
    const q = ddPortailListeQuerySchema.parse(request.query);
    const apres = curseurNumero(q.curseur);
    return avecPortail(app, acces, async (db) => {
      const page = paginer(await publicationsVisibles(db, acces, apres, q.limite), q.limite);
      await journaliserPortail(db, acces, "portail_lecture", "dd_portail_publications", null, {
        nombre: page.elements.length,
      });
      return page;
    });
  });

  app.get("/portail/due-diligence/publications/:id", async (request) => {
    const acces = exigerPortail(request, PERMISSION);
    const { id } = ddPortailParamSchema.parse(request.params);
    return avecPortail(app, acces, async (db) => {
      const detail = await publicationVisible(db, acces, id);
      await journaliserPortail(db, acces, "portail_lecture", "dd_portail_publication", id);
      return detail;
    });
  });

  app.get(
    "/portail/due-diligence/publications/:id/pieces/:pieceId/fichier",
    async (request, reply) => {
      const acces = exigerPortail(request, PERMISSION);
      const { id, pieceId } = ddPortailPieceParamSchema.parse(request.params);
      await avecPortail(app, acces, (db) => exigerPieceVisible(db, acces, id, pieceId));
      const f = await horsContextePortail(() =>
        app.db.withTenant(acces.auth.cabinetId, async (db) => {
          const lu = await fichierDePiece(db, acces, id, pieceId);
          await journaliserPortail(db, acces, "telechargement", "dd_portail_piece", pieceId, {
            publication_id: id,
          });
          return lu;
        }),
      );
      let flux;
      try {
        flux = await stockageDe(app.config).lire(acces.auth.cabinetId, f.cle_stockage);
      } catch (error) {
        if (error instanceof FichierAbsent) throw introuvablePortail();
        throw error;
      }
      return reply
        .header("Content-Type", f.type_mime)
        .header("Content-Length", String(f.taille))
        .header("Content-Disposition", contentDisposition(f.nom, "attachment"))
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "sandbox; default-src 'none'")
        .header("Cache-Control", "private, no-store")
        .header("Referrer-Policy", "no-referrer")
        .send(flux);
    },
  );
};
