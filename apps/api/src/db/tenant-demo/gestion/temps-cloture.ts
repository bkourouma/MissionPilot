import { ajouterJours } from "@missionpilot/engines";
import type { CleCompte } from "../cles.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { lundiDe, type Alea } from "../horloge.js";
import { MISSIONS_TERMINEES, type Casting, type CleMission } from "./casting.js";
import {
  MOTIF_REJET_CORRECTION,
  MOTIFS_CORRECTION_AJOUT,
  MOTIFS_CORRECTION_RETRAIT,
} from "./donnees-temps.js";
import type { FeuillePlan, Paquet } from "./temps-plan.js";
import { ok } from "./outils.js";

/*
 * Clôture mensuelle des périodes de temps et corrections tracées (TPS-09), par les vraies routes
 * (`/api/temps/periodes/:mois/cloturer`, `/api/temps/corrections`).
 *
 * Antédatage : `periodes_temps.cloturee_le` (aucun déclencheur). NE PEUT PAS être antidaté :
 * `corrections_temps.demandee_le` et `decidee_le` (déclencheur « correction figée » : toute
 * colonne d'identité, dont la date de demande, est immuable, et une correction décidée l'est
 * entièrement).
 */

/** Dernier mois clôturé : août 2026 inclus (brief du lot 2b). */
export const DERNIER_MOIS_CLOTURE = "2026-08";

/** Mois `AAAA-MM` de `debut` à `fin` inclus. */
export function moisEntre(debut: string, fin: string): string[] {
  const mois: string[] = [];
  let [a, m] = [Number(debut.slice(0, 4)), Number(debut.slice(5, 7))];
  while (`${a}-${String(m).padStart(2, "0")}` <= fin) {
    mois.push(`${a}-${String(m).padStart(2, "0")}`);
    if (++m > 12) [a, m] = [a + 1, 1];
  }
  return mois;
}

/** Clôture, dans l'ordre, tous les mois de `premier` à `DERNIER_MOIS_CLOTURE`. Renvoie le nombre clôturé ici. */
export async function cloturerPeriodes(
  ctx: ContexteTenantDemo,
  premier: string,
  rng: Alea,
): Promise<number> {
  let n = 0;
  const gestion = ctx.session("gestionnaire");
  for (const mois of moisEntre(premier, DERNIER_MOIS_CLOTURE)) {
    const annee = await gestion.get(`/api/temps/periodes?annee=${mois.slice(0, 4)}`);
    ok(200, annee, `périodes ${mois.slice(0, 4)}`);
    const element = (
      annee.json() as { elements: { mois: string; statut: string }[] }
    ).elements.find((e) => e.mois === mois);
    if (element?.statut === "cloturee") continue;
    const cloturant: CleCompte =
      ctx.sessions["gestionnaire.2"] && rng.proba(0.2) ? "gestionnaire.2" : "gestionnaire";
    ok(
      200,
      await ctx.session(cloturant).post(`/api/temps/periodes/${mois}/cloturer`),
      `clôture ${mois}`,
    );
    const suivant = ajouterJours(`${mois}-28`, 6).slice(0, 7);
    const quand = `${suivant}-${String(rng.entier(3, 9)).padStart(2, "0")}T${rng.entier(9, 17)}:15:00Z`;
    await ctx.proprietaire.query(
      "UPDATE periodes_temps SET cloturee_le = $3::timestamptz WHERE cabinet_id = $1 AND mois = $2",
      [ctx.cabinetId, mois, quand],
    );
    n++;
  }
  return n;
}

/* ----- Corrections ----- */

type Issue = "valider" | "rejeter" | "attente";

interface Creneau {
  mission: CleMission;
  demandeur: "auteur" | CleCompte;
  decideur: CleCompte;
  issue: Issue;
}

/** Six corrections : quatre validées, une rejetée, une en attente. */
const CRENEAUX: readonly Creneau[] = [
  { mission: "sicafe-plan", demandeur: "auteur", decideur: "gestionnaire", issue: "valider" },
  { mission: "mboa-dd", demandeur: "chef.mission.2", decideur: "associe", issue: "valider" },
  { mission: "atlantique-bp", demandeur: "auteur", decideur: "gestionnaire.2", issue: "valider" },
  {
    mission: "baobab-plan",
    demandeur: "directeur.mission.2",
    decideur: "gestionnaire",
    issue: "valider",
  },
  {
    mission: "gabon-redressement",
    demandeur: "auteur",
    decideur: "gestionnaire",
    issue: "rejeter",
  },
  { mission: "baobab-plan", demandeur: "auteur", decideur: "gestionnaire.2", issue: "attente" },
];

/**
 * Corrige quelques cases dans des périodes clôturées : la demande part du collaborateur lui-même
 * ou de son chef/directeur de mission, la décision d'un gestionnaire ou d'un associé distinct.
 * Direction choisie pour rapprocher l'affectation de ses jours alloués (±0,5 jour).
 */
export async function semerCorrections(
  ctx: ContexteTenantDemo,
  casting: Casting,
  plans: readonly FeuillePlan[],
  paquets: readonly Paquet[],
  rng: Alea,
): Promise<number> {
  const existantes = await ctx.proprietaire.query(
    "SELECT count(*)::int AS n FROM corrections_temps WHERE cabinet_id = $1",
    [ctx.cabinetId],
  );
  if ((existantes.rows[0]?.n as number) > 0) {
    ctx.journal("temps : corrections déjà présentes, étape sautée.");
    return 0;
  }
  const limite = `${DERNIER_MOIS_CLOTURE}-31`;
  const parSemaine = new Map(plans.map((p) => [`${p.collaborateurId}|${p.semaine}`, p]));
  const prises = new Set<string>();
  const personnes = new Set<string>();
  let faites = 0;
  for (const creneau of CRENEAUX) {
    const mission = casting.missions[creneau.mission];
    if (!mission || mission.statut === "cloturee") continue;
    const gros = MISSIONS_TERMINEES.includes(creneau.mission) ? 20 : 4;
    const chercher = (seuil: number, autrePersonne: boolean) =>
      paquets
        .filter((q) => q.missionCle === creneau.mission && q.joursAlloues >= seuil)
        .filter((q) => !autrePersonne || !personnes.has(q.collaborateurId))
        .flatMap((q) =>
          q.lignes
            .filter((l) => l.date <= limite && l.unites >= 1)
            .filter((l) => parSemaine.has(`${q.collaborateurId}|${lundiDe(l.date)}`))
            .filter((l) => !prises.has(`${q.collaborateurId}|${l.date}|${q.tacheId}`))
            .map((l) => ({ q, l })),
        );
    // Gros volumes et personne encore jamais corrigée d'abord ; on relâche si rien ne convient.
    const candidats =
      [chercher(gros, true), chercher(gros, false), chercher(4, false)].find((x) => x.length > 0) ??
      [];
    if (candidats.length === 0) {
      ctx.journal(`temps : aucune case corrigeable pour « ${creneau.mission} ».`);
      continue;
    }
    const { q, l } = rng.choisir(candidats);
    personnes.add(q.collaborateurId);
    prises.add(`${q.collaborateurId}|${l.date}|${q.tacheId}`);
    const ratio = q.lignes.reduce((s, x) => s + x.unites, 0) / (q.joursAlloues * 2);
    const hausse = ratio < 0.985 ? true : ratio > 1.015 ? false : rng.proba(0.5);
    const nouvelle = (hausse ? l.unites + 1 : Math.max(0, l.unites - 1)) / 2;
    const demandeur: CleCompte = creneau.demandeur === "auteur" ? q.cle : creneau.demandeur;
    if (!ctx.sessions[demandeur] || demandeur === creneau.decideur) continue;
    const r = await ctx.session(demandeur).post("/api/temps/corrections", {
      collaborateur_id: q.collaborateurId,
      date: l.date,
      tache_id: q.tacheId,
      jours: nouvelle,
      motif: rng.choisir(
        nouvelle * 2 > l.unites ? MOTIFS_CORRECTION_AJOUT : MOTIFS_CORRECTION_RETRAIT,
      ),
    });
    if (r.statusCode !== 201) {
      ctx.journal(
        `temps : correction ${creneau.mission} refusée (HTTP ${r.statusCode} ${r.body}).`,
      );
      continue;
    }
    const id = (r.json() as { id: string }).id;
    if (creneau.issue === "valider") {
      ok(
        200,
        await ctx.session(creneau.decideur).post(`/api/temps/corrections/${id}/valider`),
        "validation correction",
      );
    } else if (creneau.issue === "rejeter") {
      ok(
        200,
        await ctx
          .session(creneau.decideur)
          .post(`/api/temps/corrections/${id}/rejeter`, { motif: MOTIF_REJET_CORRECTION }),
        "rejet correction",
      );
    }
    faites++;
  }
  return faites;
}

/**
 * Antidate les horodatages de VALIDATION des feuilles (`validee_le`, `verrouillee_le`, `cree_le`,
 * `modifie_le`), que les routes posent « maintenant » et qu'un déclencheur fige ensuite. Sans cela
 * la dernière date d'activité d'une mission terminée serait celle de l'exécution du seed, et sa
 * clôture fictive serait repoussée à la veille d'aujourd'hui. Une seule requête littérale, sous le
 * rôle `replica` le temps de la transaction (comme `appliquerSql` du lot 4), qui ne touche que des
 * dates : la décision de validation (`feuille_validations.decide_le`, déjà datée) fait foi, la date
 * de verrouillage est celle de la clôture mensuelle de la période. Idempotente.
 */
export async function antedaterFeuilles(ctx: ContexteTenantDemo): Promise<number> {
  const c = ctx.proprietaire;
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL session_replication_role = replica");
    const r = await c.query(
      `UPDATE feuilles_temps f SET
         cree_le = least(f.cree_le,
                         coalesce(f.premiere_soumission_le, f.soumise_le, f.cree_le) - interval '2 hours'),
         validee_le = CASE WHEN f.validee_le IS NULL THEN NULL
                           ELSE coalesce(
                             (SELECT max(v.decide_le) FROM feuille_validations v
                               WHERE v.feuille_id = f.id AND v.decision = 'validee'), f.validee_le) END,
         verrouillee_le = CASE WHEN f.verrouillee_le IS NULL THEN NULL
                               ELSE greatest(
                                 coalesce(
                                   (SELECT p.cloturee_le FROM periodes_temps p
                                     WHERE p.cabinet_id = f.cabinet_id
                                       AND p.mois = to_char(f.semaine + 4, 'YYYY-MM')),
                                   f.verrouillee_le),
                                 coalesce(
                                   (SELECT max(v.decide_le) FROM feuille_validations v
                                     WHERE v.feuille_id = f.id AND v.decision = 'validee'),
                                   f.validee_le)) END
       WHERE f.cabinet_id = $1 AND f.statut IN ('validee', 'verrouillee', 'soumise')`,
      [ctx.cabinetId],
    );
    await c.query(
      `UPDATE feuilles_temps f SET
         modifie_le = greatest(f.cree_le, coalesce(f.verrouillee_le, f.validee_le, f.soumise_le, f.cree_le))
       WHERE f.cabinet_id = $1 AND f.statut IN ('validee', 'verrouillee', 'soumise')`,
      [ctx.cabinetId],
    );
    await c.query("COMMIT");
    return r.rowCount ?? 0;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}
