import { ajouterJours } from "@missionpilot/engines";
import type { CleClient } from "../cles.js";
import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import { CLIENT_DE_MISSION, type Casting, type CleMission, type MissionLue } from "./casting.js";
import {
  ancrer,
  encadrer,
  heureISO,
  ouvre,
  plusTard,
  sansDeclencheurs,
} from "./collaboration-outils.js";
import type { AccesClient, AccesDirigeant } from "./portail-acces.js";
import { designerContributeursKpi } from "./portail-kpi.js";
import { COMMENTAIRES_VALIDATION } from "./portail-donnees.js";
import { ok } from "./outils.js";

/*
 * PARTAGES et VALIDATIONS de jalons du portail client (SOC-09, migrations 0111 à 0115).
 *
 * - Partages : l'associé remplace, client par client, les partages (`PUT /api/portail/partages`) :
 *   missions avec leurs jalons, livrables et lettres de mission VALIDÉS, contact principal du client
 *   (ce qui renseigne `portail_clients`). Les partages déjà posés par d'autres modules sont repris
 *   (la route remplace en bloc) et jamais réduits. Les FACTURES ÉMISES de la mission sont partagées
 *   (`factures` vrai : le client voit SES factures, jamais un coût, un taux interne ni une marge).
 * - Validations : le dirigeant du client valide les jalons atteints (`POST /api/portail/missions/
 *   :id/jalons/:jalonId/valider`) ; sur une mission en cours, le dernier jalon atteint reste « à
 *   valider ». Le client lit ensuite son espace (moi, missions, factures, jalons, livrables).
 * Dates : partage peu après le démarrage de la mission et l'activation du compte ; validation
 * peu après la date prévue du jalon, jamais avant le partage ni la création du compte.
 */

const partageable = (m: MissionLue): boolean =>
  m.terminee || m.statut === "en_cours" || m.statut === "a_cloturer" || m.statut === "cloturee";

interface LignePartage {
  mission_id: string;
  document_id: string | null;
  jalons: boolean;
  factures: boolean;
}

/** Jour de partage d'une mission : peu après son démarrage et l'activation du compte du client. */
function jourPartage(ctx: ContexteTenantDemo, m: MissionLue, depuisCompte: string): string {
  const debut = m.debut ?? ctx.aujourdhui;
  const brut = plusTard(ajouterJours(debut, 12), ajouterJours(depuisCompte, 3));
  const borne = m.terminee && m.fin ? m.fin : ctx.aujourdhui;
  return ouvre(brut > borne ? borne : brut, ctx.aujourdhui);
}

async function partagerClient(
  ctx: ContexteTenantDemo,
  casting: Casting,
  client: CleClient,
  acces: AccesClient,
): Promise<Map<string, string>> {
  const clientId = ctx.client(client);
  const missions = Object.values(casting.missions).filter(
    (m): m is MissionLue =>
      !!m && CLIENT_DE_MISSION[m.cle as CleMission] === client && partageable(m),
  );
  const jours = new Map<string, string>(); // mission_id -> jour de partage
  if (missions.length === 0) return jours;
  const q = (sql: string, p: unknown[]) => ctx.proprietaire.query(sql, p);
  const existants = (
    await q(
      "SELECT mission_id, document_id, jalons, factures FROM portail_partages WHERE cabinet_id = $1 AND client_id = $2",
      [ctx.cabinetId, clientId],
    )
  ).rows as LignePartage[];
  const missionsVoulues = new Map<string, { jalons: boolean; factures: boolean }>();
  for (const e of existants.filter((x) => x.document_id === null)) {
    missionsVoulues.set(e.mission_id, { jalons: e.jalons, factures: e.factures });
  }
  const avecFactures = new Set<string>();
  for (const m of missions) {
    const emises = await q(
      "SELECT 1 FROM factures WHERE cabinet_id = $1 AND mission_id = $2 AND statut = 'emise' LIMIT 1",
      [ctx.cabinetId, m.id],
    );
    if (emises.rows.length > 0) avecFactures.add(m.id);
    const e = missionsVoulues.get(m.id);
    missionsVoulues.set(m.id, {
      jalons: true,
      factures: (e?.factures ?? false) || avecFactures.has(m.id),
    });
  }
  const docsVoulus = new Set(
    existants.filter((x) => x.document_id).map((x) => x.document_id as string),
  );
  const datesDocs = new Map<string, string>();
  for (const m of missions) {
    const docs = (
      await q(
        `SELECT DISTINCT ON (type, nom) id, type, (cree_le AT TIME ZONE 'UTC')::date::text AS jour
           FROM mission_documents
          WHERE cabinet_id = $1 AND mission_id = $2 AND type IN ('livrable', 'lettre_de_mission')
            AND (statut_contenu IS NULL OR statut_contenu = 'valide') AND nom NOT LIKE '%DÉMONSTRATION%'
          ORDER BY type, nom, version DESC`,
        [ctx.cabinetId, m.id],
      )
    ).rows.slice(0, 3);
    for (const d of docs) {
      docsVoulus.add(d.id as string);
      datesDocs.set(d.id as string, d.jour as string);
    }
  }
  const dejaCompletes =
    existants.length > 0 &&
    missions.every((m) =>
      existants.some(
        (e) =>
          e.mission_id === m.id &&
          e.document_id === null &&
          e.jalons &&
          (e.factures || !avecFactures.has(m.id)),
      ),
    ) &&
    [...docsVoulus].every((id) => existants.some((e) => e.document_id === id));
  if (!dejaCompletes) {
    const premiere = missions[0] as MissionLue;
    const contact = premiere.directeurId ?? premiere.chefId;
    const jourMin = missions
      .map((m) => jourPartage(ctx, m, acces.depuis))
      .reduce((a, b) => (a < b ? a : b));
    const { fenetre } = await encadrer(ctx, async () => {
      const r = await ctx.session("associe").put(`/api/portail/partages?client_id=${clientId}`, {
        missions: [...missionsVoulues].map(([mission_id, f]) => ({ mission_id, ...f })),
        documents: [...docsVoulus],
        ...(contact ? { contact_principal_id: contact } : {}),
      });
      ok(200, r, `partages du client ${client}`);
    });
    await ancrer(ctx, fenetre, heureISO(jourMin, 14, 10), true);
  }
  // Dates de partage : une par mission (et par document, jamais avant sa mission).
  const parId = new Map(missions.map((m) => [m.id, m]));
  for (const [missionId] of missionsVoulues) {
    const m = parId.get(missionId);
    const jour = m
      ? jourPartage(ctx, m, acces.depuis)
      : ouvre(ajouterJours(acces.depuis, 3), ctx.aujourdhui);
    jours.set(missionId, jour);
  }
  await sansDeclencheurs(ctx, async (c) => {
    for (const [missionId, jour] of jours) {
      await c.query(
        `UPDATE portail_partages SET partage_le = $3::timestamptz
          WHERE cabinet_id = $1 AND mission_id = $2 AND document_id IS NULL`,
        [ctx.cabinetId, missionId, heureISO(jour, 14, 10)],
      );
    }
    for (const [docId, jourDoc] of datesDocs) {
      const mission = (
        await c.query("SELECT mission_id FROM portail_partages WHERE document_id = $1", [docId])
      ).rows[0]?.mission_id as string | undefined;
      const base = mission ? (jours.get(mission) ?? jourDoc) : jourDoc;
      const jour = ouvre(plusTard(base, ajouterJours(jourDoc, 3)), ctx.aujourdhui);
      await c.query(
        "UPDATE portail_partages SET partage_le = $2::timestamptz WHERE document_id = $1",
        [docId, heureISO(jour, 14, 40)],
      );
    }
    const premier = [...jours.values()].reduce((a, b) => (a < b ? a : b));
    await c.query(
      "UPDATE portail_clients SET modifie_le = $3::timestamptz WHERE cabinet_id = $1 AND client_id = $2",
      [ctx.cabinetId, clientId, heureISO(premier, 14, 10)],
    );
  });
  return jours;
}

/** Validations de jalons par le dirigeant, puis lecture de l'espace client. */
async function validerJalons(
  ctx: ContexteTenantDemo,
  casting: Casting,
  client: CleClient,
  acces: AccesDirigeant,
  jours: Map<string, string>,
): Promise<number> {
  const clientId = ctx.client(client);
  let faits = 0;
  let derniere = acces.depuis;
  for (const [missionId, jourPartageM] of jours) {
    const m = Object.values(casting.missions).find((x) => x?.id === missionId);
    if (!m) continue;
    const jalons = (
      await ctx.proprietaire.query(
        `SELECT j.id, j.libelle, j.date_prevue::text AS prevue,
                EXISTS (SELECT 1 FROM portail_validations_jalons v WHERE v.jalon_id = j.id) AS valide
           FROM mission_jalons j
          WHERE j.cabinet_id = $1 AND j.mission_id = $2 AND j.atteint
          ORDER BY j.date_prevue, j.ordre, j.id`,
        [ctx.cabinetId, missionId],
      )
    ).rows;
    // Mission en cours : le dernier jalon atteint reste « à valider » par le client.
    const aValider = m.terminee || m.statut === "cloturee" ? jalons : jalons.slice(0, -1);
    for (const [i, j] of aValider.entries()) {
      if (j.valide) continue;
      const base = plusTard(
        plusTard(
          ajouterJours((j.prevue as string | null) ?? jourPartageM, 1 + (i % 2)),
          jourPartageM,
        ),
        ajouterJours(acces.depuis, 1),
      );
      const jour = ouvre(base, ctx.aujourdhui);
      const { fenetre } = await encadrer(ctx, async () => {
        const r = await acces.dirigeant.post(
          `/api/portail/missions/${missionId}/jalons/${j.id}/valider`,
          { commentaire: COMMENTAIRES_VALIDATION[(faits + i) % COMMENTAIRES_VALIDATION.length] },
        );
        ok(201, r, `validation du jalon « ${j.libelle} »`);
      });
      const instant = heureISO(jour, 10 + (faits % 6), (faits * 17) % 55);
      await ancrer(ctx, fenetre, instant, jour < ajouterJours(ctx.aujourdhui, -3));
      await sansDeclencheurs(ctx, async (c) => {
        await c.query(
          "UPDATE portail_validations_jalons SET valide_le = $2::timestamptz WHERE jalon_id = $1",
          [j.id, instant],
        );
      });
      derniere = plusTard(derniere, jour);
      faits += 1;
    }
  }
  if (jours.size > 0 && faits > 0) {
    // Lecture de l'espace client (profil, missions, jalons, livrables) au dernier jour d'activité.
    const { fenetre } = await encadrer(ctx, async () => {
      const lire = async (s: SessionDemo, url: string) =>
        ok(200, await s.get(url), `portail ${url}`);
      await lire(acces.dirigeant, "/api/portail/moi");
      await lire(acces.dirigeant, "/api/portail/missions");
      await lire(acces.dirigeant, "/api/portail/factures");
      for (const missionId of jours.keys()) {
        await lire(acces.dirigeant, `/api/portail/missions/${missionId}/jalons`);
        await lire(acces.dirigeant, `/api/portail/missions/${missionId}/livrables`);
      }
      if (acces.contributeur) {
        await lire(acces.contributeur, "/api/portail/moi");
        await lire(acces.contributeur, "/api/portail/missions");
      }
    });
    await ancrer(ctx, fenetre, heureISO(derniere, 16, 30), true);
  }
  ctx.journal(`  portail ${client} : ${faits} validations de jalons (${clientId.slice(0, 8)}).`);
  return faits;
}

/** Partages, validations et lectures de tous les clients ayant un accès au portail. */
export async function semerPartagesEtValidations(
  ctx: ContexteTenantDemo,
  casting: Casting,
  acces: Map<CleClient, AccesClient>,
): Promise<number> {
  let validations = 0;
  for (const [client, a] of acces) {
    const jours = await partagerClient(ctx, casting, client, a);
    await designerContributeursKpi(ctx, casting, client, a);
    if (!a.dirigeant) {
      ctx.journal(`  portail ${client} : aucun dirigeant actif, validations de jalons sautées.`);
      continue;
    }
    validations += await validerJalons(ctx, casting, client, a as AccesDirigeant, jours);
  }
  return validations;
}
