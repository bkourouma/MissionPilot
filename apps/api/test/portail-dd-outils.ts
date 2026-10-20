/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Api } from "./api.js";
import { attendu, dossierPret, preparerDd, type ScenarioDd } from "./dd-outils.js";
import type { Contexte } from "./helpers.js";
import { inviterClient, type UtilisateurPortail } from "./portail-outils.js";

/*
 * Outils des tests du portail investisseur de la due diligence (migration 0509) : scénario DD à
 * deux cabinets (dd-outils.ts) complété de comptes du portail (investisseurs du client du dossier,
 * dirigeant du même client, investisseur d'un autre client, investisseur du cabinet B) et de notes
 * VALIDÉES avec leurs rapports Word (le PDF exige Chromium).
 */

export interface ScenarioPortailDd {
  s: ScenarioDd;
  /** Investisseur du client des dossiers (invité dans les tests). */
  investisseur: UtilisateurPortail;
  /** Second investisseur du même client, jamais invité sur le dossier principal. */
  investisseur2: UtilisateurPortail;
  dirigeant: UtilisateurPortail;
  investisseurAutreClient: UtilisateurPortail;
  investisseurB: UtilisateurPortail;
}

export async function preparerPortailDd(ctx: Contexte, nom: string): Promise<ScenarioPortailDd> {
  const s = await preparerDd(ctx, nom);
  return {
    s,
    investisseur: await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_investisseur"]),
    investisseur2: await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_investisseur"]),
    dirigeant: await inviterClient(ctx, s.a.associe, s.a.clientId, ["client_dirigeant"]),
    investisseurAutreClient: await inviterClient(ctx, s.a.associe, s.autreClientId, [
      "client_investisseur",
    ]),
    investisseurB: await inviterClient(ctx, s.b.associe, s.b.clientId, ["client_investisseur"]),
  };
}

export interface NoteValidee {
  missionId: string;
  dossierId: string;
  noteId: string;
  /** Version soumise et validée. */
  version: number;
}

/** Dossier prêt, note créée, soumise (version 2) ; validée par l'expert métier si `valider`. */
export async function noteSoumise(
  s: ScenarioDd,
  options: { valider?: boolean; synthese?: string } = {},
): Promise<NoteValidee> {
  const { missionId, dossierId } = await dossierPret(s);
  const n = attendu(
    201,
    await s.consultantEquipe.post(`/api/dd/dossiers/${dossierId}/notes`, {
      titre: "Note au comité — cible",
      recommandation: "favorable_sous_conditions",
      synthese: options.synthese ?? "Le dossier est solide sous réserve des conditions.",
      conditions: ["Audit fiscal préalable", "Garantie de passif"],
    }),
  );
  const version = attendu(
    201,
    await s.consultantEquipe.post(`/api/dd/notes/${n.id}/soumission`, { version: 1 }),
  ).version as number;
  if (options.valider !== false) {
    attendu(
      201,
      await s.expertMetier.post(`/api/dd/notes/${n.id}/validation`, {
        version,
        decision: "valide",
      }),
    );
  }
  return { missionId, dossierId, noteId: n.id as string, version };
}

/** Rapport Word d'une note validée ; renvoie l'identifiant du rapport et celui de son fichier. */
export async function rapportNote(
  par: Api,
  noteId: string,
  variante: "executive" | "detaillee",
): Promise<{ rapportId: string; fichierId: string }> {
  const r = attendu(
    201,
    await par.post(`/api/dd/notes/${noteId}/rapports?format=docx&variante=${variante}`),
  );
  return { rapportId: r.rapport.id as string, fichierId: r.fichier.id as string };
}

export const urlEtat = (dossierId: string) => `/api/dd/dossiers/${dossierId}/portail`;
export const urlInvitations = (dossierId: string) =>
  `/api/dd/dossiers/${dossierId}/portail/invitations`;
export const urlPublier = (noteId: string) => `/api/dd/notes/${noteId}/portail/publications`;
export const urlListePortail = "/api/portail/due-diligence/publications";
export const urlPublicationPortail = (id: string) =>
  `/api/portail/due-diligence/publications/${id}`;
export const urlPiecePortail = (id: string, pieceId: string) =>
  `/api/portail/due-diligence/publications/${id}/pieces/${pieceId}/fichier`;

export async function changerOption(associe: Api, actif: boolean): Promise<any> {
  return attendu(200, await associe.post("/api/dd/portail/option", { actif }));
}

export async function inviter(par: Api, dossierId: string, utilisateurId: string): Promise<any> {
  return attendu(201, await par.post(urlInvitations(dossierId), { utilisateur_id: utilisateurId }));
}
