import type { FastifyPluginAsync } from "fastify";
import {
  appliquerPourcentage,
  controlerEcheancierBudget,
  montant as montantMoteur,
  soustraire,
  type Montant,
} from "@missionpilot/engines";
import {
  echeanceCreationSchema,
  echeanceModificationSchema,
  echeancierGenerationSchema,
  regieSchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger, type Auth } from "../auth/contexte.js";
import { traduireErreursPg } from "../db/outils.js";
import type { Db } from "../db/pool.js";
import { conflit, interdit } from "../errors.js";
import { paramsId } from "../http/outils.js";
import { exigerMissionVisible, STATUTS_SIGNES, type MissionAcces } from "../missions/acces.js";
import { aujourdhui } from "../missions/outils.js";
import {
  calculerRegie,
  chargerEcheances,
  echeancesMoteur,
  exigerDansLeBudget,
  exigerEcheance,
  genererEcheances,
  honorairesSignes,
  insererEcheance,
  rattacherTemps,
  type EcheanceDb,
} from "../facturation/echeancier.js";
import { peutGererEcheancier } from "../facturation/outils.js";

/** Mission signée (budget figé) dont l'utilisateur gère l'échéancier, verrouillée. */
async function missionGeree(db: Db, auth: Auth, id: string): Promise<MissionAcces> {
  const mission = await exigerMissionVisible(db, auth, id, true);
  if (!peutGererEcheancier(auth, mission)) throw interdit();
  if (!STATUTS_SIGNES.includes(mission.statut)) {
    throw conflit("L'échéancier se construit après la signature de la lettre de mission.");
  }
  return mission;
}

const vue = (e: EcheanceDb) => e;

const REFERENCE_JALON = "Jalon inconnu dans cette mission.";

/** Échéancier de facturation (FIN-06, MIS-10). */
export const routesEcheancier: FastifyPluginAsync = async (app) => {
  /** Échéances, total, budget signé et reste à planifier (moteur). */
  app.get("/missions/:id/echeancier", async (request) => {
    const auth = exiger(request, "facture.lire");
    const { id } = paramsId.parse(request.params);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await exigerMissionVisible(db, auth, id);
      const echeances = await chargerEcheances(db, id);
      const signe = STATUTS_SIGNES.includes(mission.statut);
      const budget: Montant | null = signe ? await honorairesSignes(db, mission) : null;
      const controle = budget
        ? controlerEcheancierBudget(echeancesMoteur(echeances), budget)
        : null;
      return {
        mission_id: id,
        devise: mission.devise,
        budget_signe: budget?.valeur ?? null,
        total: controle?.total.valeur ?? null,
        depassement: controle?.depassement.valeur ?? null,
        reste_a_planifier:
          budget && controle && controle.conforme
            ? soustraire(budget, controle.total).valeur
            : budget
              ? 0
              : null,
        echeances: echeances.map(vue),
      };
    });
  });

  /** Génère l'échéancier depuis le mode de facturation (échéancier vide seulement). */
  app.post("/missions/:id/echeancier/generer", async (request, reply) => {
    const auth = exiger(request);
    const { id } = paramsId.parse(request.params);
    const demande = echeancierGenerationSchema.parse(request.body ?? {});
    const creees = await app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await missionGeree(db, auth, id);
      if ((await chargerEcheances(db, id)).length > 0) {
        throw conflit("L'échéancier existe déjà : ajouter ou modifier des échéances.");
      }
      const m = await db.query(
        "SELECT date_fin::text AS date_fin, mode_facturation FROM missions WHERE id = $1",
        [id],
      );
      const budget = await honorairesSignes(db, mission);
      const nouvelles = genererEcheances({ ...mission, ...m.rows[0] }, budget, demande);
      exigerDansLeBudget(
        nouvelles.map((e) => ({
          libelle: e.libelle,
          date: e.date_prevue,
          montant: montantMoteur(e.montant, budget.devise),
        })),
        budget,
      );
      for (const [i, e] of nouvelles.entries()) {
        await traduireErreursPg(
          insererEcheance(db, auth.cabinetId, mission, e, i + 1, auth.utilisateurId),
          {},
          REFERENCE_JALON,
        );
      }
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "generation_echeancier",
        entite: "mission",
        entiteId: id,
        details: { echeances: nouvelles.length, mode: m.rows[0].mode_facturation },
      });
      return chargerEcheances(db, id);
    });
    reply.status(201);
    return { elements: creees };
  });

  /** Régie : une échéance par mois sur les temps validés non encore rattachés. */
  app.post("/missions/:id/echeancier/regie", async (request, reply) => {
    const auth = exiger(request);
    const { id } = paramsId.parse(request.params);
    const { jusqu_au } = regieSchema.parse(request.body ?? {});
    const creees = await app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await missionGeree(db, auth, id);
      const m = await db.query("SELECT mode_facturation FROM missions WHERE id = $1", [id]);
      if (m.rows[0].mode_facturation !== "regie") {
        throw conflit("Seule une mission en régie se facture sur les temps validés.");
      }
      const regies = await calculerRegie(db, mission, jusqu_au ?? aujourdhui());
      if (regies.length === 0) return [];
      const budget = await honorairesSignes(db, mission);
      const existantes = await chargerEcheances(db, id);
      exigerDansLeBudget(
        [
          ...echeancesMoteur(existantes),
          ...regies.map((r) => ({
            libelle: r.echeance.libelle,
            date: r.echeance.date_prevue,
            montant: montantMoteur(r.echeance.montant, budget.devise),
          })),
        ],
        budget,
      );
      const ids: string[] = [];
      for (const [i, r] of regies.entries()) {
        const echeanceId = await insererEcheance(
          db,
          auth.cabinetId,
          mission,
          r.echeance,
          existantes.length + i + 1,
          auth.utilisateurId,
        );
        await rattacherTemps(db, auth.cabinetId, id, echeanceId, r.temps);
        ids.push(echeanceId);
      }
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "regie_echeancier",
        entite: "mission",
        entiteId: id,
        details: {
          echeances: ids,
          temps_rattaches: regies.reduce((n, r) => n + r.temps.length, 0),
        },
      });
      return (await chargerEcheances(db, id)).filter((e) => ids.includes(e.id));
    });
    reply.status(201);
    return { elements: creees };
  });

  /** Échéance saisie : montant, ou pourcentage du budget signé (moteur). */
  app.post("/missions/:id/echeances", async (request, reply) => {
    const auth = exiger(request);
    const { id } = paramsId.parse(request.params);
    const e = echeanceCreationSchema.parse(request.body);
    const creee = await app.db.withTenant(auth.cabinetId, async (db) => {
      const mission = await missionGeree(db, auth, id);
      const budget = await honorairesSignes(db, mission);
      const montant = e.montant ?? appliquerPourcentage(budget, e.pourcentage as number).valeur;
      const existantes = await chargerEcheances(db, id);
      exigerDansLeBudget(
        [
          ...echeancesMoteur(existantes),
          {
            libelle: e.libelle,
            date: e.date_prevue,
            montant: montantMoteur(montant, budget.devise),
          },
        ],
        budget,
      );
      const echeanceId = await traduireErreursPg(
        insererEcheance(
          db,
          auth.cabinetId,
          mission,
          {
            type: e.type,
            libelle: e.libelle,
            montant,
            pourcentage: e.pourcentage ?? null,
            date_prevue: e.date_prevue,
            jalon_id: e.jalon_id,
            statut: "prevue",
          },
          existantes.length + 1,
          auth.utilisateurId,
        ),
        {},
        REFERENCE_JALON,
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "creation",
        entite: "echeance_facturation",
        entiteId: echeanceId,
        details: { mission_id: id, type: e.type, date_prevue: e.date_prevue },
      });
      return exigerEcheance(db, echeanceId);
    });
    reply.status(201);
    return creee;
  });

  /** Modifie une échéance non facturée et non rattachée à une facture en cours. */
  app.patch("/echeances/:id", async (request) => {
    const auth = exiger(request);
    const { id } = paramsId.parse(request.params);
    const modif = echeanceModificationSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const lue = await exigerEcheance(db, id);
      const mission = await missionGeree(db, auth, lue.mission_id);
      const e = await exigerEcheance(db, id, true);
      if (e.statut === "facturee") throw conflit("Échéance facturée : la corriger par un avoir.");
      if (e.facture_id) throw conflit("Échéance rattachée à une facture en cours.");
      if (e.type === "regie" && (modif.montant !== undefined || modif.pourcentage !== undefined)) {
        throw conflit("Le montant d'une échéance de régie vient des temps validés.");
      }
      const budget = await honorairesSignes(db, mission);
      const montant =
        modif.montant ??
        (modif.pourcentage !== undefined
          ? appliquerPourcentage(budget, modif.pourcentage).valeur
          : e.montant);
      const pourcentage = modif.montant !== undefined ? null : (modif.pourcentage ?? e.pourcentage);
      const autres = (await chargerEcheances(db, e.mission_id)).filter((x) => x.id !== id);
      exigerDansLeBudget(
        [
          ...echeancesMoteur(autres),
          {
            libelle: modif.libelle ?? e.libelle,
            date: modif.date_prevue ?? e.date_prevue,
            montant: montantMoteur(montant, budget.devise),
          },
        ],
        budget,
      );
      await traduireErreursPg(
        db.query(
          `UPDATE echeances_facturation SET libelle = $2, montant = $3, pourcentage = $4,
             date_prevue = $5, jalon_id = $6, statut = $7, modifie_le = now() WHERE id = $1`,
          [
            id,
            modif.libelle ?? e.libelle,
            montant,
            pourcentage,
            modif.date_prevue ?? e.date_prevue,
            modif.jalon_id === undefined ? e.jalon_id : modif.jalon_id,
            modif.statut ?? e.statut,
          ],
        ),
        {},
        REFERENCE_JALON,
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "echeance_facturation",
        entiteId: id,
        details: {
          mission_id: e.mission_id,
          champs: Object.keys(modif),
          ...(modif.statut ? { statut: modif.statut } : {}),
        },
      });
      return exigerEcheance(db, id);
    });
  });

  /** Supprime une échéance jamais facturée (ses temps de régie redeviennent libres). */
  app.delete("/echeances/:id", async (request, reply) => {
    const auth = exiger(request);
    const { id } = paramsId.parse(request.params);
    await app.db.withTenant(auth.cabinetId, async (db) => {
      const lue = await exigerEcheance(db, id);
      await missionGeree(db, auth, lue.mission_id);
      const e = await exigerEcheance(db, id, true);
      if (e.statut === "facturee") throw conflit("Échéance facturée : suppression refusée.");
      if (e.facture_id) throw conflit("Échéance rattachée à une facture en cours.");
      const citee = await db.query("SELECT 1 FROM facture_lignes WHERE echeance_id = $1 LIMIT 1", [
        id,
      ]);
      if (citee.rowCount) {
        throw conflit("Échéance citée par une facture annulée : la conserver pour l'historique.");
      }
      await db.query("DELETE FROM echeances_facturation WHERE id = $1", [id]);
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "suppression",
        entite: "echeance_facturation",
        entiteId: id,
        details: { mission_id: e.mission_id, type: e.type },
      });
    });
    return reply.status(204).send();
  });
};
