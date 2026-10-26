import { ajouterJours } from "@missionpilot/engines";
import type { CleClient } from "../cles.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { CLIENT_DE_MISSION, type Casting, type CleMission } from "./casting.js";
import { ancrer, encadrer, heureISO, ouvre } from "./collaboration-outils.js";
import { ok } from "./outils.js";
import type { AccesClient } from "./portail-acces.js";

/*
 * KPI visibles au portail (KPI-02) : le client ne voit que les KPI dont son compte est contributeur
 * désigné (`kpi_contributeurs`) sur une mission PARTAGÉE. Pour chaque client dont un compte
 * (dirigeant ou contributeur) est actif, l'associé désigne ces comptes sur jusqu'à 3 KPI actifs de
 * ses missions partageables, EN CONSERVANT les contributeurs déjà désignés (la route remplace la
 * liste en bloc). Aucun KPI n'est créé ni modifié : seuls des comptes sont ajoutés comme
 * contributeurs. Idempotent : un KPI qui compte déjà ces comptes n'est pas retouché.
 */

const KPI_PAR_CLIENT = 3;

export async function designerContributeursKpi(
  ctx: ContexteTenantDemo,
  casting: Casting,
  client: CleClient,
  acces: AccesClient,
): Promise<number> {
  const comptes = [acces.dirigeant?.utilisateurId, acces.contributeur?.utilisateurId].filter(
    (id): id is string => !!id,
  );
  if (comptes.length === 0) return 0;
  const missions = Object.values(casting.missions).filter(
    (m) => !!m && CLIENT_DE_MISSION[m.cle as CleMission] === client && m.statut !== "proposition",
  );
  if (missions.length === 0) return 0;
  const r = await ctx.proprietaire.query(
    `SELECT d.id, d.libelle,
            coalesce((SELECT array_agg(k.utilisateur_id::text) FROM kpi_contributeurs k
                       WHERE k.kpi_id = d.id), '{}') AS contributeurs
       FROM kpi_definitions d
      WHERE d.cabinet_id = $1 AND d.actif AND d.mission_id = ANY ($2::uuid[])
      ORDER BY d.libelle, d.id`,
    [ctx.cabinetId, missions.map((m) => m?.id)],
  );
  const kpis = r.rows as { id: string; libelle: string; contributeurs: string[] }[];
  // KPI déjà ouverts à ces comptes d'abord (compte pour le quota), puis les premiers de la liste.
  const deja = kpis.filter((k) => comptes.every((c) => k.contributeurs.includes(c)));
  const a_faire = kpis
    .filter((k) => !deja.includes(k))
    .slice(0, Math.max(0, KPI_PAR_CLIENT - deja.length));
  let faits = 0;
  for (const k of a_faire) {
    const jour = ouvre(ajouterJours(acces.depuis, 5), ctx.aujourdhui);
    const { fenetre } = await encadrer(ctx, async () => {
      const rep = await ctx.session("associe").put(`/api/kpi/${k.id}/contributeurs`, {
        utilisateurs: [...new Set([...k.contributeurs, ...comptes])],
      });
      ok(200, rep, `contributeurs du KPI « ${k.libelle} »`);
    });
    await ancrer(ctx, fenetre, heureISO(jour, 15, 20 + faits), true);
    faits += 1;
  }
  if (faits > 0) ctx.journal(`  portail ${client} : ${faits} KPI ouverts aux comptes du client.`);
  return faits;
}
