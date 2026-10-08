import type { FastifyPluginAsync } from "fastify";
import {
  appliquerPourcentage,
  comparer,
  controlerEcheancierBudget,
  montant as montantMoteur,
  soustraire,
  sommer,
  type Montant,
  type RoleApprobateur,
} from "@missionpilot/engines";
import {
  aPermission,
  echeanceCreationSchema,
  echeanceModificationSchema,
  echeancierGenerationSchema,
  regieSchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger, type Auth } from "../auth/contexte.js";
import { traduireErreursPg } from "../db/outils.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, interdit, introuvable } from "../errors.js";
import { paramsId } from "../http/outils.js";
import {
  estAssocie,
  exigerMissionVisible,
  STATUTS_SIGNES,
  type MissionAcces,
} from "../missions/acces.js";
import { satisfaitRole } from "../missions/budget.js";
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
import {
  missionVisibleOuNull,
  peutGererEcheancier,
  roleSelonSeuils,
} from "../facturation/outils.js";

function exigerGestion(auth: Auth, mission: MissionAcces): MissionAcces {
  if (!peutGererEcheancier(auth, mission)) throw interdit();
  if (!STATUTS_SIGNES.includes(mission.statut)) {
    throw conflit("L'échéancier se construit après la signature de la lettre de mission.");
  }
  return mission;
}

/** Mission signée (budget figé) dont l'utilisateur gère l'échéancier, verrouillée. */
async function missionGeree(db: Db, auth: Auth, id: string): Promise<MissionAcces> {
  return exigerGestion(auth, await exigerMissionVisible(db, auth, id, true));
}

/**
 * Mission d'une échéance, gérée par l'utilisateur. Mission invisible : même
 * réponse qu'une échéance inexistante (404 « Échéance », constat F7).
 */
async function missionGereeDeLEcheance(
  db: Db,
  auth: Auth,
  missionId: string,
): Promise<MissionAcces> {
  const mission = await missionVisibleOuNull(db, auth, missionId, true);
  if (!mission) throw introuvable("Échéance");
  return exigerGestion(auth, mission);
}

/**
 * Taux de vente de la régie (constat F6) : le montant d'une échéance de
 * régie (jours × taux) permettrait, avec les jours validés, de déduire le
 * taux journalier. Sans « finance.lire », il est masqué (null).
 */
const voitTauxVente = (auth: Auth) => aPermission(auth.roles, "finance.lire");

type VueEcheance = Omit<EcheanceDb, "montant"> & { montant: number | null };

const vue = (e: EcheanceDb, auth: Auth): VueEcheance =>
  e.type === "regie" && !voitTauxVente(auth) ? { ...e, montant: null } : e;

const LIBELLE_ROLE: Record<RoleApprobateur, string> = {
  chef_mission: "le chef de la mission",
  directeur_mission: "le directeur de la mission ou un associé",
  associe: "un associé",
};

/**
 * Baisse de l'échéancier (FIN-15, constat M1 b) : réduire ou supprimer une
 * échéance revient à consentir une remise sur le budget signé. Le contrôle
 * porte sur l'ÉCART CUMULÉ entre le budget signé et le total de l'échéancier
 * après l'opération (une suite de petites baisses ne contourne donc pas le
 * seuil), comparé aux paliers « remise » du moteur (roleApprobateur) :
 * - palier « chef de mission » : quiconque gère l'échéancier ;
 * - palier « directeur » : le directeur désigné de la mission ou un associé ;
 * - palier « associé » : un associé.
 * Sinon 403 APPROBATION_REQUISE. Choix documenté : l'acteur doit porter le
 * rôle exigé (pas de circuit d'approbation différé). Une hausse, ou une
 * échéance de régie (ses temps redeviennent facturables), n'est pas concernée.
 */
function exigerApprobationBaisse(
  auth: Auth,
  mission: MissionAcces,
  budget: Montant,
  totalAvant: Montant,
  totalApres: Montant,
): void {
  if (comparer(totalApres, totalAvant) >= 0) return;
  const ecart = soustraire(budget, totalApres);
  if (ecart.valeur <= 0) return;
  const requis = roleSelonSeuils("remise", ecart, mission);
  if (requis === "chef_mission") return;
  const autorise =
    estAssocie(auth) ||
    (requis === "directeur_mission" &&
      mission.directeur_id === auth.utilisateurId &&
      satisfaitRole(auth.roles, "directeur_mission"));
  if (!autorise) {
    throw new AppError(
      403,
      "APPROBATION_REQUISE",
      `Cette baisse de l'échéancier (écart au budget signé) est décidée par ${LIBELLE_ROLE[requis]}.`,
    );
  }
}

const totalEcheances = (echeances: readonly EcheanceDb[], budget: Montant): Montant =>
  sommer(
    echeances.map((e) => montantMoteur(e.montant, budget.devise)),
    budget.devise,
  );

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
      // Avec une échéance de régie, le total la déduirait : masqué de même (F6).
      const masquer = !voitTauxVente(auth) && echeances.some((e) => e.type === "regie");
      return {
        mission_id: id,
        devise: mission.devise,
        budget_signe: budget?.valeur ?? null,
        total: masquer ? null : (controle?.total.valeur ?? null),
        depassement: masquer ? null : (controle?.depassement.valeur ?? null),
        reste_a_planifier: masquer
          ? null
          : budget && controle && controle.conforme
            ? soustraire(budget, controle.total).valeur
            : budget
              ? 0
              : null,
        echeances: echeances.map((e) => vue(e, auth)),
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
      return (await chargerEcheances(db, id)).map((e) => vue(e, auth));
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
      return (await chargerEcheances(db, id))
        .filter((e) => ids.includes(e.id))
        .map((e) => vue(e, auth));
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
      return vue(await exigerEcheance(db, echeanceId), auth);
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
      const mission = await missionGereeDeLEcheance(db, auth, lue.mission_id);
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
      const toutes = await chargerEcheances(db, e.mission_id);
      const autres = toutes.filter((x) => x.id !== id);
      if (e.type !== "regie") {
        exigerApprobationBaisse(
          auth,
          mission,
          budget,
          totalEcheances(toutes, budget),
          totalEcheances([...autres, { ...e, montant }], budget),
        );
      }
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
          ...(montant !== e.montant ? { montant_avant: e.montant, montant_apres: montant } : {}),
        },
      });
      return vue(await exigerEcheance(db, id), auth);
    });
  });

  /** Supprime une échéance jamais facturée (ses temps de régie redeviennent libres). */
  app.delete("/echeances/:id", async (request, reply) => {
    const auth = exiger(request);
    const { id } = paramsId.parse(request.params);
    await app.db.withTenant(auth.cabinetId, async (db) => {
      const lue = await exigerEcheance(db, id);
      const mission = await missionGereeDeLEcheance(db, auth, lue.mission_id);
      const e = await exigerEcheance(db, id, true);
      if (e.statut === "facturee") throw conflit("Échéance facturée : suppression refusée.");
      if (e.facture_id) throw conflit("Échéance rattachée à une facture en cours.");
      const citee = await db.query("SELECT 1 FROM facture_lignes WHERE echeance_id = $1 LIMIT 1", [
        id,
      ]);
      if (citee.rowCount) {
        throw conflit("Échéance citée par une facture annulée : la conserver pour l'historique.");
      }
      if (e.type !== "regie") {
        const budget = await honorairesSignes(db, mission);
        const toutes = await chargerEcheances(db, e.mission_id);
        exigerApprobationBaisse(
          auth,
          mission,
          budget,
          totalEcheances(toutes, budget),
          totalEcheances(
            toutes.filter((x) => x.id !== id),
            budget,
          ),
        );
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
