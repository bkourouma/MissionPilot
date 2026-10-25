import { pdfDemo } from "../../seed-demo-portail.js";
import { MOT_DE_PASSE_DEMO_TENANT } from "../constantes.js";
import { attendre } from "../contexte.js";
import type { CleCompte } from "../cles.js";
import { corps, televerserCanaux, type ContexteCanaux } from "./canaux-contexte.js";
import {
  activer2fa,
  assurerSignataires2fa,
  codeSuivant,
  ouvrirSession2fa,
} from "./canaux-signataires.js";
import { MARQUE_CANAUX } from "./donnees-canaux-contacts.js";
import { directeurDe, existe, missionDuCasting, sql, type CleMissionCasting } from "./outils.js";

/*
 * Signatures électroniques LOCALES (fournisseur `local`, niveau « simple simulée », AUCUNE valeur
 * juridique) de lettres de mission fictives en PDF : une SIGNÉE par toutes les parties (journal de
 * preuves chaîné vérifié), une envoyée EN ATTENTE, une REFUSÉE. Tout passe par les vraies routes ;
 * la signature exige la reconfirmation d'identité avec second facteur (voir canaux-signataires.ts).
 * Dates : « maintenant » (les routes écrivent l'instant réel, la chaîne de preuves ne s'antidate pas).
 */

type Issue = "signee" | "en_attente" | "refusee";

interface DemandeDemo {
  mission: CleMissionCasting;
  client: string;
  issue: Issue;
}

const DEMANDES: readonly DemandeDemo[] = [
  { mission: "planSicafe", client: "SICAFÉ", issue: "signee" },
  { mission: "notationBanqueSahel", client: "Banque du Sahel", issue: "en_attente" },
  { mission: "redressementGabon", client: "Gabon Offshore Services", issue: "refusee" },
];

const nomDocument = (d: DemandeDemo) => `Lettre de mission — ${d.client} (${MARQUE_CANAUX})`;

/** Partage de la mission avec son client (exigé pour l'envoi) en conservant les partages existants. */
async function partagerMission(cc: ContexteCanaux, missionId: string, clientId: string) {
  const url = `/api/portail/partages?client_id=${clientId}`;
  const actuel = corps<{
    missions: { mission_id: string; jalons: boolean; factures: boolean }[];
    documents: { document_id: string }[];
  }>(200, await cc.appel("associe", "GET", url), "partages du client");
  if (actuel.missions.some((m) => m.mission_id === missionId)) return;
  corps(
    200,
    await cc.appel("associe", "PUT", url, {
      missions: [
        ...actuel.missions.map((m) => ({
          mission_id: m.mission_id,
          jalons: m.jalons,
          factures: m.factures,
        })),
        { mission_id: missionId, jalons: false, factures: false },
      ],
      documents: actuel.documents.map((d) => d.document_id),
    }),
    "partage de la mission avec le client",
  );
}

async function documentLettre(cc: ContexteCanaux, d: DemandeDemo, missionId: string) {
  const directeur = await directeurDe(cc.ctx, missionId);
  const nom = nomDocument(d);
  const deja = await sql<{ id: string }>(
    cc.ctx,
    "SELECT id FROM mission_documents WHERE cabinet_id = $1 AND mission_id = $2 AND nom = $3",
    [cc.ctx.cabinetId, missionId, nom],
  );
  if (deja[0]) return deja[0].id;
  const fichierId = await televerserCanaux(
    cc,
    directeur,
    "/api/fichiers",
    `lettre-de-mission-${d.mission}-demonstration.pdf`,
    pdfDemo(`Lettre de mission - ${d.client} (${MARQUE_CANAUX})`, [
      "Document fictif genere pour la recette locale de MissionPilot.",
      "Signature electronique SIMULEE : aucune valeur juridique, aucun fournisseur reel.",
    ]),
    "application/pdf",
  );
  return corps<{ id: string }>(
    201,
    await cc.appel(directeur, "POST", `/api/missions/${missionId}/documents`, {
      type: "lettre_de_mission",
      nom,
      fichier_id: fichierId,
    }),
    `document ${nom}`,
  ).id;
}

interface Preuves {
  verification: { valide: boolean };
  preuves: unknown[];
}

export async function semerSignatures(cc: ContexteCanaux, clientSicafeId: string): Promise<void> {
  const comptes2fa = await assurerSignataires2fa(cc, clientSicafeId);
  for (const d of DEMANDES) {
    const mission = await missionDuCasting(cc.ctx, d.mission);
    const nom = nomDocument(d);
    const deja = await existe(
      cc.ctx,
      `SELECT 1 FROM signatures_demandes s JOIN mission_documents md ON md.id = s.document_id
       WHERE s.mission_id = $1 AND md.nom = $2`,
      [mission.id, nom],
    );
    let demandeId: string;
    if (deja) {
      demandeId = (
        await sql<{ id: string }>(
          cc.ctx,
          `SELECT s.id FROM signatures_demandes s JOIN mission_documents md ON md.id = s.document_id
           WHERE s.mission_id = $1 AND md.nom = $2`,
          [mission.id, nom],
        )
      )[0]?.id as string;
    } else {
      await partagerMission(cc, mission.id, mission.clientId);
      const documentId = await documentLettre(cc, d, mission.id);
      const directeur = await directeurDe(cc.ctx, mission.id);
      const cabinetSignataire: [string, "cabinet"] = [
        d.issue === "signee"
          ? comptes2fa.cabinet.utilisateurId
          : (cc.ctx.utilisateurs["associe.2"] as string),
        "cabinet",
      ];
      const signataires = [
        { utilisateur_id: cabinetSignataire[0], partie: cabinetSignataire[1] },
        ...(d.issue === "signee"
          ? [{ utilisateur_id: comptes2fa.client.utilisateurId, partie: "client" as const }]
          : d.issue === "en_attente"
            ? [
                {
                  utilisateur_id: cc.ctx.utilisateurs["dirigeant.client.2"] as string,
                  partie: "client" as const,
                },
              ]
            : []),
      ];
      demandeId = corps<{ id: string }>(
        201,
        await cc.appel(directeur, "POST", `/api/missions/${mission.id}/signatures`, {
          document_id: documentId,
          objet: "lettre_mission",
          ordre: "parallele",
          expire_jours: 30,
          signataires,
        }),
        `demande de signature ${d.client}`,
      ).id;
      corps(
        200,
        await cc.appel(directeur, "POST", `/api/signatures/${demandeId}/envoyer`, {}),
        `envoi de la demande ${d.client}`,
      );
    }
    const statut = (
      await sql<{ statut: string }>(
        cc.ctx,
        "SELECT statut FROM signatures_demandes WHERE id = $1",
        [demandeId],
      )
    )[0]?.statut;
    if (d.issue === "signee" && statut !== "signee") await signerDemande(cc, demandeId, comptes2fa);
    if (d.issue === "refusee" && statut === "envoyee") {
      const assoc2: CleCompte = "associe.2";
      corps(
        200,
        await cc.appel(assoc2, "POST", `/api/signatures/${demandeId}/refuser`, {
          motif: `Clause de non-sollicitation à revoir avant signature (${MARQUE_CANAUX}).`,
        }),
        "refus de signature",
      );
    }
  }
  await verifierChaines(cc);
}

async function signerDemande(
  cc: ContexteCanaux,
  demandeId: string,
  comptes: Awaited<ReturnType<typeof assurerSignataires2fa>>,
): Promise<void> {
  // La 2FA est activée sur les deux comptes juste avant la signature (session ouverte ensuite).
  await activer2fa(cc, comptes.cabinet.utilisateurId);
  await activer2fa(cc, comptes.client.utilisateurId);
  const cookieCabinet = await ouvrirSession2fa(cc, comptes.cabinet.email);
  attendre(
    200,
    await cc.appelCookie(cookieCabinet, "GET", `/api/signatures/${demandeId}/document`),
    "lecture du document (cabinet)",
  );
  corps(
    200,
    await cc.appelCookie(cookieCabinet, "POST", `/api/signatures/${demandeId}/signer`, {
      mot_de_passe: MOT_DE_PASSE_DEMO_TENANT,
      code: await codeSuivant(comptes.cabinet.email),
    }),
    "signature du cabinet",
  );
  const cookieClient = await ouvrirSession2fa(cc, comptes.client.email);
  attendre(
    200,
    await cc.appelCookie(cookieClient, "GET", `/api/portail/signatures/${demandeId}/document`),
    "lecture du document (client)",
  );
  corps(
    200,
    await cc.appelCookie(cookieClient, "POST", `/api/portail/signatures/${demandeId}/signer`, {
      mot_de_passe: MOT_DE_PASSE_DEMO_TENANT,
      code: await codeSuivant(comptes.client.email),
    }),
    "signature du client",
  );
}

/** Vérifie par la route du dossier de preuve que chaque chaîne de preuves est intacte. */
async function verifierChaines(cc: ContexteCanaux): Promise<void> {
  const demandes = await sql<{ id: string }>(
    cc.ctx,
    "SELECT id FROM signatures_demandes WHERE cabinet_id = $1 ORDER BY cree_le",
    [cc.ctx.cabinetId],
  );
  for (const d of demandes) {
    const p = corps<Preuves>(
      200,
      await cc.appel("associe", "GET", `/api/signatures/${d.id}/preuves`),
      "dossier de preuves",
    );
    if (!p.verification.valide) throw new Error(`Chaîne de preuves ${d.id} rompue.`);
  }
}
