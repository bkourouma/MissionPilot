import { suivreKpis } from "../../../kpi/suivi.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { trouverMission, type MissionTrouvee } from "./casting.js";
import { semerAction } from "./kpi-actions.js";
import { acteursMission, comptesPortail, type ActeursMission } from "./kpi-acteurs.js";
import { MISSION_BANQUE, MISSION_BAOBAB } from "./kpi-cat-baobab-banque.js";
import { MISSION_ATLANTIQUE, MISSION_SAHEL } from "./kpi-cat-sahel-atlantique.js";
import { MISSION_EXPORT, MISSION_SICAFE } from "./kpi-cat-sicafe.js";
import { synchroniserDefinitions } from "./kpi-definitions.js";
import {
  datesDeSuivi,
  fenetreMission,
  verifierSpecDansFenetre,
  type FenetreKpi,
} from "./kpi-fenetre.js";
import { semerArbre, semerRevue } from "./kpi-pilotage.js";
import {
  ACTIONS_ATLANTIQUE,
  ACTIONS_SAHEL,
  ACTIONS_SICAFE,
  REVUES_ATLANTIQUE,
  REVUES_SAHEL,
  REVUES_SICAFE,
} from "./kpi-revues-a.js";
import {
  ACTIONS_BANQUE,
  ACTIONS_BAOBAB,
  ACTIONS_EXPORT,
  REVUES_BANQUE,
  REVUES_BAOBAB,
  REVUES_EXPORT,
} from "./kpi-revues-b.js";
import { synchroniserMesures } from "./kpi-saisies.js";
import { genererSeries } from "./kpi-series.js";
import type { SpecMissionKpi } from "./kpi-types.js";
import { exiger, existe } from "./outils.js";

/*
 * Étape « kpi » de la phase « notation-plans » : pilotage par KPI (service #4) des six missions du
 * casting, par les VRAIES routes (kpi.ts, kpi-pilotage.ts, portail-kpi.ts), avec des mesures
 * MENSUELLES bornées à la FENÊTRE de chaque mission (kpi-fenetre.ts) : du mois qui précède le début
 * de la mission (mesure de référence) au mois de min(fin de mission, 30 septembre 2026) ; jamais de
 * mesure future ni après la fin de la mission. Mission 1 : octobre 2024 à avril 2025 ; 2 : janvier à
 * juin 2025 ; 5 : décembre 2025 à mai 2026 ; 6 : mai à septembre 2026 ; 9 : juillet à septembre 2026 ;
 * 10 (signée, démarrage le 2026-11-09) : AUCUNE mesure, ni revue, ni action, ni alerte (définitions,
 * cibles et contributeurs seulement). Toute donnée datée (cibles, incidents, corrections, revues,
 * échéances, passages du suivi) reste dans la fenêtre de sa mission ; seule la revue planifiée d'une
 * mission en cours (6, 9) peut tomber dans les semaines qui suivent « aujourd'hui ». Les missions
 * restent ouvertes pendant toute la phase (leur clôture est faite plus tard par la phase « gestion »).
 *
 * KPI PAR MISSION : libellé exact (clé naturelle dans la mission) ; entre parenthèses, la clé
 * interne du seed et, après « = », la règle des KPI calculés (valeur saisie, mais déduite des
 * leviers). Pour lier un plan stratégique à ces KPI (plan_objectif_kpis), les retrouver par
 * `kpi_definitions.libelle` dans la mission.
 *
 *  1. « Plan stratégique 2025-2028 — SICAFE » (client sicafe)
 *     Chiffre d'affaires mensuel (sicafe.ca) · Coûts d'approvisionnement (sicafe.cout) ·
 *     Marge brute mensuelle (sicafe.marge = CA − coûts) · Délai moyen de recouvrement
 *     (sicafe.recouvrement, saisi par le portail) · Taux de défaut qualité (sicafe.defaut) ·
 *     Taux de rotation du personnel (sicafe.rotation) · Indice de satisfaction client (NPS)
 *     (sicafe.nps, saisi par le portail). Arbre : marge brute = CA − coûts.
 *  2. « Notation financière — Sahel Coton » (client sahel-coton)
 *     Chiffre d'affaires export (sahel.ca) · Marge d'exploitation (sahel.marge) ·
 *     Ratio dette nette / EBITDA (sahel.endettement) · Délai moyen de recouvrement
 *     (sahel.recouvrement) · Besoin en fonds de roulement (sahel.bfr) ·
 *     Taux de défaut qualité fibre (sahel.defaut).
 *  5. « Business plan bancable — Atlantique Retail » (client atlantique-retail)
 *     Nombre de tickets de caisse (atl.tickets) · Panier moyen (atl.panier) ·
 *     Chiffre d'affaires magasins (atl.ca = tickets × panier) · Marge commerciale (atl.marge) ·
 *     Rotation des stocks (atl.stocks) · Taux de rotation du personnel (atl.rotation) ·
 *     Indice de satisfaction client (NPS) (atl.nps). Arbre : CA = tickets × panier.
 *  6. « Plan stratégique 2026-2030 — Baobab Assurances » (client baobab-assurances)
 *     Primes émises (bao.primes) · Sinistres réglés (bao.sinistres) ·
 *     Résultat technique (bao.resultat = primes − sinistres) ·
 *     Ratio sinistres / primes (S/P) (bao.sp = sinistres / primes) ·
 *     Taux de résiliation (bao.resiliation) · Délai moyen de règlement des sinistres
 *     (bao.reglement ; mesure de septembre 2026 absente : retard, rappel) ·
 *     Indice de satisfaction client (NPS) (bao.nps). Arbre : résultat = primes − sinistres.
 *  9. « Notation financière — Banque du Sahel (portefeuille PME) » (client banque-sahel)
 *     Marge d'intérêts (ban.interets) · Commissions nettes (ban.commissions) ·
 *     Produit net bancaire (ban.pnb = intérêts + commissions) ·
 *     Encours de crédit aux PME (ban.encours, portail ; septembre 2026 absent) ·
 *     Taux de créances douteuses (ban.douteuses, portail) · Coefficient d'exploitation
 *     (ban.coefexpl) · Délai de traitement d'un dossier de crédit (ban.delai) ·
 *     Indice de satisfaction client (NPS) (ban.nps, portail). Arbre : PNB = intérêts + commissions.
 * 10. « Plan stratégique — Sicafe Export » (client sicafe-export, mission signée)
 *     Chiffre d'affaires export (export.ca) · Taux de service client (OTIF) (export.otif) ·
 *     Délai moyen de recouvrement (export.recouvrement) · Taux de défaut qualité (export.defaut) ·
 *     Indice de satisfaction client (NPS) (export.nps).
 *
 * Seuls les clients sicafe et banque-sahel ont des comptes du portail : les saisies « client »
 * (et leurs corrections) ne concernent que les KPI des missions 1 et 9.
 *
 * Idempotence : KPI par libellé, mesures par date (relues avant d'écrire), cibles par date d'effet,
 * arbres par KPI racine, revues par titre, décisions par libellé, actions par titre, alertes et
 * rappels par (KPI, code, période) : une étape rejouée ne duplique rien.
 *
 * Limite connue : `cree_le`/`saisie_le` sont ceux de l'exécution (les routes horodatent « maintenant »
 * et les déclencheurs de kpi_definitions, kpi_cibles, kpi_mesures, kpi_revues, kpi_actions figent ces
 * colonnes ou les historiques en ajout seul) ; les dates métier (mesures, revues, échéances,
 * dates d'effet) sont, elles, étalées sur 2024-2026.
 */

const MISSIONS: readonly SpecMissionKpi[] = [
  { ...MISSION_SICAFE, revues: REVUES_SICAFE, actions: ACTIONS_SICAFE },
  { ...MISSION_SAHEL, revues: REVUES_SAHEL, actions: ACTIONS_SAHEL },
  { ...MISSION_ATLANTIQUE, revues: REVUES_ATLANTIQUE, actions: ACTIONS_ATLANTIQUE },
  { ...MISSION_BAOBAB, revues: REVUES_BAOBAB, actions: ACTIONS_BAOBAB },
  { ...MISSION_BANQUE, revues: REVUES_BANQUE, actions: ACTIONS_BANQUE },
  { ...MISSION_EXPORT, revues: REVUES_EXPORT, actions: ACTIONS_EXPORT },
];

/** Réglages du cabinet : délai de grâce de 7 jours, dégradation sur 3 périodes, valeurs validées. */
async function reglerParametres(ctx: ContexteTenantDemo): Promise<void> {
  if (await existe(ctx, "SELECT 1 FROM kpi_parametres WHERE cabinet_id = $1", [ctx.cabinetId])) {
    return;
  }
  const r = await ctx.session("associe").patch("/api/kpi/parametres", {
    rappels_actifs: true,
    delai_grace_jours: 7,
    periodes_degradation: 3,
    valeurs_validees: true,
  });
  exiger(r, 200, "Paramètres KPI du cabinet");
}

interface MissionSemee {
  spec: SpecMissionKpi;
  mission: MissionTrouvee;
  fenetre: FenetreKpi;
  acteurs: ActeursMission;
  ids: ReadonlyMap<string, string>;
}

/** Définitions, cibles, contributeurs et mesures mensuelles d'une mission. */
async function semerMesures(ctx: ContexteTenantDemo, spec: SpecMissionKpi): Promise<MissionSemee> {
  const mission = await trouverMission(ctx, spec.mission);
  const fenetre = fenetreMission(mission, ctx.aujourdhui);
  verifierSpecDansFenetre(spec, fenetre, ctx.aujourdhui);
  const acteurs = await acteursMission(ctx, mission.id);
  const portail = await comptesPortail(ctx, mission.clientId);
  const semes = await synchroniserDefinitions(ctx, mission, spec, acteurs, portail, fenetre);
  const mois = fenetre.mois;
  const series = genererSeries(
    ctx.alea.deriver("kpi").deriver(spec.mission.intitule),
    mois,
    semes.map((s) => s.spec),
  );
  let ecrites = 0;
  for (const s of semes) {
    ecrites += await synchroniserMesures({
      ctx,
      kpiId: s.id,
      spec: s.spec,
      indice: s.indice,
      acteurs,
      portail,
      mois,
      valeurs: series.get(s.spec.cle) ?? [],
      dateFin: fenetre.dateFinMission,
    });
  }
  ctx.journal(
    `    kpi : ${mission.intitule} — ${semes.length} KPI, ${mois.length} mois (${fenetre.debut} à ${fenetre.fin}), ${ecrites} lignes de mesure ajoutées`,
  );
  return { spec, mission, fenetre, acteurs, ids: new Map(semes.map((s) => [s.spec.cle, s.id])) };
}

/** Arbre, actions hors revue et revues de la mission (après le suivi : les actions citent des alertes). */
async function semerPilotage(ctx: ContexteTenantDemo, m: MissionSemee): Promise<void> {
  const { spec, mission, acteurs, ids } = m;
  if (spec.arbre) await semerArbre(ctx, mission, acteurs, spec.arbre, ids);
  for (const [rang, a] of spec.actions.entries()) {
    await semerAction(ctx, mission, acteurs, a, rang, ids, null);
  }
  for (const r of spec.revues) await semerRevue(ctx, mission, acteurs, r, ids);
}

/**
 * Suivi quotidien (kpi/suivi.ts) rejoué à des dates fictives, mission par mission et dans sa
 * fenêtre : le 8 de chaque mois (délai de grâce passé) à partir du mois qui suit la mesure de
 * référence, puis la fin de la mission (terminée) ou « aujourd'hui » (en cours : détecte les
 * retards du dernier mois). Chaque passage détecte les alertes (seuil, variation, dégradation,
 * retard) telles qu'on les aurait vues ce jour-là, et les rappels dus. Aucun envoi : ni canal
 * WhatsApp ni courriel ne sont transmis, seules les notifications internes sont écrites. Une
 * mission sans mesure (non démarrée) n'a aucun passage. Rejouable : une alerte ou un rappel existe
 * une fois par (KPI, code, période).
 */
async function suivreAuFilDuTemps(ctx: ContexteTenantDemo, m: MissionSemee): Promise<void> {
  const kpiIds = [...m.ids.values()];
  for (const date of datesDeSuivi(m.fenetre, ctx.aujourdhui)) {
    await ctx.database.withTenant(ctx.cabinetId, (db) =>
      suivreKpis(db, ctx.cabinetId, date, { kpiIds }),
    );
  }
}

export async function semerKpi(ctx: ContexteTenantDemo): Promise<void> {
  await reglerParametres(ctx);
  const semees: MissionSemee[] = [];
  for (const spec of MISSIONS) semees.push(await semerMesures(ctx, spec));
  // Seulement les KPI de cette étape : ceux que les plans créent plus tard (objectifs) n'ont pas
  // de mesures et ne doivent pas produire d'alertes de retard à chaque rejeu.
  for (const m of semees) await suivreAuFilDuTemps(ctx, m);
  for (const m of semees) await semerPilotage(ctx, m);
}
