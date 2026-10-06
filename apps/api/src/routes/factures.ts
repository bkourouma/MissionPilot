import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  avoirCreationSchema,
  factureCreationSchema,
  factureLigneModificationSchema,
  factureModificationSchema,
  factureRejetSchema,
  facturesListeQuerySchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger, type Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer, paramsId } from "../http/outils.js";
import {
  estAssocie,
  exigerMissionVisible,
  filtreVisibilite,
  STATUTS_SIGNES,
  voitToutesLesMissions,
} from "../missions/acces.js";
import { satisfaitRole } from "../missions/budget.js";
import { rendreDocument } from "../facturation/document.js";
import {
  calculEnregistre,
  COLONNES_FACTURE,
  creerAvoirBrouillon,
  creerBrouillon,
  DEPUIS_FACTURE,
  emettre,
  exigerFactureVisible,
  lireFacture,
  lireLignes,
  mentionsAFiger,
  recalculer,
  roleApprobationFacture,
  vueFacture,
  type FactureDb,
} from "../facturation/factures.js";
import { lireParametresFacturation } from "../facturation/parametres.js";

const paramsLigne = z.object({ id: z.string().uuid(), ligneId: z.string().uuid() });

const CLE_RECENT = `lpad((99999999999999999 - (extract(epoch FROM f.cree_le) * 1000000)::bigint)::text, 17, '0')`;

const LIBELLE_ROLE = {
  chef_mission: "le directeur de la mission ou un associé",
  directeur_mission: "le directeur de la mission ou un associé",
  associe: "un associé",
} as const;

function exigerBrouillon(f: FactureDb): void {
  if (f.statut !== "brouillon") {
    throw conflit("Seule une facture en brouillon se modifie : la faire rejeter d'abord.");
  }
}

async function detail(db: Db, id: string): Promise<Record<string, unknown>> {
  const f = await lireFacture(db, id);
  return vueFacture(f, await lireLignes(db, id));
}

function journal(
  db: Db,
  auth: Auth,
  action: string,
  f: Pick<FactureDb, "id" | "mission_id" | "nature">,
  details: Record<string, unknown> = {},
) {
  return journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action,
    entite: f.nature === "avoir" ? "avoir" : "facture",
    entiteId: f.id,
    details: { mission_id: f.mission_id, ...details },
  });
}

/**
 * Factures et avoirs (FIN-07, FIN-15). Lecture : « facture.lire » et mission
 * visible (un chef de mission voit les factures de ses missions ; aucune
 * donnée de coût ni de marge n'y figure). Création, modification, soumission,
 * émission et avoir : « facture.emettre ». Approbation : « facture.valider »,
 * selon le palier calculé par le moteur, jamais par l'auteur (sauf associé).
 */
export const routesFactures: FastifyPluginAsync = async (app) => {
  app.get("/factures", async (request) => {
    const auth = exiger(request, "facture.lire");
    const q = facturesListeQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        `SELECT ${COLONNES_FACTURE}, ${CLE_RECENT} AS cle_tri FROM ${DEPUIS_FACTURE}
         WHERE ${filtreVisibilite(1, 2)}
           AND ($3::uuid IS NULL OR f.mission_id = $3) AND ($4::uuid IS NULL OR f.client_id = $4)
           AND ($5::text IS NULL OR f.nature = $5) AND ($6::text IS NULL OR f.statut = $6)
           AND ($7::text IS NULL OR (${CLE_RECENT}, f.id) > ($7, $8::uuid))
         ORDER BY cle_tri, f.id LIMIT $9`,
        [
          voitToutesLesMissions(auth),
          auth.utilisateurId,
          q.mission_id ?? null,
          q.client_id ?? null,
          q.nature ?? null,
          q.statut ?? null,
          apres?.[0] ?? null,
          apres?.[1] ?? null,
          q.limite + 1,
        ],
      );
      const page = paginer(r.rows, q.limite);
      return {
        ...page,
        // Liste allégée : sans le snapshot des mentions (servi par le détail).
        elements: page.elements.map((f) =>
          Object.fromEntries(
            Object.entries(f as Record<string, unknown>)
              .filter(([k]) => k !== "mentions")
              .map(([k, v]) => [k, k.startsWith("total_") || k === "net_a_payer" ? Number(v) : v]),
          ),
        ),
      };
    });
  });

  /** Brouillon depuis des échéances à facturer et des débours refacturables validés. */
  app.post("/missions/:id/factures", async (request, reply) => {
    const auth = exiger(request, "facture.emettre");
    const { id } = paramsId.parse(request.params);
    const demande = factureCreationSchema.parse(request.body);
    const creee = await app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionVisible(db, auth, id, true);
      if (!STATUTS_SIGNES.includes(mission.statut)) {
        throw conflit("Une mission se facture après la signature de la lettre de mission.");
      }
      const factureId = await creerBrouillon(db, auth, mission, demande);
      await journal(
        db,
        auth,
        "creation",
        { id: factureId, mission_id: id, nature: "facture" },
        {
          echeances: demande.echeance_ids.length,
          debours: demande.debours_ids.length,
        },
      );
      return detail(db, factureId);
    });
    reply.status(201);
    return creee;
  });

  app.get("/factures/:id", async (request) => {
    const auth = exiger(request, "facture.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerFactureVisible(db, auth, id);
      return detail(db, id);
    });
  });

  /** Document imprimable (HTML sûr : texte échappé, aucun script ni ressource externe). */
  app.get("/factures/:id/document", async (request, reply) => {
    const auth = exiger(request, "facture.lire");
    const { id } = paramsId.parse(request.params);
    const html = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { facture } = await exigerFactureVisible(db, auth, id);
      const mentions = facture.mentions ?? (await mentionsAFiger(db, auth.cabinetId, facture));
      return rendreDocument({ facture, lignes: await lireLignes(db, id), mentions });
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

  /** Objet, remise globale, retenue et délai d'une facture en brouillon (recalcul moteur). */
  app.patch("/factures/:id", async (request) => {
    const auth = exiger(request, "facture.emettre");
    const { id } = paramsId.parse(request.params);
    const modif = factureModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { facture } = await exigerFactureVisible(db, auth, id, true);
      exigerBrouillon(facture);
      if (facture.nature === "avoir")
        throw conflit("Un avoir reprend sa facture : non modifiable.");
      await db.query(
        `UPDATE factures SET objet = $2, remise_globale_type = $3, remise_globale_valeur = $4,
           retenue_active = $5, delai_paiement_jours = $6, motif_rejet = NULL, modifie_le = now()
         WHERE id = $1`,
        [
          id,
          modif.objet === undefined ? facture.objet : modif.objet,
          modif.remise_globale === undefined
            ? facture.remise_globale_type
            : (modif.remise_globale?.type ?? null),
          modif.remise_globale === undefined
            ? facture.remise_globale_valeur
            : (modif.remise_globale?.valeur ?? null),
          modif.retenue_active ?? facture.retenue_active,
          modif.delai_paiement_jours ?? facture.delai_paiement_jours,
        ],
      );
      await recalculer(db, id);
      await journal(db, auth, "modification", facture, { champs: Object.keys(modif) });
      return detail(db, id);
    });
  });

  /** Libellé, taux de TVA (parmi les taux du cabinet) et remise d'une ligne. */
  app.patch("/factures/:id/lignes/:ligneId", async (request) => {
    const auth = exiger(request, "facture.emettre");
    const { id, ligneId } = paramsLigne.parse(request.params);
    const modif = factureLigneModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { facture } = await exigerFactureVisible(db, auth, id, true);
      exigerBrouillon(facture);
      if (facture.nature === "avoir")
        throw conflit("Un avoir reprend sa facture : non modifiable.");
      const ligne = (await lireLignes(db, id)).find((l) => l.id === ligneId);
      if (!ligne) throw requeteInvalide("Ligne inconnue dans cette facture.");
      if (modif.taux_tva !== undefined) {
        const p = await lireParametresFacturation(db, auth.cabinetId);
        if (!p.taux_tva_autorises.includes(modif.taux_tva)) {
          throw requeteInvalide(
            `Taux de TVA non autorisé par le cabinet (${p.taux_tva_autorises.join(", ")}).`,
          );
        }
      }
      await db.query(
        `UPDATE facture_lignes SET libelle = $3, taux_tva = $4, remise_type = $5, remise_valeur = $6
         WHERE id = $1 AND facture_id = $2`,
        [
          ligneId,
          id,
          modif.libelle ?? ligne.libelle,
          modif.taux_tva ?? ligne.taux_tva,
          modif.remise === undefined ? ligne.remise_type : (modif.remise?.type ?? null),
          modif.remise === undefined ? ligne.remise_valeur : (modif.remise?.valeur ?? null),
        ],
      );
      await recalculer(db, id);
      await journal(db, auth, "modification_ligne", facture, {
        ligne_id: ligneId,
        champs: Object.keys(modif),
      });
      return detail(db, id);
    });
  });

  /** Supprime un brouillon : ses échéances et débours redeviennent facturables. */
  app.delete("/factures/:id", async (request, reply) => {
    const auth = exiger(request, "facture.emettre");
    const { id } = paramsId.parse(request.params);
    await app.db.withTenant(auth.cabinetId, async (db) => {
      const { facture } = await exigerFactureVisible(db, auth, id, true);
      exigerBrouillon(facture);
      await db.query("DELETE FROM factures WHERE id = $1", [id]);
      await journal(db, auth, "suppression", facture);
    });
    return reply.status(204).send();
  });

  /** Soumet à approbation : le rôle exigé est calculé par les seuils du moteur (FIN-15). */
  app.post("/factures/:id/soumettre", async (request) => {
    const auth = exiger(request, "facture.emettre");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { facture, mission } = await exigerFactureVisible(db, auth, id, true);
      exigerBrouillon(facture);
      if ((await lireLignes(db, id)).length === 0) throw conflit("La facture n'a aucune ligne.");
      const requis = roleApprobationFacture(await calculEnregistre(db, facture), mission);
      await db.query(
        `UPDATE factures SET statut = 'a_approuver', role_approbateur = $2, soumise_par = $3,
           soumise_le = now(), motif_rejet = NULL, modifie_le = now() WHERE id = $1`,
        [id, requis, auth.utilisateurId],
      );
      await journal(db, auth, "soumission", facture, { role_approbateur: requis });
      return detail(db, id);
    });
  });

  /**
   * Approbation (FIN-15) : « facture.valider » ; un associé, ou le directeur
   * désigné de la mission si le palier n'exige pas un associé ; jamais
   * l'auteur ni le soumetteur, sauf associé.
   */
  app.post("/factures/:id/approuver", async (request) => {
    const auth = exiger(request, "facture.valider");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { facture, mission } = await exigerFactureVisible(db, auth, id, true);
      if (facture.statut !== "a_approuver") throw conflit("La facture n'est pas à approuver.");
      const requis = facture.role_approbateur ?? "associe";
      const associe = estAssocie(auth);
      if (!associe && mission.directeur_id !== auth.utilisateurId) {
        throw new AppError(
          403,
          "APPROBATION_REQUISE",
          `Cette facture est approuvée par ${LIBELLE_ROLE[requis]}.`,
        );
      }
      if (
        !associe &&
        (facture.cree_par === auth.utilisateurId || facture.soumise_par === auth.utilisateurId)
      ) {
        throw new AppError(
          403,
          "APPROBATION_REQUISE",
          "L'auteur d'une facture ne l'approuve pas lui-même : la faire approuver par un associé.",
        );
      }
      if (!satisfaitRole(auth.roles, requis)) {
        throw new AppError(
          403,
          "APPROBATION_REQUISE",
          `Cette facture est approuvée par ${LIBELLE_ROLE[requis]}.`,
        );
      }
      await db.query(
        `UPDATE factures SET statut = 'approuvee', approuvee_par = $2, approuvee_le = now(),
           modifie_le = now() WHERE id = $1`,
        [id, auth.utilisateurId],
      );
      await journal(db, auth, "approbation", facture, { role_approbateur: requis });
      return detail(db, id);
    });
  });

  /** Rejet motivé : la facture revient en brouillon. */
  app.post("/factures/:id/rejeter", async (request) => {
    const auth = exiger(request, "facture.valider");
    const { id } = paramsId.parse(request.params);
    const { motif } = factureRejetSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { facture, mission } = await exigerFactureVisible(db, auth, id, true);
      if (facture.statut !== "a_approuver") throw conflit("La facture n'est pas à approuver.");
      if (!estAssocie(auth) && mission.directeur_id !== auth.utilisateurId) {
        throw new AppError(
          403,
          "APPROBATION_REQUISE",
          "Seuls le directeur de la mission ou un associé décident de cette facture.",
        );
      }
      await db.query(
        `UPDATE factures SET statut = 'brouillon', motif_rejet = $2, role_approbateur = NULL,
           modifie_le = now() WHERE id = $1`,
        [id, motif],
      );
      await journal(db, auth, "rejet", facture, { motif });
      return detail(db, id);
    });
  });

  /** Émission : numéro continu sans trou, mentions figées, facture immuable. */
  app.post("/factures/:id/emettre", async (request) => {
    const auth = exiger(request, "facture.emettre");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { facture } = await exigerFactureVisible(db, auth, id, true);
      await emettre(db, auth, facture);
      const emise = await lireFacture(db, id);
      await journal(db, auth, "emission", facture, {
        numero: emise.numero,
        ...(facture.facture_origine_id ? { facture_annulee_id: facture.facture_origine_id } : {}),
      });
      return vueFacture(emise, await lireLignes(db, id));
    });
  });

  /** Avoir total (brouillon) d'une facture émise ; jamais d'avoir d'avoir. */
  app.post("/factures/:id/avoir", async (request, reply) => {
    const auth = exiger(request, "facture.emettre");
    const { id } = paramsId.parse(request.params);
    const { motif } = avoirCreationSchema.parse(request.body);
    const cree = await app.db.withTenant(auth.cabinetId, async (db) => {
      const { facture } = await exigerFactureVisible(db, auth, id, true);
      const avoirId = await creerAvoirBrouillon(db, auth, facture, motif);
      await journal(
        db,
        auth,
        "creation",
        { id: avoirId, mission_id: facture.mission_id, nature: "avoir" },
        {
          facture_origine_id: id,
          motif,
        },
      );
      return detail(db, avoirId);
    });
    reply.status(201);
    return cree;
  });

  /**
   * Point d'extension de l'envoi (PDF par e-mail, branché plus tard) : marque
   * une facture émise comme envoyée, une seule fois.
   */
  app.post("/factures/:id/marquer-envoyee", async (request) => {
    const auth = exiger(request, "facture.emettre");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { facture } = await exigerFactureVisible(db, auth, id, true);
      if (facture.statut !== "emise") throw conflit("Seule une facture émise s'envoie.");
      if (facture.envoyee_le) throw conflit("Facture déjà marquée envoyée.");
      await db.query("UPDATE factures SET envoyee_le = now() WHERE id = $1", [id]);
      await journal(db, auth, "envoi", facture, { numero: facture.numero });
      return detail(db, id);
    });
  });
};
