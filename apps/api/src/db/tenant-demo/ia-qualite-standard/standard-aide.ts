import { attendre, type ContexteTenantDemo } from "../contexte.js";
import type { CleCompte } from "../cles.js";

/*
 * Utilitaires du module « standard » : lectures (SQL propriétaire, SELECT paramétrés) pour retrouver
 * un objet par sa clé naturelle, et petits assistants de pilotage des routes du référentiel.
 */

export interface Ajouts {
  /** Étapes à ajouter au brouillon (ignorées si le code existe déjà). */
  etapes?: { code: string; libelle: string; description?: string }[];
  briques?: DefBrique[];
  elements?: DefElement[];
  regles?: unknown[];
}

export interface DefBrique {
  /** Code de l'étape d'accueil, ou `apres` : code d'une brique dont on reprend l'étape. */
  etape?: string;
  apres?: string;
  code: string;
  libelle: string;
  objet: string;
  classe: "R0" | "R1" | "R2" | "R3";
  autonomie: "N0" | "N1" | "N2" | "N3" | "N4";
  active: boolean;
  moteur?: string;
  agent?: string;
  garde?: string;
  sortie?: string;
  termine?: string;
  jours?: number;
  profil?: string;
}

export interface DefElement {
  type: "livrable" | "item" | "kpi_type" | "initiative_type" | "risque_type" | "gabarit";
  code: string;
  libelle: string;
  description?: string;
  brique?: string;
  essentiel?: boolean;
}

export interface MethodeBase {
  id: string;
  /** Dernière version publiée, s'il y en a une. */
  publiee: string | null;
  /** Brouillon en cours, s'il y en a un. */
  brouillon: string | null;
}

/** Méthode du cabinet (propre ou variante) retrouvée par son code, avec ses versions. */
export async function methodeCabinet(
  ctx: ContexteTenantDemo,
  code: string,
): Promise<MethodeBase | null> {
  const m = await ctx.proprietaire.query<{ id: string }>(
    "SELECT id FROM methodes WHERE cabinet_id = $1 AND code = $2",
    [ctx.cabinetId, code],
  );
  return m.rows[0] ? versionsDe(ctx, m.rows[0].id) : null;
}

/** Méthode du standard MissionPilot (cabinet_id NULL) retrouvée par son code. */
export async function methodeStandard(ctx: ContexteTenantDemo, code: string): Promise<MethodeBase> {
  const m = await ctx.proprietaire.query<{ id: string }>(
    "SELECT id FROM methodes WHERE cabinet_id IS NULL AND code = $1",
    [code],
  );
  if (!m.rows[0]) throw new Error(`Méthode du standard « ${code} » introuvable (socle).`);
  return versionsDe(ctx, m.rows[0].id);
}

async function versionsDe(ctx: ContexteTenantDemo, methodeId: string): Promise<MethodeBase> {
  const v = await ctx.proprietaire.query<{ id: string; statut: string }>(
    "SELECT id, statut FROM methode_versions WHERE methode_id = $1 ORDER BY version DESC",
    [methodeId],
  );
  return {
    id: methodeId,
    publiee: v.rows.find((x) => x.statut === "publiee")?.id ?? null,
    brouillon: v.rows.find((x) => x.statut === "brouillon")?.id ?? null,
  };
}

/** Identifiant de la version publiée portant `numero` pour la méthode du cabinet `code`. */
export async function versionPubliee(
  ctx: ContexteTenantDemo,
  code: string,
  numero: number,
): Promise<string> {
  const r = await ctx.proprietaire.query<{ id: string }>(
    `SELECT v.id FROM methode_versions v JOIN methodes m ON m.id = v.methode_id
      WHERE m.cabinet_id = $1 AND m.code = $2 AND v.version = $3 AND v.statut = 'publiee'`,
    [ctx.cabinetId, code, numero],
  );
  if (!r.rows[0]) throw new Error(`Version ${numero} publiée de « ${code} » introuvable.`);
  return r.rows[0].id;
}

interface VersionLue {
  etapes: { id: string; code: string }[];
  briques: { id: string; code: string; etape_id: string }[];
  elements: { code: string }[];
  regles: { code: string }[];
}

/** Ajoute au brouillon ce qui manque (par code) : rejouable sans doublon. */
export async function peuplerBrouillon(
  ctx: ContexteTenantDemo,
  cle: CleCompte,
  versionId: string,
  ajouts: Ajouts,
): Promise<void> {
  const s = ctx.session(cle);
  const lire = async (): Promise<VersionLue> => {
    const r = await s.get(`/api/methodes/versions/${versionId}`);
    attendre(200, r, `lecture version ${versionId}`);
    return r.json() as VersionLue;
  };
  let v = await lire();
  for (const e of ajouts.etapes ?? []) {
    if (v.etapes.some((x) => x.code === e.code)) continue;
    attendre(201, await s.post(`/api/methodes/versions/${versionId}/etapes`, e), `étape ${e.code}`);
  }
  v = await lire();
  for (const b of ajouts.briques ?? []) {
    if (v.briques.some((x) => x.code === b.code)) continue;
    const etapeId = b.apres
      ? v.briques.find((x) => x.code === b.apres)?.etape_id
      : v.etapes.find((x) => x.code === b.etape)?.id;
    if (!etapeId) throw new Error(`Étape introuvable pour la brique ${b.code}.`);
    const corps = {
      etape_id: etapeId,
      code: b.code,
      libelle: b.libelle,
      objet: b.objet,
      classe_risque: b.classe,
      niveau_autonomie_max: b.autonomie,
      active_par_defaut: b.active,
      moteur: b.moteur ?? null,
      agent: b.agent ?? null,
      garde: b.garde ?? null,
      sortie: b.sortie ?? null,
      definition_termine: b.termine ?? null,
      temps_type_jours: b.jours ?? null,
      profil_temps: b.profil ?? null,
    };
    attendre(
      201,
      await s.post(`/api/methodes/versions/${versionId}/briques`, corps),
      `brique ${b.code}`,
    );
  }
  v = await lire();
  for (const e of ajouts.elements ?? []) {
    if (v.elements.some((x) => x.code === e.code)) continue;
    const briqueId = e.brique ? v.briques.find((x) => x.code === e.brique)?.id : null;
    if (e.brique && !briqueId) throw new Error(`Brique ${e.brique} introuvable pour ${e.code}.`);
    const corps = {
      type: e.type,
      code: e.code,
      libelle: e.libelle,
      description: e.description ?? null,
      brique_id: briqueId ?? null,
      essentiel: e.essentiel ?? false,
      actif_par_defaut: true,
    };
    attendre(
      201,
      await s.post(`/api/methodes/versions/${versionId}/elements`, corps),
      `élément ${e.code}`,
    );
  }
  for (const regle of ajouts.regles ?? []) {
    const code = (regle as { code: string }).code;
    if (v.regles.some((x) => x.code === code)) continue;
    attendre(
      201,
      await s.post(`/api/methodes/versions/${versionId}/regles`, regle),
      `règle ${code}`,
    );
  }
}

/** Publie le brouillon par `cle` (le message du serveur remonte si la version est incohérente). */
export async function publier(
  ctx: ContexteTenantDemo,
  cle: CleCompte,
  versionId: string,
): Promise<void> {
  attendre(
    200,
    await ctx.session(cle).post(`/api/methodes/versions/${versionId}/publication`, {}),
    `publication ${versionId}`,
  );
}
