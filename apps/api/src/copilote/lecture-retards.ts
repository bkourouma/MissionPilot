import { aPermission } from "@missionpilot/shared";
import {
  ajouterJours,
  capacite,
  composerMissionsEnRetard,
  composerRetardFeuilles,
  LIMITE_ELEMENTS_COPILOTE,
  lundiDeLaSemaine,
  MESSAGE_ACCES_REFUSE,
  SEMAINES_RETARD_FEUILLES_COPILOTE,
} from "@missionpilot/engines";
import { filtreVisibilite } from "../missions/acces.js";
import { chargerCalendrier } from "../missions/outils.js";
import { absencesValidees } from "../planification/charge.js";
import type { ContexteOutil, ResultatOutil } from "./lecture.js";

/*
 * OUTILS DE LECTURE « RETARDS » DU COPILOTE (AGT-08) : mes missions en retard, et les retards de
 * feuilles de temps de l'équipe. Comme les autres lectures (lecture.ts) : mêmes requêtes que les
 * écrans, `Auth` de l'utilisateur, transaction `withTenant` reçue (RLS), visibilité de mission,
 * faits seulement (dates, nombres, noms) mis en phrases par les gabarits du moteur, au plus
 * LIMITE_ELEMENTS_COPILOTE éléments. Aucun taux, coût ni montant (FIN-02).
 */

const STATUTS_ACTIFS = "('signee', 'en_cours', 'a_cloturer')";
/** Collaborateurs lus au plus pour les retards de feuilles (le total est alors un minimum). */
export const COLLABORATEURS_RETARD_MAX = 200;
const SOUMISE = new Set(["soumise", "validee", "verrouillee"]);

/* ----- Mes missions en retard ----- */

/**
 * Missions dont l'utilisateur est directeur, chef ou membre (jamais « toutes »), non clôturées,
 * qui ont au moins un jalon non atteint à la date prévue dépassée (définition du brief,
 * brief/derives.ts), ou dont la date de fin prévue est dépassée (signée ou en cours seulement :
 * une mission « à clôturer » est déjà en fin de course).
 */
export async function missionsEnRetard(c: ContexteOutil): Promise<ResultatOutil> {
  const r = await c.db.query(
    `SELECT m.id, m.intitule, m.date_fin::text AS date_fin,
       count(j.id) FILTER (WHERE NOT j.atteint AND j.date_prevue < $3::date)::int AS jalons,
       min(j.date_prevue) FILTER (WHERE NOT j.atteint AND j.date_prevue < $3::date)::text AS ancien,
       (m.date_fin < $3::date AND m.statut IN ('signee', 'en_cours')) AS fin_depassee,
       count(*) OVER ()::int AS total
     FROM missions m LEFT JOIN mission_jalons j ON j.mission_id = m.id
     WHERE m.statut IN ${STATUTS_ACTIFS} AND ${filtreVisibilite(1, 2)}
     GROUP BY m.id
     HAVING count(j.id) FILTER (WHERE NOT j.atteint AND j.date_prevue < $3::date) > 0
        OR (m.date_fin < $3::date AND m.statut IN ('signee', 'en_cours'))
     ORDER BY coalesce(min(j.date_prevue) FILTER (WHERE NOT j.atteint AND j.date_prevue < $3::date),
                       m.date_fin), m.id
     LIMIT $4`,
    [false, c.auth.utilisateurId, c.aujourdhui, LIMITE_ELEMENTS_COPILOTE],
  );
  return {
    statut: "ok",
    ...composerMissionsEnRetard({
      total: (r.rows[0]?.total as number | undefined) ?? 0,
      tronque: false,
      missions: r.rows.map((m) => ({
        intitule: m.intitule as string,
        jalons_en_retard: m.jalons as number,
        jalon_plus_ancien: (m.ancien as string | null) ?? null,
        fin_depassee: m.fin_depassee ? (m.date_fin as string) : null,
        lien: `/missions/${m.id as string}`,
      })),
    }),
  };
}

/* ----- Retards sur les feuilles de temps de l'équipe ----- */

interface Collaborateur {
  id: string;
  nom: string;
  depuis: string;
}

/**
 * Périmètre de la discipline de saisie (routes/discipline-temps.ts) : tout le cabinet avec
 * `indicateurs.cabinet` ou `mission.lire_toutes` ; sinon, avec `temps.valider`, les collaborateurs
 * affectés aux missions dont l'utilisateur est chef ou directeur (et lui-même).
 */
async function collaborateursDuPerimetre(
  c: ContexteOutil,
  tout: boolean,
): Promise<Collaborateur[]> {
  const r = await c.db.query(
    `SELECT col.id, col.nom, (col.cree_le AT TIME ZONE 'UTC')::date::text AS depuis
     FROM collaborateurs col JOIN utilisateurs u ON u.id = col.utilisateur_id
     WHERE col.actif AND u.actif
       AND ($1::boolean OR col.utilisateur_id = $2
            OR EXISTS (SELECT 1 FROM affectations a JOIN missions m ON m.id = a.mission_id
                       WHERE a.collaborateur_id = col.id
                         AND (m.chef_id = $2 OR m.directeur_id = $2)))
     ORDER BY lower(col.nom), col.id LIMIT $3`,
    [tout, c.auth.utilisateurId, COLLABORATEURS_RETARD_MAX + 1],
  );
  return r.rows.map((l) => ({
    id: l.id as string,
    nom: l.nom as string,
    depuis: l.depuis as string,
  }));
}

/** Lundis des dernières semaines ENTIÈREMENT écoulées, de la plus ancienne à la plus récente. */
export function semainesEcoulees(aujourdhui: string, nombre: number): string[] {
  const derniere = lundiDeLaSemaine(ajouterJours(aujourdhui, -7));
  return Array.from({ length: nombre }, (_, i) => ajouterJours(derniere, -7 * (nombre - 1 - i)));
}

export async function retardFeuillesTemps(c: ContexteOutil): Promise<ResultatOutil> {
  const { db, auth } = c;
  const tout =
    aPermission(auth.roles, "indicateurs.cabinet") ||
    aPermission(auth.roles, "mission.lire_toutes");
  if (!tout && !aPermission(auth.roles, "temps.valider")) {
    return { statut: "refuse", texte: MESSAGE_ACCES_REFUSE, elements: [] };
  }
  const lus = await collaborateursDuPerimetre(c, tout);
  const collaborateurs = lus.slice(0, COLLABORATEURS_RETARD_MAX);
  const semaines = semainesEcoulees(c.aujourdhui, SEMAINES_RETARD_FEUILLES_COPILOTE);
  const ids = collaborateurs.map((x) => x.id);
  const f = await db.query(
    `SELECT collaborateur_id, semaine::text AS semaine, statut, origine FROM feuilles_temps
     WHERE collaborateur_id = ANY ($1::uuid[]) AND semaine = ANY ($2::date[])`,
    [ids, semaines],
  );
  const parCle = new Map(
    f.rows.map((l) => [`${l.collaborateur_id as string}|${l.semaine as string}`, l]),
  );
  const periode = { debut: semaines[0] as string, fin: ajouterJours(semaines.at(-1) as string, 6) };
  const absences = await absencesValidees(db, ids, periode);
  const calendrier = await chargerCalendrier(db, auth.cabinetId);
  const enRetard = collaborateurs
    .map((x) => {
      const manquantes = semaines.filter((s) => {
        if (s < lundiDeLaSemaine(x.depuis)) return false;
        const feuille = parCle.get(`${x.id}|${s}`);
        if (feuille?.origine === "import") return false;
        if (feuille && SOUMISE.has(feuille.statut as string)) return false;
        // Semaine sans capacité (absence validée sur tous les jours ouvrés) : pas un retard.
        return (
          capacite({ debut: s, fin: ajouterJours(s, 6) }, calendrier, absences.get(x.id), 100) > 0
        );
      });
      return { nom: x.nom, semaines: manquantes.length, plus_ancienne: manquantes[0] ?? "" };
    })
    .filter((x) => x.semaines > 0)
    .sort((a, b) => b.semaines - a.semaines || a.nom.localeCompare(b.nom, "fr"));
  return {
    statut: "ok",
    ...composerRetardFeuilles({
      total: enRetard.length,
      tronque: lus.length > COLLABORATEURS_RETARD_MAX,
      semaines_examinees: semaines.length,
      collaborateurs: enRetard.map((x) => ({ ...x, lien: "/temps/validation" })),
    }),
  };
}
