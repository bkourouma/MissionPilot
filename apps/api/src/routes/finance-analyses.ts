import type { FastifyPluginAsync } from "fastify";
import {
  balanceAgee,
  balanceAgeeParClient,
  type Creance,
  type Devise,
} from "@missionpilot/engines";
import {
  aPermission,
  balanceAgeeQuerySchema,
  encoursQuerySchema,
  rentabiliteQuerySchema,
} from "@missionpilot/shared";
import { exiger, type Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { interdit } from "../errors.js";
import { paramsId } from "../http/outils.js";
import {
  exigerMissionVisible,
  filtreVisibilite,
  voitToutesLesMissions,
} from "../missions/acces.js";
import { aujourdhui } from "../missions/outils.js";
import {
  encoursCabinet,
  encoursDesMissions,
  joursDesMissions,
  rentabilite,
  vueEncours,
  type EncoursMission,
} from "../finance/analyses.js";
import {
  analyserMissions,
  chargerMissions,
  deviseDuCabinet,
  suiviMission,
} from "../finance/donnees.js";
import {
  COLONNES_FACTURE_PAIEMENT,
  imputationsParFacture,
  situationPaiement,
  versFacturePaiement,
} from "../finance/paiements.js";

/*
 * Analyses financières (FIN-09, FIN-11, FIN-12).
 *
 * DROITS (décision documentée)
 * - Balance âgée : « facture.lire » ET (« encaissement.gerer » OU
 *   « indicateurs.cabinet ») : associé, gestionnaire, directeur de mission.
 *   Le chef de mission, qui lit les factures de ses missions, n'a pas la vue
 *   des créances du cabinet. Aucun coût ni marge n'y figure.
 * - Encours de production : « facture.lire » OU « indicateurs.cabinet » pour
 *   les jours ; la valorisation (valeur produite, facturé, encours, facturé
 *   d'avance) exige « finance.lire » : champs ABSENTS sinon.
 * - Rentabilité : « finance.lire » obligatoire (403 sinon).
 *
 * VOLUME (décision documentée)
 * - Encours à une date : missions signées à cette date, SANS les missions
 *   clôturées avant elle (une mission clôturée le jour même y figure encore).
 * - Rentabilité : période de 366 jours au plus (INDICATEURS_MAX_JOURS, comme
 *   les indicateurs : une analyse de pilotage porte sur un exercice ; l'export
 *   comptable, qui sert aussi aux reprises, garde 731 jours).
 * - Tarifications chargées en lot (finance/donnees.ts `chargerTarifications`).
 */

const VUE_TRANCHES = {
  nonEchu: "non_echu",
  j0a30: "j0_30",
  j31a60: "j31_60",
  j61a90: "j61_90",
  plus90: "plus_90",
  total: "total",
} as const;

function vueBalance(b: Record<keyof typeof VUE_TRANCHES, { valeur: number }>) {
  return Object.fromEntries(
    Object.entries(VUE_TRANCHES).map(([cle, nom]) => [
      nom,
      b[cle as keyof typeof VUE_TRANCHES].valeur,
    ]),
  );
}

/** Créances à une date : factures émises (ou annulées après cette date), solde par le moteur. */
async function creancesALaDate(
  db: Db,
  auth: Auth,
  date: string,
): Promise<{ creances: Creance[]; devises: Devise[]; clients: Map<string, string> }> {
  const r = await db.query(
    `SELECT ${COLONNES_FACTURE_PAIEMENT}, cl.raison_sociale AS client
     FROM factures f JOIN missions m ON m.id = f.mission_id JOIN clients cl ON cl.id = f.client_id
     WHERE f.nature = 'facture' AND f.date_emission <= $1
       AND (f.statut = 'emise' OR (f.statut = 'annulee' AND (f.annulee_le AT TIME ZONE 'UTC')::date > $1))
       AND ${filtreVisibilite(2, 3)}`,
    [date, voitToutesLesMissions(auth), auth.utilisateurId],
  );
  // Annulée après la date de référence : encore due à cette date.
  const factures = r.rows.map((l) => ({ ...versFacturePaiement(l), statut: "emise" }));
  const clients = new Map(r.rows.map((l) => [l.client_id as string, l.client as string]));
  const imputations = await imputationsParFacture(
    db,
    factures.map((f) => f.id),
    date,
  );
  const creances = factures.map((f) => ({
    factureId: f.id,
    clientId: f.client_id,
    dateEmission: f.date_emission as string,
    dateEcheance: f.date_echeance as string,
    solde: situationPaiement(f, imputations.get(f.id) ?? [], date).solde,
  }));
  return {
    creances,
    devises: [...new Set(creances.map((c) => c.solde.devise))].sort(),
    clients,
  };
}

function vueEncoursMission(e: EncoursMission, finance: boolean): Record<string, unknown> {
  return {
    mission_id: e.mission.id,
    intitule: e.mission.intitule,
    client_id: e.mission.client_id,
    statut: e.mission.statut,
    jours_valides: e.jours_valides,
    ...(finance
      ? {
          devise: e.mission.devise,
          jours_non_valorises: e.jours_non_valorises,
          valeur_produite: e.valeur_produite.valeur,
          honoraires_factures: e.honoraires_factures.valeur,
          ...vueEncours(e.encours),
        }
      : {}),
  };
}

function exigerLectureEncours(auth: Auth): void {
  if (!aPermission(auth.roles, "facture.lire") && !aPermission(auth.roles, "indicateurs.cabinet")) {
    throw interdit();
  }
}

export const routesFinanceAnalyses: FastifyPluginAsync = async (app) => {
  app.get("/finance/balance-agee", async (request) => {
    const auth = exiger(request, "facture.lire");
    if (
      !aPermission(auth.roles, "encaissement.gerer") &&
      !aPermission(auth.roles, "indicateurs.cabinet")
    ) {
      throw interdit();
    }
    const q = balanceAgeeQuerySchema.parse(request.query);
    const date = q.date ?? aujourdhui();
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const { creances, devises, clients } = await creancesALaDate(db, auth, date);
      return {
        date,
        base: q.base,
        devises: devises.map((devise) => {
          const siennes = creances.filter((c) => c.solde.devise === devise);
          const options = { dateReference: date, devise, base: q.base };
          return {
            devise,
            total: vueBalance(balanceAgee(siennes, options)),
            clients: balanceAgeeParClient(siennes, options)
              .filter((c) => c.balance.total.valeur !== 0)
              .map((c) => ({
                client_id: c.clientId,
                raison_sociale: clients.get(c.clientId) ?? null,
                ...vueBalance(c.balance),
              })),
          };
        }),
      };
    });
  });

  app.get("/finance/encours", async (request) => {
    const auth = exiger(request);
    exigerLectureEncours(auth);
    const q = encoursQuerySchema.parse(request.query);
    const date = q.date ?? aujourdhui();
    const finance = aPermission(auth.roles, "finance.lire");
    return app.db.withTenant(auth.cabinetId, async (db) => {
      // Missions signées à la date, hors missions clôturées avant elle.
      const missions = (await chargerMissions(db, auth)).filter(
        (m) =>
          (m.date_signature === null || m.date_signature <= date) &&
          (m.cloturee_le === null || m.cloturee_le >= date),
      );
      const encours = encoursDesMissions(await analyserMissions(db, missions, null, date));
      const devise = await deviseDuCabinet(db, auth.cabinetId);
      const cabinet = encoursCabinet(encours, devise);
      return {
        date,
        missions: encours.map((e) => vueEncoursMission(e, finance)),
        ...(finance
          ? {
              cabinet: { devise, ...vueEncours(cabinet.encours) },
              missions_exclues: cabinet.exclues,
            }
          : {}),
      };
    });
  });

  app.get("/missions/:id/encours", async (request) => {
    const auth = exiger(request);
    exigerLectureEncours(auth);
    const { id } = paramsId.parse(request.params);
    const q = encoursQuerySchema.parse(request.query);
    const date = q.date ?? aujourdhui();
    const finance = aPermission(auth.roles, "finance.lire");
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerMissionVisible(db, auth, id);
      const missions = await chargerMissions(db, auth, [id]);
      const [e] = encoursDesMissions(await analyserMissions(db, missions, null, date));
      if (!e) {
        return { date, mission_id: id, signee: false };
      }
      return { date, signee: true, ...vueEncoursMission(e, finance) };
    });
  });

  app.get("/finance/rentabilite", async (request) => {
    const auth = exiger(request, "finance.lire");
    const q = rentabiliteQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const devise = await deviseDuCabinet(db, auth.cabinetId);
      const missions = await chargerMissions(db, auth);
      const analyses = (await analyserMissions(db, missions, q.du, q.au)).filter(
        (a) =>
          a.jours_valides !== 0 ||
          a.honoraires_factures.valeur !== 0 ||
          a.debours_non_refactures.valeur !== 0,
      );
      const jours = await joursDesMissions(
        db,
        auth.cabinetId,
        analyses.map((a) => a.mission),
        suiviMission,
      );
      const r = rentabilite(analyses, q.niveau, devise, jours);
      return {
        niveau: q.niveau,
        du: q.du,
        au: q.au,
        devise,
        elements: r.elements,
        total: r.total,
        missions_exclues: r.exclues,
      };
    });
  });
};
