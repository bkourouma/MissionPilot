import { ajouterJours } from "@missionpilot/engines";
import type { CleCompte } from "../cles.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { lundiDe, type Alea } from "../horloge.js";
import { rappelFeuilles, relanceFeuilles } from "../../../temps/rappels.js";
import {
  cleDeCompte,
  MISSION_DEPASSEMENT,
  MISSIONS_EN_COURS,
  MISSIONS_TERMINEES,
  type Casting,
  type MissionLue,
} from "./casting.js";
import type { Paquet } from "./temps-plan.js";
import { demiJour, minDate, ok } from "./outils.js";

/*
 * Suivi du temps du Tenant démo : reste à faire (relevés dans le temps par le chef de mission),
 * alertes de suivi (évaluées par `evaluerAlertes` à chaque validation et chaque déclaration, donc
 * déjà posées par les routes), rappels de saisie (module `temps/rappels.ts`, notifications
 * internes, AUCUN envoi) et remise à la date des notifications produites par le circuit.
 *
 * Antédatage (SQL propriétaire littéral) : `reste_a_faire.declare_le`, `rappels_temps.envoye_le`,
 * `alertes_suivi.declenchee_le` (aucun déclencheur ; REVOKE seulement pour le rôle applicatif) et
 * `notifications.cree_le` / `lue_le` des notifications du circuit des feuilles.
 */

/* ----- Rappels de saisie ----- */

/** Rappel du vendredi pour la semaine `semaine` (lundi) : notifications internes seulement. */
export async function envoyerRappel(ctx: ContexteTenantDemo, semaine: string): Promise<number> {
  const creees = await ctx.database.withTenant(ctx.cabinetId, (db) =>
    rappelFeuilles({ db, cabinetId: ctx.cabinetId, charge: { semaine } }),
  );
  await ctx.proprietaire.query(
    `UPDATE rappels_temps SET envoye_le = $3::timestamptz
      WHERE cabinet_id = $1 AND semaine = $2 AND type = 'rappel_saisie'`,
    [ctx.cabinetId, semaine, `${minDate(ajouterJours(semaine, 4), ctx.aujourdhui)}T14:00:00Z`],
  );
  return creees.length;
}

/** Relance du lundi (envoyée le lundi suivant) aux chefs de mission pour la semaine `semaine`. */
export async function envoyerRelance(ctx: ContexteTenantDemo, semaine: string): Promise<number> {
  const creees = await ctx.database.withTenant(ctx.cabinetId, (db) =>
    relanceFeuilles({ db, cabinetId: ctx.cabinetId, charge: { semaine } }),
  );
  await ctx.proprietaire.query(
    `UPDATE rappels_temps SET envoye_le = $3::timestamptz
      WHERE cabinet_id = $1 AND semaine = $2 AND type = 'relance_chef'`,
    [ctx.cabinetId, semaine, `${minDate(ajouterJours(semaine, 7), ctx.aujourdhui)}T08:30:00Z`],
  );
  return creees.length;
}

/* ----- Reste à faire ----- */

/**
 * Relevés de reste à faire des missions en cours : le chef de mission déclare, à quatre dates
 * (il y a 8, 5, 3 et 1 semaines), le reste par tâche et par collaborateur affecté. Le reste est
 * l'estimation humaine du chef (jours alloués − jours déjà consommés, au demi-jour, avec un peu
 * d'écart) ; la mission en dépassement garde du reste sur sa phase déjà consommée.
 */
export async function declarerRestes(
  ctx: ContexteTenantDemo,
  casting: Casting,
  paquets: readonly Paquet[],
  rng: Alea,
): Promise<number> {
  const courant = lundiDe(ctx.aujourdhui);
  const releves = [8, 5, 3, 1].map((k) => ajouterJours(courant, -7 * k));
  let n = 0;
  for (const cle of MISSIONS_EN_COURS) {
    const m: MissionLue | undefined = casting.missions[cle];
    if (!m || m.statut === "cloturee" || !m.debut) continue;
    const chef =
      (m.chefId && (cleDeCompte(ctx, m.chefId) as CleCompte | undefined)) || "directeur.mission";
    const duMission = paquets.filter((q) => q.missionCle === cle);
    // Regroupement par (tâche, collaborateur) : une déclaration par couple.
    const couples = new Map<
      string,
      { tacheId: string; collaborateurId: string; alloue: number; q: Paquet[] }
    >();
    for (const q of duMission) {
      const k = `${q.tacheId}|${q.collaborateurId}`;
      const c = couples.get(k) ?? {
        tacheId: q.tacheId,
        collaborateurId: q.collaborateurId,
        alloue: 0,
        q: [],
      };
      c.alloue += q.joursAlloues;
      c.q.push(q);
      couples.set(k, c);
    }
    for (const [index, semaine] of releves.entries()) {
      if (ajouterJours(m.debut, 7) > semaine || couples.size === 0) continue;
      const dejaFait = await ctx.proprietaire.query(
        "SELECT 1 FROM reste_a_faire WHERE cabinet_id = $1 AND mission_id = $2 AND semaine = $3 LIMIT 1",
        [ctx.cabinetId, m.id, semaine],
      );
      if ((dejaFait.rowCount ?? 0) > 0) continue;
      const finSemaine = ajouterJours(semaine, 4);
      const lignes = [...couples.values()].map((c) => {
        const consomme =
          c.q
            .flatMap((q) => q.lignes)
            .filter((l) => l.date <= finSemaine)
            .reduce((s, l) => s + l.unites, 0) / 2;
        let reste = demiJour(Math.max(0, c.alloue - consomme) * (0.9 + 0.2 * rng.suivant()));
        if (cle === MISSION_DEPASSEMENT && index >= 2 && consomme >= c.alloue) {
          reste = rng.choisir([0.5, 1, 1.5]);
        }
        return { tache_id: c.tacheId, collaborateur_id: c.collaborateurId, jours: reste };
      });
      ok(
        201,
        await ctx.session(chef).post(`/api/missions/${m.id}/reste-a-faire`, { semaine, lignes }),
        `reste à faire ${cle} ${semaine}`,
      );
      await ctx.proprietaire.query(
        `UPDATE reste_a_faire SET declare_le = $3::timestamptz
          WHERE cabinet_id = $1 AND mission_id = $2 AND semaine = $4`,
        [ctx.cabinetId, m.id, `${ajouterJours(semaine, 4)}T${rng.entier(15, 18)}:20:00Z`, semaine],
      );
      n++;
    }
  }
  return n;
}

/**
 * Relevé FINAL des missions terminées (encore « à clôturer » : la route refuse une mission clôturée) :
 * le chef de mission déclare un reste à faire NUL, pour chaque couple (tâche, collaborateur) qui a
 * travaillé, la semaine de la fin de mission. L'avancement physique (livrables au reste déclaré nul)
 * atteint alors 100 % et le « reste à faire » n'est plus estimé à partir du budget non consommé.
 * Les alertes de consommation (≥ seuil) d'une mission close sont ensuite levées à sa fin : elles
 * n'ont plus d'objet (les dépassements d'atterrissage, eux, restent actifs). Reprise : un relevé
 * déjà posé cette semaine-là n'est pas refait.
 */
export async function declarerRestesFinaux(
  ctx: ContexteTenantDemo,
  casting: Casting,
  paquets: readonly Paquet[],
  rng: Alea,
): Promise<number> {
  let n = 0;
  for (const cle of MISSIONS_TERMINEES) {
    const m: MissionLue | undefined = casting.missions[cle];
    if (!m || !m.debut || !m.fin) continue;
    const semaine = lundiDe(m.fin);
    const chef =
      (m.chefId && (cleDeCompte(ctx, m.chefId) as CleCompte | undefined)) || "directeur.mission";
    const couples = new Map<
      string,
      { tache_id: string; collaborateur_id: string; jours: number }
    >();
    for (const q of paquets.filter((p) => p.missionCle === cle)) {
      couples.set(`${q.tacheId}|${q.collaborateurId}`, {
        tache_id: q.tacheId,
        collaborateur_id: q.collaborateurId,
        jours: 0,
      });
    }
    const dejaFait = await ctx.proprietaire.query(
      "SELECT 1 FROM reste_a_faire WHERE cabinet_id = $1 AND mission_id = $2 AND semaine = $3 LIMIT 1",
      [ctx.cabinetId, m.id, semaine],
    );
    if (m.statut !== "cloturee" && couples.size > 0 && (dejaFait.rowCount ?? 0) === 0) {
      ok(
        201,
        await ctx
          .session(chef)
          .post(`/api/missions/${m.id}/reste-a-faire`, { semaine, lignes: [...couples.values()] }),
        `reste à faire final ${cle} ${semaine}`,
      );
      await ctx.proprietaire.query(
        `UPDATE reste_a_faire SET declare_le = $3::timestamptz
          WHERE cabinet_id = $1 AND mission_id = $2 AND semaine = $4`,
        [ctx.cabinetId, m.id, `${m.fin}T${rng.entier(15, 18)}:20:00Z`, semaine],
      );
      n++;
    }
    await ctx.proprietaire.query(
      `UPDATE alertes_suivi SET active = false, levee_le = $3::timestamptz
        WHERE cabinet_id = $1 AND mission_id = $2 AND type = 'consommation_seuil' AND active`,
      [ctx.cabinetId, m.id, `${ajouterJours(m.fin, 1)}T09:00:00Z`],
    );
  }
  return n;
}

/* ----- Alertes de suivi ----- */

/** Date de déclenchement plausible des alertes posées par ce run (récentes, avant la fin de mission). */
export async function antedaterAlertes(
  ctx: ContexteTenantDemo,
  casting: Casting,
  depuis: string,
  rng: Alea,
): Promise<number> {
  const missions = new Map(Object.values(casting.missions).map((m) => [m.id, m]));
  const r = await ctx.proprietaire.query(
    "SELECT id, mission_id FROM alertes_suivi WHERE cabinet_id = $1 AND declenchee_le >= $2::timestamptz",
    [ctx.cabinetId, depuis],
  );
  for (const a of r.rows) {
    const m = missions.get(a.mission_id as string);
    const terminee = !!m && MISSIONS_TERMINEES.includes(m.cle);
    let jour = terminee && m?.fin ? m.fin : ctx.aujourdhui;
    jour = ajouterJours(
      minDate(jour, ctx.aujourdhui),
      -(terminee ? rng.entier(5, 40) : rng.entier(2, 25)),
    );
    if (m?.debut && jour < m.debut) jour = ajouterJours(m.debut, 14);
    await ctx.proprietaire.query(
      "UPDATE alertes_suivi SET declenchee_le = $2::timestamptz WHERE id = $1",
      [a.id, `${jour}T09:${String(rng.entier(10, 50))}:00Z`],
    );
    // Alerte levée par une route pendant ce semis (levée « maintenant ») : remise à la date métier,
    // un à quatre jours après son déclenchement, sans dépasser la fin de mission.
    let levee = ajouterJours(jour, rng.entier(1, 4));
    if (terminee && m?.fin && levee > m.fin) levee = m.fin;
    await ctx.proprietaire.query(
      "UPDATE alertes_suivi SET levee_le = $2::timestamptz WHERE id = $1 AND levee_le >= $3::timestamptz",
      [a.id, `${levee}T09:30:00Z`, depuis],
    );
  }
  return r.rowCount ?? 0;
}

/* ----- Notifications du circuit ----- */

const SEMAINE = "[Ss]emaine du (\\d{4}-\\d{2}-\\d{2})";

/**
 * Les notifications créées par les routes de feuilles datent d'aujourd'hui : on les remonte à la
 * semaine qu'elles citent et on les marque lues, sauf celles de moins de deux semaines.
 */
export async function remettreNotificationsALHeure(
  ctx: ContexteTenantDemo,
  casting: Casting,
  depuis: string,
): Promise<void> {
  const q = (sql: string, p: unknown[]) => ctx.proprietaire.query(sql, p);
  const base = [ctx.cabinetId, depuis];
  await q(
    `UPDATE notifications SET cree_le = ((substring(corps from '${SEMAINE}')::date + 4)::text || 'T16:30:00Z')::timestamptz
      WHERE cabinet_id = $1 AND cree_le >= $2::timestamptz AND type = 'feuille_temps_soumise'
        AND corps ~ '${SEMAINE}'`,
    base,
  );
  await q(
    `UPDATE notifications SET cree_le = ((substring(corps from '${SEMAINE}')::date + 8)::text || 'T10:00:00Z')::timestamptz
      WHERE cabinet_id = $1 AND cree_le >= $2::timestamptz AND type IN ('feuille_temps_validee', 'feuille_temps_rejetee')
        AND corps ~ '${SEMAINE}'`,
    base,
  );
  await q(
    `UPDATE notifications SET cree_le = ((substring(corps from '${SEMAINE}')::date + 4)::text || 'T14:00:00Z')::timestamptz
      WHERE cabinet_id = $1 AND cree_le >= $2::timestamptz AND type = 'rappel_feuille_temps'
        AND corps ~ '${SEMAINE}'`,
    base,
  );
  await q(
    `UPDATE notifications SET cree_le = ((substring(corps from '${SEMAINE}')::date + 7)::text || 'T08:30:00Z')::timestamptz
      WHERE cabinet_id = $1 AND cree_le >= $2::timestamptz AND type = 'relance_feuilles_temps'
        AND corps ~ '${SEMAINE}'`,
    base,
  );
  // Lues : tout ce qui date de plus de deux semaines (les récentes restent à lire).
  await q(
    `UPDATE notifications SET lue_le = cree_le + interval '2 days'
      WHERE cabinet_id = $1 AND lue_le IS NULL AND cree_le < $2::timestamptz
        AND type IN ('feuille_temps_soumise', 'feuille_temps_validee', 'feuille_temps_rejetee',
                     'rappel_feuille_temps', 'relance_feuilles_temps')`,
    [ctx.cabinetId, `${ajouterJours(ctx.aujourdhui, -14)}T00:00:00Z`],
  );
  // Alertes de suivi des missions terminées : datées de leur fin de mission, déjà lues.
  const terminees = Object.values(casting.missions)
    .filter((m) => MISSIONS_TERMINEES.includes(m.cle))
    .map((m) => m.id);
  await q(
    `UPDATE notifications n SET cree_le = ((m.date_fin - 8)::text || 'T09:30:00Z')::timestamptz,
            lue_le = ((m.date_fin - 7)::text || 'T10:00:00Z')::timestamptz
       FROM missions m
      WHERE n.cabinet_id = $1 AND n.type = 'alerte_suivi_budget' AND n.cree_le >= $2::timestamptz
        AND m.id = ANY($3::uuid[]) AND n.titre = 'Alerte de suivi : ' || m.intitule`,
    [ctx.cabinetId, depuis, terminees],
  );
}
