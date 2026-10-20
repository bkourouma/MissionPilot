import type { FastifyPluginAsync } from "fastify";
import {
  signatureParamSchema,
  signatureRefusSchema,
  signatureSignerSchema,
  signaturesPortailQuerySchema,
} from "@missionpilot/shared";
import { serviceIdentite } from "../auth/confirmer-identite.js";
import { traduireErreurCanaux } from "../canaux/erreurs.js";
import { noterConsultation, refuserDemande, signerDemande } from "../canaux/signatures.js";
import type { Db } from "../db/pool.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import {
  avecPortail,
  exigerPortail,
  introuvablePortail,
  journaliserPortail,
  type AccesPortail,
} from "../portail/acces.js";
import { horsContextePortail } from "../portail/contexte.js";
import { FichierAbsent, stockageDe } from "../stockage/index.js";
import { dependancesSignature, empreinteSession, entetesDocumentSignature } from "./signatures.js";

/*
 * Signature électronique côté portail (CLI-05, lot 3c, SPEC-3c §10.2 n° 35 à 39, §12.3) : le dirigeant
 * du client lit SES demandes, consulte le document, signe ou refuse. Règles du portail : permission
 * `portail.signature.signer`, même 404 pour inexistant, d'autrui ou non invité, JAMAIS un nom ni un
 * e-mail d'un membre du cabinet (avancement par compteurs). La signature écrit dans des tables
 * fermées au contexte du portail (preuves, jobs) et exige la reconfirmation d'identité : elle passe par
 * `horsContextePortail` (sortie inventoriée), APRÈS un contrôle fait DANS `avecPortail` (demande
 * visible, signataire invité de CE client) ; dans la sortie, chaque requête filtre explicitement sur
 * l'utilisateur et le client. La réponse ne renvoie que l'accusé (statut, date, empreinte du document).
 */

interface LignePortail {
  id: string;
  objet: string;
  statut: string;
  expire_le: Date | null;
  signataires_total: number;
  signataires_signes: number;
  mon_statut: string;
  cle_tri: string;
}

const COLONNES = `d.id, d.objet, d.statut, d.expire_le, d.signataires_total::int AS signataires_total,
  d.signataires_signes::int AS signataires_signes, s.statut AS mon_statut,
  to_char(d.cree_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cle_tri`;

/** Demandes visibles du portail : SON client, hors brouillon, dont il est signataire (filtres explicites). */
const DEPUIS = `signatures_demandes d
  JOIN signatures_signataires s ON s.demande_id = d.id AND s.utilisateur_id = $2 AND s.partie = 'client'`;
const FILTRE = "d.client_id = $1 AND d.statut <> 'brouillon'";

function vue(l: LignePortail) {
  const ouverte = ["envoyee", "partielle"].includes(l.statut);
  return {
    id: l.id,
    objet: l.objet,
    statut: l.statut,
    expire_le: l.expire_le,
    signataires_total: l.signataires_total,
    signataires_signes: l.signataires_signes,
    mon_statut: l.mon_statut,
    peut_signer: ouverte && l.mon_statut === "invite" && (l.expire_le?.getTime() ?? 0) > Date.now(),
  };
}

async function maDemande(db: Db, acces: AccesPortail, id: string): Promise<LignePortail> {
  const r = await db.query(`SELECT ${COLONNES} FROM ${DEPUIS} WHERE ${FILTRE} AND d.id = $3`, [
    acces.clientId,
    acces.auth.utilisateurId,
    id,
  ]);
  if (!r.rows[0]) throw introuvablePortail();
  return r.rows[0] as LignePortail;
}

export const routesPortailSignatures: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    throw traduireErreurCanaux(error);
  });

  app.get("/portail/signatures", async (request) => {
    const acces = exigerPortail(request, "portail.signature.signer");
    const q = signaturesPortailQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return avecPortail(app, acces, async (db) => {
      const r = await db.query(
        `SELECT ${COLONNES} FROM ${DEPUIS}
         WHERE ${FILTRE} AND ($3::text IS NULL OR (d.cree_le, d.id) < ($3::timestamptz, $4::uuid))
         ORDER BY d.cree_le DESC, d.id DESC LIMIT $5`,
        [
          acces.clientId,
          acces.auth.utilisateurId,
          apres?.[0] ?? null,
          apres?.[1] ?? null,
          q.limite + 1,
        ],
      );
      const page = paginer(r.rows as LignePortail[], q.limite);
      await journaliserPortail(db, acces, "portail_lecture", "signatures_demandes", null, {
        nombre: page.elements.length,
      });
      return {
        elements: (page.elements as LignePortail[]).map(vue),
        curseur_suivant: page.curseur_suivant,
      };
    });
  });

  app.get("/portail/signatures/:id", async (request) => {
    const acces = exigerPortail(request, "portail.signature.signer");
    const { id } = signatureParamSchema.parse(request.params);
    return avecPortail(app, acces, async (db) => {
      const l = await maDemande(db, acces, id);
      await journaliserPortail(db, acces, "portail_lecture", "signature_demande", id);
      return vue(l);
    });
  });

  app.get("/portail/signatures/:id/document", async (request, reply) => {
    const acces = exigerPortail(request, "portail.signature.signer");
    const { id } = signatureParamSchema.parse(request.params);
    // Contrôle dans le contexte du portail (même 404), puis lecture interne filtrée explicitement.
    // Le PDF n'est servi que pour une demande OUVERTE ou SIGNÉE et à un signataire déjà invité : pour
    // une demande annulée, refusée ou expirée, ou un signataire dont ce n'est pas encore le tour, le
    // portail ne lit que le statut (404 sur le contenu, constat M2).
    await avecPortail(app, acces, async (db) => {
      await maDemande(db, acces, id);
    });
    const f = await horsContextePortail(() =>
      app.db.withTenant(acces.auth.cabinetId, async (db) => {
        const r = await db.query(
          `SELECT f.nom_origine AS nom, f.type_mime, f.taille, f.cle_stockage
           FROM signatures_demandes d
           JOIN signatures_signataires s ON s.demande_id = d.id AND s.utilisateur_id = $3 AND s.partie = 'client'
           JOIN fichiers f ON f.id = d.fichier_id
           WHERE d.id = $1 AND d.client_id = $2
             AND d.statut IN ('envoyee', 'partielle', 'signee') AND s.statut <> 'en_attente'`,
          [id, acces.clientId, acces.auth.utilisateurId],
        );
        if (!r.rows[0]) throw introuvablePortail();
        // Preuve « document consulté » : exigée avant de signer.
        await noterConsultation(db, {
          cabinetId: acces.auth.cabinetId,
          demandeId: id,
          utilisateurId: acces.auth.utilisateurId,
          partie: "client",
        });
        return r.rows[0] as {
          nom: string;
          type_mime: string;
          taille: string | number;
          cle_stockage: string;
        };
      }),
    );
    let flux;
    try {
      flux = await stockageDe(app.config).lire(acces.auth.cabinetId, f.cle_stockage);
    } catch (error) {
      if (error instanceof FichierAbsent) throw introuvablePortail();
      throw error;
    }
    return reply.headers(entetesDocumentSignature(f)).send(flux);
  });

  app.post("/portail/signatures/:id/signer", async (request) => {
    const acces = exigerPortail(request, "portail.signature.signer");
    const { id } = signatureParamSchema.parse(request.params);
    const corps = signatureSignerSchema.parse(request.body);
    await avecPortail(app, acces, async (db) => {
      await maDemande(db, acces, id);
    });
    const sessionEmpreinte = empreinteSession(app, request);
    const r = await horsContextePortail(() =>
      serviceIdentite(app).confirmerIdentite(
        acces.auth,
        corps,
        "signature_document",
        (db, facteur) =>
          signerDemande(db, dependancesSignature(app), {
            cabinetId: acces.auth.cabinetId,
            utilisateurId: acces.auth.utilisateurId,
            demandeId: id,
            partie: "client",
            clientId: acces.clientId,
            facteur,
            sessionEmpreinte,
            maintenant: new Date(),
          }),
      ),
    );
    return {
      statut: r.demande.statut as "partielle" | "signee",
      signe_le: r.signeLe,
      empreinte_document: r.demande.empreinte_document,
    };
  });

  app.post("/portail/signatures/:id/refuser", async (request) => {
    const acces = exigerPortail(request, "portail.signature.signer");
    const { id } = signatureParamSchema.parse(request.params);
    const corps = signatureRefusSchema.parse(request.body);
    await avecPortail(app, acces, async (db) => {
      await maDemande(db, acces, id);
    });
    await horsContextePortail(() =>
      app.db.withTenant(acces.auth.cabinetId, (db) =>
        refuserDemande(db, {
          cabinetId: acces.auth.cabinetId,
          utilisateurId: acces.auth.utilisateurId,
          demandeId: id,
          partie: "client",
          clientId: acces.clientId,
          motif: corps.motif,
          maintenant: new Date(),
        }),
      ),
    );
    return { statut: "refusee" as const };
  });
};
