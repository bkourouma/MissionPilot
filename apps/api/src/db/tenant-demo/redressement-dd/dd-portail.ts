import { attendre, type ContexteTenantDemo, type SessionDemo } from "../contexte.js";
import type { ContexteMboa } from "./dd-notes-mboa.js";
import { contenuComite, MOTIF_CORRECTION_COMITE } from "./dd-notes-donnees.js";
import { decider, rapports, reviser, soumettre } from "./dd-notes-flux.js";
import {
  dateInvitation,
  dateOptionPortail,
  datePublication,
  dateRetrait,
} from "./dd-notes-outils.js";
import {
  assurerInvestisseurMboa,
  publicationsVisibles,
  verifierLecture,
} from "./dd-portail-compte.js";
import { ecrire } from "./dd-outils.js";

/*
 * Portail investisseur de la due diligence Mboa Solaire. Gestes et comptes :
 *
 *   option du cabinet activée          associé seul (`dd.portail.configurer`)
 *   compte investisseur Mboa           invitation du portail par l'associé (dd-portail-compte.ts)
 *   invitation sur le dossier          directeur de la mission (`dd.portail.gerer` + `dd.lire`)
 *   rapports Word de la note validée   consultant (`mission.lire` + `dd.lire`)
 *   publication de la note validée     directeur de la mission, avec les deux rapports en pièces
 *   RETRAIT de cette publication       directeur de la mission, en janvier, quand l'équipe relève
 *                                      que la note publiée précise mal deux conditions et omet la
 *                                      couverture des sources
 *   note corrigée                      version 4 (brouillon), 5 (soumise), validée par l'expert
 *                                      métier (jamais rédacteur), nouveaux rapports
 *   REPUBLICATION                      directeur de la mission, version 5 et ses pièces
 *
 * Après chaque publication ou retrait, le compte investisseur est interrogé sur le portail : il
 * voit la publication en vigueur seulement (une publication retirée disparaît de sa liste).
 * Calendrier (décalages depuis la fin de la mission, 19/12/2025) : option et compte -9, invitation
 * et rapports -7, publication -4 ; retrait +24, correction +24 à +26, republication +27.
 */

async function publier(
  par: SessionDemo,
  noteId: string,
  version: number,
  idsRapports: string[],
  quoi: string,
): Promise<string> {
  const p = await ecrire<{ id: string }>(
    par,
    `/api/dd/notes/${noteId}/portail/publications`,
    { version, rapports: idsRapports },
    quoi,
  );
  return p.id;
}

export async function semerPortailMboa(ctx: ContexteTenantDemo, m: ContexteMboa): Promise<void> {
  const { a, jour } = m;
  const f = m.faits;

  // Option du cabinet (désactivée par défaut), puis compte et invitation.
  const option = await a.associe.post("/api/dd/portail/option", { actif: true });
  attendre(200, option, "activation du portail investisseur");
  await dateOptionPortail(ctx, jour(-9));
  const inv = await assurerInvestisseurMboa(ctx, a.associe, m.clientId, jour(-9));
  await ecrire(
    a.directeur,
    `/api/dd/dossiers/${m.dossierId}/portail/invitations`,
    { utilisateur_id: inv.utilisateurId },
    "invitation de l'investisseur",
  );
  await dateInvitation(ctx, m.dossierId, inv.utilisateurId, jour(-7));

  // Première publication : version validée, deux rapports Word en pièces.
  const r1 = await rapports(ctx, a.consultant, m.comiteNoteId, m.comiteVersion, jour(-7));
  const pub1 = await publier(
    a.directeur,
    m.comiteNoteId,
    m.comiteVersion,
    r1.map((x) => x.rapportId),
    "première publication",
  );
  await datePublication(ctx, pub1, jour(-4));
  await verifierLecture(inv.session, pub1, 2);

  // Retrait de la première publication, correction de la note, republication.
  const retrait = await a.directeur.post(`/api/dd/portail/publications/${pub1}/retrait`);
  attendre(201, retrait, "retrait de la première publication");
  await dateRetrait(ctx, pub1, jour(-2));
  if ((await publicationsVisibles(inv.session)).length !== 0) {
    throw new Error("Une publication retirée reste visible sur le portail.");
  }
  const v4 = await reviser(
    ctx,
    a.consultant,
    m.comiteNoteId,
    m.comiteVersion,
    contenuComite(f, "corrigee"),
    MOTIF_CORRECTION_COMITE,
    jour(-2),
  );
  const v5 = await soumettre(ctx, a.consultant2, m.comiteNoteId, v4, jour(-1));
  await decider(ctx, a.expert, m.comiteNoteId, v5, "valide", null, jour(0));
  const r2 = await rapports(ctx, a.consultant, m.comiteNoteId, v5, jour(0));
  const pub2 = await publier(
    a.directeur,
    m.comiteNoteId,
    v5,
    r2.map((x) => x.rapportId),
    "republication",
  );
  await datePublication(ctx, pub2, jour(1));
  await verifierLecture(inv.session, pub2, 2);
  // Les investisseurs des autres clients (SICAFÉ, Banque du Sahel) ne voient rien.
  for (const autre of [a.investisseur, a.investisseur2]) {
    if ((await publicationsVisibles(autre)).length !== 0) {
      throw new Error(
        "Un investisseur d'un autre client voit une publication de la due diligence.",
      );
    }
  }
  ctx.journal(
    "  DD Mboa : portail activé, investisseur invité, note publiée, retirée, corrigée et republiée.",
  );
}
