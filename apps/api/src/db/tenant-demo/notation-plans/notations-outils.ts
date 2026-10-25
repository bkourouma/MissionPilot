import type { CleCompteCabinet } from "../cles.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { exiger, existe, lire } from "./outils.js";

/*
 * Outils de l'étape « notations » : équipe de mission, liaison à la méthode du cabinet,
 * identifiants de grille et d'envoi, lecture JSON des réponses. Aucune écriture ici hors routes
 * (équipe de mission : POST /api/missions/:id/equipe ; méthode : PUT /api/missions/:id/methode).
 */

/** Corps JSON d'une réponse déjà contrôlée (forme libre : la route fait foi). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const json = <T = Record<string, any>>(r: { json(): unknown }): T => r.json() as T;

/** Ajoute à l'équipe de la mission, par la route, les comptes qui n'en sont pas déjà membres. */
export async function assurerEquipe(
  ctx: ContexteTenantDemo,
  missionId: string,
  par: CleCompteCabinet,
  membres: readonly CleCompteCabinet[],
): Promise<void> {
  for (const cle of membres) {
    const utilisateur = ctx.utilisateurs[cle];
    if (!utilisateur) throw new Error(`Utilisateur « ${cle} » introuvable dans le contexte.`);
    const deja = await existe(
      ctx,
      `SELECT 1 FROM missions m WHERE m.id = $1 AND (m.directeur_id = $2 OR m.chef_id = $2)
       UNION ALL SELECT 1 FROM mission_equipe WHERE mission_id = $1 AND utilisateur_id = $2`,
      [missionId, utilisateur],
    );
    if (deja) continue;
    const r = await ctx.session(par).post(`/api/missions/${missionId}/equipe`, {
      utilisateur_id: utilisateur,
    });
    exiger(r, 201, `équipe de la mission : ajout de ${cle}`);
  }
}

/** Lie la mission à la dernière version publiée de la méthode « notation_entreprise » (une fois). */
export async function lierMethodeNotation(
  ctx: ContexteTenantDemo,
  missionId: string,
  par: CleCompteCabinet,
  contexte: Record<string, unknown>,
  motif: string,
): Promise<void> {
  if (await existe(ctx, "SELECT 1 FROM mission_methodes WHERE mission_id = $1", [missionId])) {
    return;
  }
  const v = await lire<{ id: string }>(
    ctx,
    `SELECT v.id FROM methode_versions v JOIN methodes m ON m.id = v.methode_id
      WHERE m.cabinet_id IS NULL AND m.code = 'notation_entreprise' AND v.statut = 'publiee'
      ORDER BY v.version DESC LIMIT 1`,
  );
  if (!v[0]) throw new Error("Méthode « notation_entreprise » publiée introuvable.");
  const r = await ctx.session(par).put(`/api/missions/${missionId}/methode`, {
    version_id: v[0].id,
    contexte,
    motif,
  });
  exiger(r, 200, "liaison de la mission à la méthode de notation");
}

/** Dernière version VALIDÉE de la grille de notation de ce code. */
export async function versionGrilleValidee(ctx: ContexteTenantDemo, code: string): Promise<string> {
  const r = await lire<{ id: string }>(
    ctx,
    `SELECT v.id FROM notation_grille_versions v JOIN notation_grilles g ON g.id = v.grille_id
      WHERE g.cabinet_id = $1 AND g.code = $2 AND v.statut = 'valide'
      ORDER BY v.version DESC LIMIT 1`,
    [ctx.cabinetId, code],
  );
  if (!r[0])
    throw new Error(`Grille « ${code} » sans version validée : étape « notation-referentiels » ?`);
  return r[0].id;
}

/** Envoi CLOS du modèle « notation_generique » de la mission (étape « questionnaires »). */
export async function envoiNotationClos(
  ctx: ContexteTenantDemo,
  missionId: string,
): Promise<string> {
  const r = await lire<{ id: string }>(
    ctx,
    `SELECT e.id FROM questionnaire_envois e
       JOIN questionnaire_versions v ON v.id = e.version_id
       JOIN questionnaire_modeles m ON m.id = v.modele_id
      WHERE e.mission_id = $1 AND m.code = 'notation_generique' AND e.statut = 'clos'
      ORDER BY v.version DESC LIMIT 1`,
    [missionId],
  );
  if (!r[0])
    throw new Error("Envoi clos « notation_generique » introuvable : étape « questionnaires » ?");
  return r[0].id;
}
