import { fabriquerConteneurAudioSimule } from "../../../canaux/transcripteur-simule.js";
import { corps, executerTaches, televerserCanaux, type ContexteCanaux } from "./canaux-contexte.js";
import { MARQUE_CANAUX } from "./donnees-canaux-contacts.js";
import { chefDe, directeurDe, missionDuCasting, sql, type CleMissionCasting } from "./outils.js";

/*
 * Transcriptions de réunions (audio de TEST synthétique : aucune voix, aucun fournisseur réel),
 * sur des missions en cours. La transcription automatique est un BROUILLON à relire (version 1) ;
 * une relecture humaine ajoute une version ; la validation exige un autre utilisateur que le
 * dernier modificateur (MPH07) : le chef de mission crée et corrige, le directeur valide ou rejette.
 * Le consentement d'enregistrement est déclaré ET référencé. Dates : « maintenant » (les routes
 * et le déclencheur d'identité de la table ne permettent pas d'antidater).
 */

type EtatVoulu = "validee" | "rejetee" | "relue" | "brouillon";

interface ReunionDemo {
  mission: CleMissionCasting;
  fichier: string;
  reference: string;
  dureeMs: number;
  etat: EtatVoulu;
  brut: string;
  /** Texte relu (versions humaines). */
  relu?: string;
  motifRejet?: string;
}

const REUNIONS: readonly ReunionDemo[] = [
  {
    mission: "planBaobab",
    fichier: "comite-pilotage-baobab-demonstration.ogg",
    reference: `${MARQUE_CANAUX} : accord écrit fictif des participants, référence DEMO-ENR-0201`,
    dureeMs: 5200,
    etat: "validee",
    brut:
      `${MARQUE_CANAUX} - texte fictif produit par le transcripteur simulé. Le comité de pilotage ` +
      "valide les trois axes du plan stratégique. La direction financière doit chiffrer les " +
      "investissements avant la fin du mois. Les agences régionales seront consultées en novembre.",
    relu:
      `${MARQUE_CANAUX} - Le comité de pilotage valide les trois axes du plan stratégique. La ` +
      "direction financière chiffre les investissements avant la fin du mois ; les agences " +
      "régionales sont consultées en novembre. Compte rendu relu par le chef de mission.",
  },
  {
    mission: "redressementGabon",
    fichier: "point-tresorerie-gabon-demonstration.ogg",
    reference: `${MARQUE_CANAUX} : accord écrit fictif des participants, référence DEMO-ENR-0202`,
    dureeMs: 4600,
    etat: "rejetee",
    brut:
      `${MARQUE_CANAUX} - texte fictif produit par le transcripteur simulé. Le point de trésorerie ` +
      "porte sur le plan de remboursement des fournisseurs. Plusieurs passages sont inaudibles.",
    motifRejet: "Enregistrement de mauvaise qualité : réunion à refaire et à transcrire à nouveau.",
  },
  {
    mission: "flashTeranga",
    fichier: "entretien-direction-teranga-demonstration.ogg",
    reference: `${MARQUE_CANAUX} : accord écrit fictif des participants, référence DEMO-ENR-0203`,
    dureeMs: 3900,
    etat: "relue",
    brut:
      `${MARQUE_CANAUX} - texte fictif produit par le transcripteur simulé. Le directeur ` +
      "d'exploitation décrit trois goulots d'étranglement sur la chaîne de livraison du port.",
    relu:
      `${MARQUE_CANAUX} - Le directeur d'exploitation décrit trois goulots d'étranglement sur la ` +
      "chaîne de livraison, du port aux entrepôts. Relecture en cours par le chef de mission.",
  },
  {
    mission: "notationBanqueSahel",
    fichier: "revue-portefeuille-sahel-demonstration.ogg",
    reference: `${MARQUE_CANAUX} : accord écrit fictif des participants, référence DEMO-ENR-0204`,
    dureeMs: 4100,
    etat: "brouillon",
    brut:
      `${MARQUE_CANAUX} - texte fictif produit par le transcripteur simulé. La revue du portefeuille ` +
      "de prêts aux PME relève une concentration sur deux secteurs et des retards de remboursement.",
  },
];

interface LigneT {
  id: string;
  statut: string;
  version: number;
}

async function etatTranscription(cc: ContexteCanaux, missionId: string, ref: string) {
  const r = await sql<LigneT>(
    cc.ctx,
    `SELECT t.id, t.statut,
            (SELECT max(v.numero)::int FROM transcriptions_versions v WHERE v.transcription_id = t.id) AS version
     FROM transcriptions t WHERE t.cabinet_id = $1 AND t.mission_id = $2 AND t.reference_consentement = $3`,
    [cc.ctx.cabinetId, missionId, ref],
  );
  return r[0];
}

async function creer(cc: ContexteCanaux, missionId: string, r: ReunionDemo): Promise<void> {
  const chef = await chefDe(cc.ctx, missionId);
  const audio = fabriquerConteneurAudioSimule({
    texte: r.brut,
    langue: "fr",
    dureeMs: r.dureeMs,
    confiance: r.etat === "rejetee" ? 520 : 870,
  });
  const fichierId = await televerserCanaux(
    cc,
    chef,
    `/api/missions/${missionId}/transcriptions/audio`,
    r.fichier,
    audio,
    "application/octet-stream",
  );
  corps(
    201,
    await cc.appel(chef, "POST", `/api/missions/${missionId}/transcriptions`, {
      fichier_id: fichierId,
      langue: "fr",
      enregistrement_consenti: true,
      reference_consentement: r.reference,
      duree_secondes: Math.max(1, Math.round(r.dureeMs / 1000)),
    }),
    `transcription ${r.fichier}`,
  );
  await executerTaches(cc);
}

/** Transcriptions de réunions à tous les états de la relecture. Idempotent (référence de consentement). */
export async function semerTranscriptions(cc: ContexteCanaux): Promise<void> {
  for (const r of REUNIONS) {
    const mission = await missionDuCasting(cc.ctx, r.mission);
    const chef = await chefDe(cc.ctx, mission.id);
    const directeur = await directeurDe(cc.ctx, mission.id);
    let t = await etatTranscription(cc, mission.id, r.reference);
    if (!t) {
      await creer(cc, mission.id, r);
      t = await etatTranscription(cc, mission.id, r.reference);
    }
    if (!t) throw new Error(`Transcription ${r.fichier} introuvable après création.`);
    if (t.statut !== "a_relire") continue; // déjà validée ou rejetée
    if (r.relu && t.version < 2) {
      corps(
        200,
        await cc.appel(
          chef,
          "PUT",
          `/api/transcriptions/${t.id}/texte`,
          { texte: r.relu },
          { "if-match": `"${t.version}"` },
        ),
        `relecture ${r.fichier}`,
      );
    }
    if (r.etat === "validee") {
      corps(
        200,
        await cc.appel(directeur, "POST", `/api/transcriptions/${t.id}/valider`, {}),
        `validation ${r.fichier}`,
      );
    } else if (r.etat === "rejetee") {
      corps(
        200,
        await cc.appel(directeur, "POST", `/api/transcriptions/${t.id}/rejeter`, {
          motif: r.motifRejet,
        }),
        `rejet ${r.fichier}`,
      );
    }
  }
}
