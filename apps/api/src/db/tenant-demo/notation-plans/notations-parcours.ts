import type { CleCompteCabinet } from "../cles.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { json } from "./notations-outils.js";
import { signerSuiviNotation, type ActeursQualite } from "./notations-qualite.js";
import { exiger, lire } from "./outils.js";

/*
 * Parcours d'une notation, version par version, par les VRAIES routes. Une version est une liste
 * ordonnée d'actions ; chaque action écrit EXACTEMENT UNE ligne (la version pour un calcul, un
 * ajustement, un événement de revue). Le nombre de lignes déjà écrites donne donc le point de
 * reprise : relancé, le parcours continue où il s'est arrêté, sans doublon.
 */

export type Action =
  | {
      t: "calcul";
      par: CleCompteCabinet;
      secteur: string | null;
      strategie: "ignorer" | "penaliser";
    }
  | { t: "ajuster"; par: CleCompteCabinet; dimension: string; delta: number; motif: string }
  | { t: "soumettre"; par: CleCompteCabinet }
  | { t: "renvoyer"; par: CleCompteCabinet; motif: string }
  | { t: "publier"; par: CleCompteCabinet; qualite: ActeursQualite };

export interface EntreesParcours {
  notationId: string;
  envoiId: string;
  grilleVersionId: string;
  /** Une liste d'actions par version, dans l'ordre (la version n est `versions[n - 1]`). */
  versions: readonly (readonly Action[])[];
  /**
   * Mission terminée : le suivi qualité de CHAQUE version est mené jusqu'à la signature dès sa
   * soumission en revue (c'est alors seulement que l'item « soumise en revue ou publiée » est
   * conforme), avant un éventuel renvoi. Sans cela, le suivi d'une version renvoyée puis
   * remplacée resterait en brouillon et bloquerait la clôture de la mission (« livrables_signes »).
   */
  qualiteTerminee?: ActeursQualite;
}

/** Lignes déjà écrites pour la version (0 : version pas encore calculée). */
async function avancement(ctx: ContexteTenantDemo, notationId: string, numero: number) {
  const r = await lire<{ n: string }>(
    ctx,
    `SELECT CASE WHEN v.id IS NULL THEN 0
            ELSE 1 + (SELECT count(*) FROM notation_ajustements a WHERE a.version_id = v.id)
                   + (SELECT count(*) FROM notation_evenements e WHERE e.version_id = v.id) END AS n
       FROM (SELECT $1::uuid AS nid, $2::int AS num) p
       LEFT JOIN notation_versions v ON v.notation_id = p.nid AND v.numero = p.num`,
    [notationId, numero],
  );
  return Number(r[0]?.n ?? 0);
}

async function executer(
  ctx: ContexteTenantDemo,
  e: EntreesParcours,
  numero: number,
  a: Action,
): Promise<void> {
  const s = ctx.session(a.par);
  const base = `/api/notations/${e.notationId}`;
  switch (a.t) {
    case "calcul": {
      const r = await s.post(`${base}/calculs`, {
        envoi_id: e.envoiId,
        grille_version_id: e.grilleVersionId,
        secteur: a.secteur,
        strategie: a.strategie,
      });
      exiger(r, 201, `calcul de la version ${numero}`);
      const v = json(r);
      ctx.journal(
        `      v${v.numero} calculée par ${a.par} : ${v.score.score} (classe ${v.score.classe})`,
      );
      return;
    }
    case "ajuster": {
      const r = await s.post(`${base}/ajustements`, {
        dimension: a.dimension,
        delta: a.delta,
        motif: a.motif,
      });
      exiger(r, 201, `ajustement « ${a.dimension} » de la version ${numero}`);
      const v = json(r);
      ctx.journal(
        `      ajustement ${a.dimension} ${a.delta} par ${a.par} : ${v.score.score} (${v.score.classe})`,
      );
      return;
    }
    case "soumettre":
      exiger(await s.post(`${base}/soumettre`), 200, `soumission de la version ${numero}`);
      ctx.journal(`      v${numero} soumise en revue par ${a.par}`);
      if (e.qualiteTerminee)
        await signerSuiviNotation(ctx, e.notationId, numero, e.qualiteTerminee);
      return;
    case "renvoyer":
      exiger(
        await s.post(`${base}/renvoyer`, { motif: a.motif }),
        200,
        `renvoi de la version ${numero}`,
      );
      ctx.journal(`      v${numero} renvoyée en brouillon par ${a.par}`);
      return;
    case "publier":
      // La publication d'une notation d'une mission à méthode exige le suivi qualité SIGNÉ.
      await signerSuiviNotation(ctx, e.notationId, numero, a.qualite);
      exiger(await s.post(`${base}/publier`), 200, `publication de la version ${numero}`);
      ctx.journal(`      v${numero} PUBLIÉE par ${a.par}`);
      return;
  }
}

/** Joue (ou reprend) toutes les versions, dans l'ordre. */
export async function jouerVersions(ctx: ContexteTenantDemo, e: EntreesParcours): Promise<void> {
  for (let i = 0; i < e.versions.length; i++) {
    const numero = i + 1;
    const actions = e.versions[i] ?? [];
    const fait = await avancement(ctx, e.notationId, numero);
    for (let k = fait; k < actions.length; k++) {
      await executer(ctx, e, numero, actions[k] as Action);
    }
  }
}
