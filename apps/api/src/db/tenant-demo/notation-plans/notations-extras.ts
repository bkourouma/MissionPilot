import type { CleCompteCabinet } from "../cles.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { json } from "./notations-outils.js";
import { exiger, lire } from "./outils.js";

/*
 * Compléments d'une notation : plans d'action enregistrés (NOT-17), commentaire IA de
 * l'explication (NOT-12, brouillon puis, au choix, modifié par un humain : jamais validé d'office)
 * et lectures qui ne s'écrivent pas (constats, indice de confiance, explication avec simulateur
 * de passage de classe, données du rapport). Tous les chiffres viennent des moteurs ; le
 * commentaire est celui du gabarit déterministe (aucune clé IA en démonstration).
 */

export interface PlanAction {
  version: number;
  par: CleCompteCabinet;
  capacite: number;
  secteur?: string;
}

export interface CommentaireIa {
  version: number;
  par: CleCompteCabinet;
  /** Précision ajoutée par l'humain : le contenu passe de « brouillon IA » à « modifié ». */
  precision?: string;
}

/** Enregistre un plan priorisé par (notation, version) s'il n'y en a pas encore. */
export async function assurerPlans(
  ctx: ContexteTenantDemo,
  notationId: string,
  plans: readonly PlanAction[],
): Promise<void> {
  for (const p of plans) {
    const deja = await lire(
      ctx,
      `SELECT 1 FROM notation_plans_action pa JOIN notation_versions v ON v.id = pa.version_id
        WHERE pa.notation_id = $1 AND v.numero = $2`,
      [notationId, p.version],
    );
    if (deja.length > 0) continue;
    const s = ctx.session(p.par);
    const url = `/api/notations/${notationId}/plan-action/proposition?version=${p.version}&capacite=${p.capacite}`;
    exiger(
      await s.get(url + (p.secteur ? `&secteur=${p.secteur}` : "")),
      200,
      "proposition de plan",
    );
    const r = await s.post(`/api/notations/${notationId}/plans-action`, {
      version: p.version,
      capacite: p.capacite,
      ...(p.secteur ? { secteur: p.secteur } : {}),
    });
    exiger(r, 201, `plan d'action de la version ${p.version}`);
    ctx.journal(`      plan d'action v${p.version} enregistré (capacité ${p.capacite})`);
  }
}

/** Génère le commentaire IA (gabarit) de la version, puis le retouche si une précision est donnée. */
export async function assurerCommentaires(
  ctx: ContexteTenantDemo,
  notationId: string,
  commentaires: readonly CommentaireIa[],
): Promise<void> {
  for (const c of commentaires) {
    const s = ctx.session(c.par);
    const url = `/api/notations/${notationId}/explication/commentaire`;
    let vue = json(await s.get(`${url}?version=${c.version}`));
    if (!vue.commentaire) {
      const r = await s.post(url, { version: c.version });
      exiger(r, 201, `commentaire IA de la version ${c.version}`);
      vue = json(r);
      ctx.journal(`      commentaire IA v${c.version} : ${vue.statut_contenu}`);
    }
    if (c.precision && vue.statut_contenu === "brouillon_ia") {
      const r = await s.post(`/api/ia/generations/${vue.commentaire.id}/modifier`, {
        texte: `${vue.commentaire.texte}\n\n${c.precision}`,
      });
      exiger(r, 200, `retouche du commentaire IA de la version ${c.version}`);
      ctx.journal(`      commentaire IA v${c.version} retouché par ${c.par} : modifié`);
    }
  }
}

/** Lectures de contrôle (200 attendu) : constats, confiance, explication et simulateur, rapport. */
export async function verifierLectures(
  ctx: ContexteTenantDemo,
  notationId: string,
  par: CleCompteCabinet,
  versions: readonly number[],
): Promise<void> {
  const s = ctx.session(par);
  for (const v of versions) {
    for (const route of ["constats", "confiance", "explication", "rapport"]) {
      exiger(
        await s.get(`/api/notations/${notationId}/${route}?version=${v}`),
        200,
        `lecture ${route}`,
      );
    }
  }
}
