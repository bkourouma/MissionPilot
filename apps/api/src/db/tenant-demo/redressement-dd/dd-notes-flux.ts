import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import { attendre } from "./commun.js";
import type { Contenu } from "./dd-notes-donnees.js";
import {
  dateNote,
  dateRapportNote,
  dateValidationNote,
  dateVersionNote,
} from "./dd-notes-outils.js";
import { ecrire } from "./dd-outils.js";

/*
 * Gestes d'une note au comité par les VRAIES routes (`/api/dd/dossiers/:id/notes`,
 * `/api/dd/notes/:id/versions|soumission|validation|rapports`), chacun daté après coup :
 *
 * - `creer` : brouillon version 1 (consultant) ;
 * - `reviser` : nouveau brouillon (la dernière version lue est exigée) ;
 * - `soumettre` : le serveur FIGE la base depuis les moteurs et crée la version soumise suivante
 *   (refus 409 NOTE_BLOQUEE tant qu'un contrôle bloquant subsiste) ;
 * - `decider` : validation ou rejet motivé par un compte `dd.valider` qui n'est NI le créateur NI
 *   l'auteur d'une version de la note (séparation des tâches, MPZ26) ;
 * - `rapport` : rapport Word de la note validée (le PDF exige Chromium).
 */

/** Crée la note (brouillon version 1) et date la note et sa version 1. */
export async function creer(
  ctx: ContexteTenantDemo,
  par: SessionDemo,
  dossierId: string,
  titre: string,
  c: Contenu,
  jour: string,
): Promise<string> {
  const n = await ecrire<{ id: string }>(
    par,
    `/api/dd/dossiers/${dossierId}/notes`,
    { titre, recommandation: c.recommandation, synthese: c.synthese, conditions: c.conditions },
    `note « ${titre} »`,
  );
  await dateNote(ctx, n.id, jour);
  await dateVersionNote(ctx, n.id, 1, jour);
  return n.id;
}

/** Nouveau brouillon (version courante → suivante) ; renvoie le numéro de la version créée. */
export async function reviser(
  ctx: ContexteTenantDemo,
  par: SessionDemo,
  noteId: string,
  versionCourante: number,
  c: Contenu,
  motif: string,
  jour: string,
): Promise<number> {
  const r = await ecrire<{ version: number }>(
    par,
    `/api/dd/notes/${noteId}/versions`,
    {
      version_courante: versionCourante,
      motif,
      recommandation: c.recommandation,
      synthese: c.synthese,
      conditions: c.conditions,
    },
    `version de la note ${noteId}`,
  );
  await dateVersionNote(ctx, noteId, r.version, jour);
  return r.version;
}

/** Soumet la version brouillon `version` ; renvoie le numéro de la version soumise. */
export async function soumettre(
  ctx: ContexteTenantDemo,
  par: SessionDemo,
  noteId: string,
  version: number,
  jour: string,
): Promise<number> {
  const r = await ecrire<{ version: number }>(
    par,
    `/api/dd/notes/${noteId}/soumission`,
    { version },
    `soumission de la note ${noteId}`,
  );
  await dateVersionNote(ctx, noteId, r.version, jour);
  return r.version;
}

/** Valide ou rejette la version soumise `version`. */
export async function decider(
  ctx: ContexteTenantDemo,
  par: SessionDemo,
  noteId: string,
  version: number,
  decision: "valide" | "rejete",
  motif: string | null,
  jour: string,
): Promise<void> {
  const r = await par.post(`/api/dd/notes/${noteId}/validation`, {
    version,
    decision,
    ...(motif === null ? {} : { motif }),
  });
  attendre(201, r, `${decision} de la note ${noteId} v${version}`);
  await dateValidationNote(ctx, noteId, version, jour);
}

export interface RapportCree {
  rapportId: string;
  variante: "executive" | "detaillee";
}

/** Rapports Word des deux variantes de la version validée ; datés au jour donné. */
export async function rapports(
  ctx: ContexteTenantDemo,
  par: SessionDemo,
  noteId: string,
  version: number,
  jour: string,
): Promise<RapportCree[]> {
  const crees: RapportCree[] = [];
  for (const variante of ["executive", "detaillee"] as const) {
    const r = await ecrire<{ rapport: { id: string } }>(
      par,
      `/api/dd/notes/${noteId}/rapports?format=docx&variante=${variante}&version=${version}`,
      {},
      `rapport ${variante} de la note ${noteId}`,
    );
    await dateRapportNote(ctx, r.rapport.id, jour);
    crees.push({ rapportId: r.rapport.id, variante });
  }
  return crees;
}
