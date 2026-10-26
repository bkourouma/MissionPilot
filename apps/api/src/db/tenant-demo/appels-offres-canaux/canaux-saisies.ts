import type { CleCompte } from "../cles.js";
import { corps, executerTaches, type ContexteCanaux } from "./canaux-contexte.js";
import type { Destinataires } from "./canaux-comptes.js";
import { CONTACTS_CANAUX, ENTRANTS_CANAUX, type EntrantCanal } from "./donnees-canaux-contacts.js";
import { sql } from "./outils.js";

/*
 * Messages ENTRANTS simulés : saisies de KPI par messagerie, puis retrait de consentement (STOP).
 * Chaque message passe par la route du simulateur (`POST /api/canaux/simulateur/entrant`, réservée
 * au contexte local avec fournisseur simulé) qui fabrique un événement SIGNÉ et le soumet au vrai
 * webhook : analyse déterministe du texte, vraisemblance, proposition de saisie (jamais une
 * mesure), réponse du service mise en file. Seule la reprise par le cabinet écrit la mesure.
 * Dates : l'instant du message est « maintenant » (le webhook refuse un horodatage hors fenêtre).
 */

const numeroDe = (cle: CleCompte): string => {
  const c = CONTACTS_CANAUX.find((x) => x.cle === cle);
  if (!c) throw new Error(`Aucun numéro pour « ${cle} ».`);
  return c.numero;
};

async function envoyerMessage(cc: ContexteCanaux, de: CleCompte, texte: string): Promise<void> {
  corps(
    200,
    await cc.appel("associe", "POST", "/api/canaux/simulateur/entrant", {
      type: "message",
      numero: numeroDe(de),
      texte,
    }),
    `message entrant de ${de}`,
  );
  await executerTaches(cc);
}

interface SaisieLue {
  id: string;
  statut: string;
  vraisemblance: string;
  valeur: string;
}

async function saisieDe(
  cc: ContexteCanaux,
  destinataireId: string,
  valeur: string,
): Promise<SaisieLue | undefined> {
  const r = await sql<SaisieLue>(
    cc.ctx,
    `SELECT id, statut, vraisemblance, valeur::text AS valeur FROM canaux_saisies_kpi
     WHERE cabinet_id = $1 AND destinataire_id = $2 AND valeur = $3::numeric
     ORDER BY cree_le DESC LIMIT 1`,
    [cc.ctx.cabinetId, destinataireId, valeur],
  );
  return r[0];
}

async function traiterEntrant(cc: ContexteCanaux, dests: Destinataires, e: EntrantCanal) {
  const destinataireId = dests.get(e.de) as string;
  const valeur = e.texte.trim().split(/\s+/).pop() as string;
  let saisie = await saisieDe(cc, destinataireId, valeur);
  if (!saisie) {
    await envoyerMessage(cc, e.de, e.texte);
    saisie = await saisieDe(cc, destinataireId, valeur);
  }
  if (!saisie) throw new Error(`Message « ${e.texte} » non analysé (KPI non reconnu).`);
  if (!e.suite) return;
  // Confirmation par la personne : « OUI » (« OUI <valeur> » pour une valeur à vérifier).
  if (saisie.statut === "a_confirmer") {
    await envoyerMessage(
      cc,
      e.de,
      saisie.vraisemblance === "a_verifier" ? `OUI ${saisie.valeur}` : "OUI",
    );
    saisie = (await saisieDe(cc, destinataireId, valeur)) as SaisieLue;
  }
  if (saisie.statut !== "confirmee") return; // déjà reprise ou rejetée
  if (e.suite === "reprendre") {
    corps(
      200,
      await cc.appel("associe", "POST", `/api/canaux/saisies-kpi/${saisie.id}/reprendre`, {
        ...(e.dateMesure ? { date_mesure: e.dateMesure } : {}),
      }),
      `reprise de la saisie ${e.texte}`,
    );
  } else if (e.suite === "rejeter") {
    corps(
      200,
      await cc.appel("associe", "POST", `/api/canaux/saisies-kpi/${saisie.id}/rejeter`, {
        motif: e.motif,
      }),
      `rejet de la saisie ${e.texte}`,
    );
  }
}

/** Saisies de KPI par messagerie : reprises, rejetée, refusée d'office, en attente. */
export async function semerSaisiesKpi(cc: ContexteCanaux, dests: Destinataires): Promise<void> {
  for (const e of ENTRANTS_CANAUX) await traiterEntrant(cc, dests, e);
  await executerTaches(cc);
}

/** STOP d'un destinataire : le consentement est retiré (source `message_stop`), accusé de service. */
export async function semerStop(
  cc: ContexteCanaux,
  dests: Destinataires,
  de: CleCompte,
): Promise<void> {
  const id = dests.get(de) as string;
  const etat = await sql<{ statut: string }>(
    cc.ctx,
    "SELECT statut FROM canaux_consentements WHERE destinataire_id = $1 ORDER BY id DESC LIMIT 1",
    [id],
  );
  if (etat[0]?.statut !== "accorde") return;
  await envoyerMessage(cc, de, "STOP");
}
