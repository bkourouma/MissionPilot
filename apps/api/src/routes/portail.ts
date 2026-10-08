import type { FastifyPluginAsync } from "fastify";
import {
  aPermission,
  portailListeQuerySchema,
  portailTelechargementQuerySchema,
  portailValidationJalonSchema,
  TYPES_FICHIER_EN_LIGNE,
  type TypeFichier,
} from "@missionpilot/shared";
import { conflit, AppError } from "../errors.js";
import { lireFacture, lireLignes, type LigneVue } from "../facturation/factures.js";
import { rendreDocument } from "../facturation/document.js";
import {
  imputationsParFacture,
  situationPaiement,
  versFacturePaiement,
} from "../finance/paiements.js";
import { decoderCurseur, paginer, paramsId } from "../http/outils.js";
import { aujourdhui, nombre } from "../missions/outils.js";
import { notifier } from "../notifications/notifier.js";
import {
  avecPortail,
  COLONNES_FACTURE_PORTAIL,
  DEPUIS_FACTURE_PORTAIL,
  exigerMissionPartagee,
  exigerPortail,
  fichierLivrablePartage,
  FILTRE_FACTURE_PORTAIL,
  introuvablePortail,
  jalonsPartages,
  journaliserPortail,
  livrablesPartages,
  missionsPartagees,
  vueMission,
} from "../portail/acces.js";
import { FichierAbsent, stockageDe } from "../stockage/index.js";
import { contentDisposition } from "../stockage/nom.js";
import { routesPortailGestion } from "./portail-gestion.js";
import { z } from "zod";
import type { Db } from "../db/pool.js";
import type { AccesPortail } from "../portail/acces.js";

/*
 * Portail client (SOC-09), monté sous /api/portail.
 *
 * Côté CLIENT (ce fichier) : permissions portail.*, lecture de SON
 * entreprise limitée aux partages explicites (portail/acces.ts), tout accès
 * journalisé, 404 identique pour inexistant / d'autrui / non partagé.
 * Côté CABINET (portail-gestion.ts) : invitations, partages, utilisateurs du
 * portail, politique 2FA du portail (portail.gerer, cabinet.gerer).
 */

/** SQLSTATE des déclencheurs du portail (migrations 0110, 0111). */
const ERREURS_SQL: Record<string, [number, string, string]> = {
  MPP01: [409, "PORTAIL_RATTACHEMENT", "Rôles ou rattachement du portail incompatibles."],
  MPP02: [400, "PORTAIL_PARTAGE_INVALIDE", "Élément non partageable avec ce client."],
  MPP03: [409, "JALON_DEJA_VALIDE", "Ce jalon a déjà été validé."],
};

const paramsJalon = z.object({ id: z.string().uuid(), jalonId: z.string().uuid() }).strict();

/** Facture servie au client : montants totaux et statut de paiement dérivé, jamais de ligne. */
async function facturesVues(db: Db, lignes: Record<string, unknown>[]) {
  const ids = lignes.map((l) => l.id as string);
  const imputations = await imputationsParFacture(db, ids);
  const date = aujourdhui();
  return lignes.map((l) => {
    const facture = versFacturePaiement(l);
    const avoir = l.nature === "avoir";
    const situation = avoir
      ? null
      : situationPaiement(facture, imputations.get(facture.id) ?? [], date);
    return {
      id: l.id,
      nature: l.nature,
      numero: l.numero,
      facture_origine_id: l.facture_origine_id ?? null,
      date_emission: l.date_emission,
      date_echeance: avoir ? null : l.date_echeance,
      devise: l.devise,
      statut: l.statut,
      objet: l.objet ?? null,
      mission: { id: l.mission_id, intitule: l.mission_intitule },
      total_ht: nombre(l.total_ht),
      total_tva: nombre(l.total_tva),
      total_ttc: nombre(l.total_ttc),
      total_retenues: nombre(l.total_retenues),
      net_a_payer: nombre(l.net_a_payer),
      paiement: situation
        ? {
            statut_paiement: situation.statut_paiement,
            encaisse: situation.encaisse.valeur,
            solde: situation.solde.valeur,
            jours_retard: situation.jours_retard,
          }
        : null,
    };
  });
}

async function exigerFacturePortail(db: Db, acces: AccesPortail, id: string) {
  const r = await db.query(
    `SELECT ${COLONNES_FACTURE_PORTAIL} FROM ${DEPUIS_FACTURE_PORTAIL}
     WHERE ${FILTRE_FACTURE_PORTAIL} AND f.id = $2`,
    [acces.clientId, id],
  );
  if (!r.rows[0]) throw introuvablePortail();
  return r.rows[0] as Record<string, unknown>;
}

/**
 * Lignes du document servi au client : TOUS les montants unitaires et de
 * ligne sont masqués (« — »), seuls les totaux de la facture sont servis.
 * Plus strict que le masquage interne (régie seule) : une ligne de régie
 * livrerait le taux journalier, et le portail ne dépend pas de l'échéancier
 * interne (invisible dans une transaction du portail).
 */
const lignesMasquees = (lignes: Awaited<ReturnType<typeof lireLignes>>): LigneVue[] =>
  lignes.map((l) => ({
    ...l,
    prix_unitaire: null,
    montant_brut: null,
    remise_ligne: null,
    part_remise_globale: null,
    montant_ht: null,
  }));

export const routesPortail: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    const sql = ERREURS_SQL[(error as { code?: string }).code ?? ""];
    if (sql) throw new AppError(sql[0], sql[1], sql[2]);
    throw error;
  });

  await app.register(routesPortailGestion);

  /** Profil, entreprise, contact principal et résumé des partages. */
  app.get("/moi", async (request) => {
    const acces = exigerPortail(request, "portail.acceder");
    return avecPortail(app, acces, async (db) => {
      const r = await db.query(
        `SELECT c.id, c.raison_sociale, cab.nom AS cabinet_nom,
           u.nom AS contact_nom, u.email AS contact_email,
           (SELECT count(*)::int FROM portail_partages p
             WHERE p.client_id = c.id AND p.document_id IS NULL) AS missions,
           (SELECT count(*)::int FROM portail_partages p
             WHERE p.client_id = c.id AND p.document_id IS NOT NULL) AS documents,
           EXISTS (SELECT 1 FROM portail_partages p WHERE p.client_id = c.id AND p.factures) AS factures
         FROM clients c
         JOIN cabinets cab ON cab.id = c.cabinet_id
         LEFT JOIN portail_clients pc ON pc.client_id = c.id
         LEFT JOIN utilisateurs u ON u.id = pc.contact_principal_id AND u.actif
         WHERE c.id = $1`,
        [acces.clientId],
      );
      const l = r.rows[0];
      if (!l) throw introuvablePortail();
      await journaliserPortail(
        db,
        acces,
        "portail_lecture",
        "portail_profil",
        acces.auth.utilisateurId,
      );
      // Résumé des partages limité aux droits du rôle : l'investisseur, qui ne
      // lit ni missions ni factures, n'en apprend même pas le nombre.
      const roles = acces.auth.roles;
      const partages = {
        ...(aPermission(roles, "portail.missions.lire")
          ? { missions: l.missions as number, documents: l.documents as number }
          : {}),
        ...(aPermission(roles, "portail.factures.lire") ? { factures: l.factures as boolean } : {}),
      };
      return {
        utilisateur: {
          id: acces.auth.utilisateurId,
          nom: acces.auth.nom,
          email: acces.auth.email,
          roles: acces.auth.roles,
        },
        entreprise: { id: l.id, raison_sociale: l.raison_sociale },
        cabinet: { nom: l.cabinet_nom },
        contact_principal: l.contact_nom ? { nom: l.contact_nom, email: l.contact_email } : null,
        partages,
      };
    });
  });

  app.get("/missions", async (request) => {
    const acces = exigerPortail(request, "portail.missions.lire");
    const q = portailListeQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return avecPortail(app, acces, async (db) => {
      const lignes = await missionsPartagees(db, acces, apres, q.limite);
      const page = paginer(lignes, q.limite);
      await journaliserPortail(db, acces, "portail_lecture", "missions", null, {
        nombre: page.elements.length,
      });
      return {
        elements: page.elements.map((m) => vueMission(m as Parameters<typeof vueMission>[0])),
        curseur_suivant: page.curseur_suivant,
      };
    });
  });

  app.get("/missions/:id", async (request) => {
    const acces = exigerPortail(request, "portail.missions.lire");
    const { id } = paramsId.parse(request.params);
    return avecPortail(app, acces, async (db) => {
      const mission = await exigerMissionPartagee(db, acces, id);
      await journaliserPortail(db, acces, "portail_lecture", "mission", id);
      return vueMission(mission);
    });
  });

  app.get("/missions/:id/jalons", async (request) => {
    const acces = exigerPortail(request, "portail.missions.lire");
    const { id } = paramsId.parse(request.params);
    return avecPortail(app, acces, async (db) => {
      const mission = await exigerMissionPartagee(db, acces, id);
      const elements = await jalonsPartages(db, acces, mission);
      await journaliserPortail(db, acces, "portail_lecture", "mission_jalons", id, {
        nombre: elements.length,
      });
      return { elements };
    });
  });

  /**
   * Validation d'un jalon par le dirigeant client : jalon d'une mission
   * partagée avec ses jalons, déjà ATTEINT ; horodatée, définitive (ajout
   * seul), sans modifier le jalon interne ; notifie le chef et le directeur
   * de mission (notification in-app, sans montant).
   */
  app.post("/missions/:id/jalons/:jalonId/valider", async (request, reply) => {
    const acces = exigerPortail(request, "portail.jalons.valider");
    const { id, jalonId } = paramsJalon.parse(request.params);
    const { commentaire } = portailValidationJalonSchema.parse(request.body ?? {});
    const resultat = await avecPortail(app, acces, async (db) => {
      const mission = await exigerMissionPartagee(db, acces, id);
      if (!mission.jalons) throw introuvablePortail();
      // Sans verrou de ligne : mission_jalons est en LECTURE SEULE dans le
      // contexte du portail (0113), or un FOR SHARE relève des politiques
      // UPDATE. Unicité de la validation : contrainte (cabinet_id, jalon_id).
      const j = await db.query(
        `SELECT id, libelle, date_prevue::text AS date_prevue, atteint FROM mission_jalons
         WHERE id = $1 AND mission_id = $2`,
        [jalonId, id],
      );
      const jalon = j.rows[0] as
        { id: string; libelle: string; date_prevue: string | null; atteint: boolean } | undefined;
      if (!jalon) throw introuvablePortail();
      if (!jalon.atteint) throw conflit("Ce jalon n'est pas encore atteint : il ne se valide pas.");
      const ins = await db.query(
        `INSERT INTO portail_validations_jalons
           (cabinet_id, client_id, mission_id, jalon_id, jalon_libelle, jalon_date_prevue,
            valide_par, commentaire)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (cabinet_id, jalon_id) DO NOTHING
         RETURNING id, valide_le`,
        [
          acces.auth.cabinetId,
          acces.clientId,
          id,
          jalonId,
          jalon.libelle,
          jalon.date_prevue,
          acces.auth.utilisateurId,
          commentaire ?? null,
        ],
      );
      if (!ins.rows[0]) throw new AppError(409, "JALON_DEJA_VALIDE", "Ce jalon a déjà été validé.");
      await journaliserPortail(db, acces, "portail_validation", "mission_jalon", jalonId, {
        mission_id: id,
        validation_id: ins.rows[0].id,
      });
      const destinataires = new Set(
        [mission.chef_id, mission.directeur_id].filter((x): x is string => Boolean(x)),
      );
      for (const destinataireId of destinataires) {
        await notifier(db, {
          cabinetId: acces.auth.cabinetId,
          destinataireId,
          type: "portail_jalon_valide",
          titre: `Jalon validé par le client : ${jalon.libelle}`,
          corps: `Mission « ${mission.intitule} » : le jalon « ${jalon.libelle} » a été validé par ${acces.auth.nom} depuis le portail client.`,
          lien: `/missions/${id}`,
        });
      }
      return {
        jalon_id: jalonId,
        validation: {
          valide_le: ins.rows[0].valide_le as Date,
          commentaire: commentaire ?? null,
          valide_par_moi: true,
        },
      };
    });
    reply.status(201);
    return resultat;
  });

  app.get("/missions/:id/livrables", async (request) => {
    const acces = exigerPortail(request, "portail.missions.lire");
    const { id } = paramsId.parse(request.params);
    return avecPortail(app, acces, async (db) => {
      const mission = await exigerMissionPartagee(db, acces, id);
      const elements = await livrablesPartages(db, acces, mission);
      await journaliserPortail(db, acces, "portail_lecture", "mission_livrables", id, {
        nombre: elements.length,
      });
      return { elements };
    });
  });

  /**
   * Téléchargement d'un livrable PARTAGÉ (identifiant du document, jamais
   * celui du fichier) : partage revérifié à chaque appel, mêmes en-têtes que
   * /api/fichiers/:id (type détecté, nosniff, sandbox, no-store).
   */
  app.get("/livrables/:id/fichier", async (request, reply) => {
    const acces = exigerPortail(request, "portail.missions.lire");
    const { id } = paramsId.parse(request.params);
    const q = portailTelechargementQuerySchema.parse(request.query);
    const f = await avecPortail(app, acces, async (db) => {
      const lu = await fichierLivrablePartage(db, acces, id);
      await journaliserPortail(db, acces, "telechargement", "mission_document", id, {
        mission_id: lu.mission_id,
        fichier_id: lu.fichier_id,
        type_mime: lu.type_mime,
      });
      return lu;
    });
    let flux;
    try {
      flux = await stockageDe(app.config).lire(acces.auth.cabinetId, f.cle_stockage);
    } catch (error) {
      if (error instanceof FichierAbsent) throw introuvablePortail();
      throw error;
    }
    const enLigne =
      q.affichage === "inline" && TYPES_FICHIER_EN_LIGNE.includes(f.type_mime as TypeFichier);
    const texte = f.type_mime === "text/plain" || f.type_mime === "text/csv";
    return reply
      .header("Content-Type", texte ? `${f.type_mime}; charset=utf-8` : f.type_mime)
      .header("Content-Length", String(f.taille))
      .header("Content-Disposition", contentDisposition(f.nom, enLigne ? "inline" : "attachment"))
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "sandbox; default-src 'none'")
      .header("Cache-Control", "private, no-store")
      .header("Cross-Origin-Resource-Policy", "same-site")
      .header("Referrer-Policy", "no-referrer")
      .send(flux);
  });

  app.get("/factures", async (request) => {
    const acces = exigerPortail(request, "portail.factures.lire");
    const q = portailListeQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return avecPortail(app, acces, async (db) => {
      // Tri : plus récentes d'abord (clé croissante sur un horodatage inversé).
      const cle = `lpad((9000000000000000 - (extract(epoch FROM f.emise_le) * 1000000)::bigint)::text, 16, '0')`;
      const r = await db.query(
        `SELECT ${COLONNES_FACTURE_PORTAIL}, ${cle} AS cle_tri FROM ${DEPUIS_FACTURE_PORTAIL}
         WHERE ${FILTRE_FACTURE_PORTAIL}
           AND ($2::text IS NULL OR (${cle}, f.id) > ($2, $3::uuid))
         ORDER BY cle_tri, f.id LIMIT $4`,
        [acces.clientId, apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
      );
      const page = paginer(r.rows as { cle_tri: string; id: string }[], q.limite);
      const elements = await facturesVues(db, page.elements as Record<string, unknown>[]);
      await journaliserPortail(db, acces, "portail_lecture", "factures", null, {
        nombre: elements.length,
      });
      return { elements, curseur_suivant: page.curseur_suivant };
    });
  });

  app.get("/factures/:id", async (request) => {
    const acces = exigerPortail(request, "portail.factures.lire");
    const { id } = paramsId.parse(request.params);
    return avecPortail(app, acces, async (db) => {
      const ligne = await exigerFacturePortail(db, acces, id);
      await journaliserPortail(db, acces, "portail_lecture", "facture", id);
      return (await facturesVues(db, [ligne]))[0];
    });
  });

  /** Document imprimable de la facture émise : HTML sûr existant, montants de ligne masqués. */
  app.get("/factures/:id/document", async (request, reply) => {
    const acces = exigerPortail(request, "portail.factures.lire");
    const { id } = paramsId.parse(request.params);
    const html = await avecPortail(app, acces, async (db) => {
      await exigerFacturePortail(db, acces, id);
      const facture = await lireFacture(db, id);
      if (!facture.mentions) throw introuvablePortail();
      await journaliserPortail(db, acces, "portail_lecture", "facture_document", id);
      return rendreDocument({
        facture,
        lignes: lignesMasquees(await lireLignes(db, id)),
        mentions: facture.mentions,
      });
    });
    return reply
      .header("content-type", "text/html; charset=utf-8")
      .header(
        "content-security-policy",
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      )
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "private, no-store")
      .send(html);
  });
};
