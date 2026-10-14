import {
  analyserSaisieKpi,
  evaluerVraisemblance,
  renforcerPourVocal,
  type CodeGabarit,
} from "@missionpilot/engines";
import { PLAFONDS_CANAUX, type OrigineSaisieKpi, type StatutSaisieKpi } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { conflit, introuvable } from "../errors.js";
import { mesuresActivesDe } from "../kpi/donnees.js";
import { exigerKpiSaisissable } from "../kpi/acces.js";
import { EXPEDITEUR_ACTIF_SQL, etatDestinataire } from "./destinataires.js";
import { filtreVisibilite, voitToutesLesMissions } from "../missions/acces.js";
import { notifier, type NotificationCreee } from "../notifications/notifier.js";

/*
 * Saisie de KPI par message (KPI-14, SPEC-3c §7.5). Seulement une PROPOSITION : le texte (ou la
 * transcription vocale, jetée aussitôt) est analysé par du code DÉTERMINISTE (aucun modèle de langage,
 * AGT-07), une vraisemblance est évaluée, la personne confirme par OUI (OUI <valeur> pour une valeur
 * à vérifier ou toute origine vocale), puis UN UTILISATEUR DU CABINET reprend la valeur dans le KPI
 * (`kpi.saisir`). Aucune mesure n'est écrite par le webhook ni sous l'identité de la personne.
 */

export interface ReponseDeService {
  gabarit: CodeGabarit;
  variables: string[];
  /** Objet de l'envoi : la proposition (ou, à défaut, le destinataire). */
  objetId: string;
}

const VALIDITE_PROPOSITION_MS = PLAFONDS_CANAUX.saisieKpiValiditeMinutes * 60_000;

const NON_COMPRIS = (objetId: string): ReponseDeService => ({
  gabarit: "reponse_non_comprise",
  variables: [],
  objetId,
});

/** Libellé court (40 caractères au plus, une ligne) d'un KPI pour les réponses de service. */
export function libelleCourt(libelle: string): string {
  const net = libelle
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return net.length > 40 ? `${net.slice(0, 39).trimEnd()}…` : net || "indicateur";
}

/** Valeur décimale exacte normalisée (virgule ou point, zéros de fin retirés) pour comparaison. */
function normaliserValeur(v: string): string | null {
  const m = /^(-?)(\d{1,15})(?:[.,](\d{1,6}))?$/.exec(v.trim());
  if (!m) return null;
  const ent = (m[2] as string).replace(/^0+(?=\d)/, "");
  const frac = (m[3] ?? "").replace(/0+$/, "");
  const corps = frac === "" ? ent : `${ent}.${frac}`;
  return m[1] === "-" && corps !== "0" ? `-${corps}` : corps;
}

/** Analyse un message texte (ou vocal) et enregistre au plus UNE proposition. */
export async function traiterTexteSaisie(
  db: Db,
  p: {
    cabinetId: string;
    destinataireId: string;
    utilisateurId: string;
    evenementRef: string;
    texte: string;
    origine: OrigineSaisieKpi;
    maintenant: Date;
  },
): Promise<ReponseDeService> {
  const refus = NON_COMPRIS(p.destinataireId);
  // Habilitation REVUE ici aussi (défense en profondeur, constat I1) : utilisateur actif, portail et
  // client actifs, numéro vérifié.
  if ((await etatDestinataire(db, p.destinataireId)) !== "ok") return refus;
  const compte = await db.query(
    "SELECT actif, saisie_kpi FROM canaux_comptes WHERE canal = 'whatsapp'",
  );
  if (compte.rows[0]?.actif !== true || compte.rows[0]?.saisie_kpi !== true) return refus;
  // Seulement SES KPI : contributeur désigné d'un KPI actif d'une mission non clôturée.
  const kpis = await db.query(
    `SELECT d.id, d.libelle FROM kpi_definitions d
     JOIN kpi_contributeurs k ON k.kpi_id = d.id AND k.utilisateur_id = $1
     JOIN utilisateurs u ON u.id = k.utilisateur_id AND ${EXPEDITEUR_ACTIF_SQL}
     WHERE d.actif AND EXISTS (SELECT 1 FROM missions m WHERE m.id = d.mission_id AND m.statut <> 'cloturee')
     ORDER BY d.id LIMIT 200`,
    [p.utilisateurId],
  );
  if (kpis.rows.length === 0) return refus;
  const analyse = analyserSaisieKpi(
    p.texte,
    kpis.rows.map((k) => ({ id: k.id as string, libelle: k.libelle as string })),
  );
  if (analyse.statut !== "ok") return refus;
  // Au plus 20 propositions par destinataire et par 24 h.
  const recentes = await db.query(
    `SELECT count(*)::int AS n FROM canaux_saisies_kpi
     WHERE destinataire_id = $1 AND cree_le > $2::timestamptz - interval '24 hours'`,
    [p.destinataireId, p.maintenant],
  );
  if ((recentes.rows[0].n as number) >= PLAFONDS_CANAUX.saisiesKpi24h) return refus;
  const libelle = kpis.rows.find((k) => k.id === analyse.kpiId)?.libelle as string;
  const historique = (await mesuresActivesDe(db, [analyse.kpiId])).slice(-24);
  // Les valeurs de l'historique sont relues en texte exact (jamais un flottant).
  const exact = await db.query(
    `SELECT m.valeur::text AS valeur FROM kpi_mesures m
     WHERE m.kpi_id = $1 AND NOT m.annulation
       AND NOT EXISTS (SELECT 1 FROM kpi_mesures r WHERE r.remplace_id = m.id)
     ORDER BY m.date_mesure DESC, m.numero DESC LIMIT 24`,
    [analyse.kpiId],
  );
  void historique;
  let v = evaluerVraisemblance(
    analyse.valeur,
    (exact.rows as { valeur: string }[]).map((x) => x.valeur),
  );
  if (p.origine === "vocal") v = renforcerPourVocal(v);
  // Une proposition plus ancienne et non décidée ne reste pas en attente : OUI vise la dernière.
  await db.query(
    `UPDATE canaux_saisies_kpi SET statut = 'expiree'
     WHERE destinataire_id = $1 AND statut = 'a_confirmer'`,
    [p.destinataireId],
  );
  const statut: StatutSaisieKpi =
    v.niveau === "invraisemblable" ? "rejetee_vraisemblance" : "a_confirmer";
  const r = await db.query(
    `INSERT INTO canaux_saisies_kpi
       (cabinet_id, kpi_id, destinataire_id, evenement_ref, origine, date_mesure, valeur,
        vraisemblance, motif_vraisemblance, statut, expire_le)
     VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8, $9, $10, $11)
     ON CONFLICT (cabinet_id, evenement_ref) DO NOTHING RETURNING id`,
    [
      p.cabinetId,
      analyse.kpiId,
      p.destinataireId,
      p.evenementRef,
      p.origine,
      p.maintenant.toISOString().slice(0, 10),
      analyse.valeur,
      v.niveau,
      v.motif,
      statut,
      new Date(p.maintenant.getTime() + VALIDITE_PROPOSITION_MS),
    ],
  );
  const id = r.rows[0]?.id as string | undefined;
  if (!id) return refus;
  if (v.niveau === "invraisemblable") {
    return { gabarit: "reponse_saisie_refusee", variables: [], objetId: id };
  }
  return {
    gabarit: v.niveau === "a_verifier" ? "reponse_saisie_a_verifier" : "reponse_saisie_a_confirmer",
    variables: [libelleCourt(libelle), analyse.valeur],
    objetId: id,
  };
}

export interface ResultatConfirmation {
  reponse: ReponseDeService | null;
  notifications: NotificationCreee[];
}

/** OUI ou NON d'un destinataire sur sa dernière proposition en attente. */
export async function traiterConfirmation(
  db: Db,
  p: {
    cabinetId: string;
    destinataireId: string;
    reponse: "oui" | "non";
    valeur: string | undefined;
    maintenant: Date;
  },
): Promise<ResultatConfirmation> {
  const refus: ResultatConfirmation = { reponse: NON_COMPRIS(p.destinataireId), notifications: [] };
  if ((await etatDestinataire(db, p.destinataireId)) !== "ok") return refus;
  const r = await db.query(
    `SELECT s.id, s.valeur::text AS valeur, s.origine, s.vraisemblance, s.expire_le, s.kpi_id,
            d.libelle, d.mission_id
     FROM canaux_saisies_kpi s JOIN kpi_definitions d ON d.id = s.kpi_id
     WHERE s.destinataire_id = $1 AND s.statut = 'a_confirmer'
     ORDER BY s.cree_le DESC, s.id DESC LIMIT 1 FOR UPDATE OF s`,
    [p.destinataireId],
  );
  const s = r.rows[0] as
    | {
        id: string;
        valeur: string;
        origine: OrigineSaisieKpi;
        vraisemblance: string;
        expire_le: Date;
        kpi_id: string;
        libelle: string;
        mission_id: string;
      }
    | undefined;
  if (!s) return refus;
  if (s.expire_le.getTime() < p.maintenant.getTime()) {
    await db.query("UPDATE canaux_saisies_kpi SET statut = 'expiree' WHERE id = $1", [s.id]);
    return refus;
  }
  if (p.reponse === "non") {
    await db.query("UPDATE canaux_saisies_kpi SET statut = 'refusee' WHERE id = $1", [s.id]);
    return { reponse: null, notifications: [] };
  }
  // OUI <valeur> identique exigé pour une valeur à vérifier et pour toute origine vocale.
  const exigeValeur = s.vraisemblance === "a_verifier" || s.origine === "vocal";
  if (exigeValeur) {
    const donnee = p.valeur === undefined ? null : normaliserValeur(p.valeur);
    if (donnee === null || donnee !== normaliserValeur(s.valeur)) {
      return {
        reponse: {
          gabarit: "reponse_saisie_a_verifier",
          variables: [libelleCourt(s.libelle), normaliserValeur(s.valeur) ?? s.valeur],
          objetId: s.id,
        },
        notifications: [],
      };
    }
  } else if (p.valeur !== undefined && normaliserValeur(p.valeur) !== normaliserValeur(s.valeur)) {
    return refus;
  }
  await db.query(
    "UPDATE canaux_saisies_kpi SET statut = 'confirmee', confirmee_le = $2 WHERE id = $1",
    [s.id, p.maintenant],
  );
  await journaliser(db, {
    cabinetId: p.cabinetId,
    utilisateurId: null,
    action: "canal.saisie_kpi.confirmee",
    entite: "canal_saisie_kpi",
    entiteId: s.id,
    details: { kpi_id: s.kpi_id, origine: s.origine },
  });
  const mission = await db.query("SELECT chef_id, directeur_id FROM missions WHERE id = $1", [
    s.mission_id,
  ]);
  const responsable = (mission.rows[0]?.chef_id ?? mission.rows[0]?.directeur_id) as
    string | undefined;
  const notifications: NotificationCreee[] = [];
  if (responsable) {
    const n = await notifier(db, {
      cabinetId: p.cabinetId,
      destinataireId: responsable,
      type: "saisie_kpi_confirmee",
      titre: "Une saisie d'indicateur reçue par message est à reprendre",
      corps: "Un contributeur a confirmé une valeur par message : reprenez-la dans l'indicateur.",
      lien: `/missions/${s.mission_id}/kpi`,
    });
    if (n) notifications.push(n);
  }
  return {
    reponse: { gabarit: "reponse_saisie_enregistree", variables: [], objetId: s.id },
    notifications,
  };
}

/* ----- Lecture et décisions du cabinet ----- */

export interface LigneSaisie {
  id: string;
  kpi_id: string;
  kpi_libelle: string;
  destinataire_id: string;
  origine: OrigineSaisieKpi;
  date_mesure: string;
  valeur: string;
  vraisemblance: string;
  motif_vraisemblance: string | null;
  statut: StatutSaisieKpi;
  expire_le: Date;
  cree_le: Date;
  cle_tri: string;
}

/** Propositions des KPI de missions VISIBLES de l'utilisateur, du plus récent au plus ancien. */
export async function listerSaisies(
  db: Db,
  auth: Auth,
  statut: StatutSaisieKpi | undefined,
  apres: [string, string] | null,
  limite: number,
): Promise<LigneSaisie[]> {
  const r = await db.query(
    `SELECT s.id, s.kpi_id, d.libelle AS kpi_libelle, s.destinataire_id, s.origine,
            s.date_mesure::text AS date_mesure, s.valeur::text AS valeur, s.vraisemblance,
            s.motif_vraisemblance, s.statut, s.expire_le, s.cree_le,
            to_char(s.cree_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cle_tri
     FROM canaux_saisies_kpi s
     JOIN kpi_definitions d ON d.id = s.kpi_id
     JOIN missions m ON m.id = d.mission_id
     WHERE ${filtreVisibilite(1, 2)} AND ($3::text IS NULL OR s.statut = $3)
       AND ($4::text IS NULL OR (s.cree_le, s.id) < ($4::timestamptz, $5::uuid))
     ORDER BY s.cree_le DESC, s.id DESC LIMIT $6`,
    [
      voitToutesLesMissions(auth),
      auth.utilisateurId,
      statut ?? null,
      apres?.[0] ?? null,
      apres?.[1] ?? null,
      limite + 1,
    ],
  );
  return r.rows as LigneSaisie[];
}

const jourFr = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

/**
 * Reprise par un utilisateur du cabinet détenant `kpi.saisir` sur ce KPI : crée la mesure (origine
 * « cabinet », la date est modifiable) puis relie la proposition. Seule une proposition confirmée se
 * reprend, une fois (409 sinon). Renvoie l'identifiant du KPI (évaluation des alertes ensuite).
 */
export async function reprendreSaisie(
  db: Db,
  auth: Auth,
  id: string,
  corps: { date_mesure?: string | undefined; commentaire?: string | undefined },
): Promise<{ kpiId: string; mesureId: string }> {
  const r = await db.query(
    `SELECT id, kpi_id, statut, valeur::text AS valeur, date_mesure::text AS date_mesure, confirmee_le
     FROM canaux_saisies_kpi WHERE id = $1 FOR UPDATE`,
    [id],
  );
  const s = r.rows[0] as
    | {
        id: string;
        kpi_id: string;
        statut: string;
        valeur: string;
        date_mesure: string;
        confirmee_le: Date | null;
      }
    | undefined;
  if (!s) throw introuvable("Saisie");
  await exigerKpiSaisissable(db, auth, s.kpi_id);
  if (s.statut !== "confirmee") throw conflit("Cette saisie n'est pas à reprendre.");
  const quand = s.confirmee_le ?? new Date();
  const base = `Reçu par WhatsApp, confirmé par le répondant le ${jourFr(quand)}`;
  const commentaire = (corps.commentaire ? `${base} — ${corps.commentaire}` : base).slice(0, 1000);
  const m = await db.query(
    `INSERT INTO kpi_mesures (cabinet_id, kpi_id, date_mesure, valeur, annulation, motif, commentaire,
       origine, saisie_par)
     VALUES ($1, $2, $3, $4::numeric, false, NULL, $5, 'cabinet', $6) RETURNING id`,
    [
      auth.cabinetId,
      s.kpi_id,
      corps.date_mesure ?? s.date_mesure,
      s.valeur,
      commentaire,
      auth.utilisateurId,
    ],
  );
  const mesureId = m.rows[0].id as string;
  await db.query(
    `UPDATE canaux_saisies_kpi SET statut = 'reprise', mesure_id = $2, reprise_par = $3, reprise_le = now()
     WHERE id = $1`,
    [id, mesureId, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "canal.saisie_kpi.reprise",
    entite: "canal_saisie_kpi",
    entiteId: id,
    details: { kpi_id: s.kpi_id, mesure_id: mesureId },
  });
  return { kpiId: s.kpi_id, mesureId };
}

/** Rejet par le cabinet d'une saisie confirmée (motif obligatoire). */
export async function rejeterSaisie(db: Db, auth: Auth, id: string, motif: string): Promise<void> {
  const r = await db.query(
    "SELECT id, kpi_id, statut FROM canaux_saisies_kpi WHERE id = $1 FOR UPDATE",
    [id],
  );
  const s = r.rows[0] as { id: string; kpi_id: string; statut: string } | undefined;
  if (!s) throw introuvable("Saisie");
  await exigerKpiSaisissable(db, auth, s.kpi_id);
  if (s.statut !== "confirmee") throw conflit("Cette saisie n'est pas à reprendre.");
  await db.query(
    "UPDATE canaux_saisies_kpi SET statut = 'rejetee_cabinet', motif_rejet = $2 WHERE id = $1",
    [id, motif],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "canal.saisie_kpi.rejetee",
    entite: "canal_saisie_kpi",
    entiteId: id,
    details: { kpi_id: s.kpi_id },
  });
}
