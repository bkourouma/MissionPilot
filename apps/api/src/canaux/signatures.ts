import {
  peutSigner,
  type RefusSignature,
  type StatutDemandeSignature,
  type StatutSignataire,
} from "@missionpilot/engines";
import {
  NIVEAU_SIGNATURE_SIMULEE,
  PLAFONDS_SIGNATURES,
  type PartieSignataire,
  type SignatureCreation,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Trousseau } from "../auth/chiffrement.js";
import type { Auth } from "../auth/contexte.js";
import type { FacteurConfirme } from "../auth/confirmer-identite.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, interdit, introuvable } from "../errors.js";
import { exigerMissionVisible, type MissionAcces } from "../missions/acces.js";
import { notifier, type NotificationCreee } from "../notifications/notifier.js";
import { consentementCourant } from "./consentements.js";
import { verifierDebit } from "./debit.js";
import { documentNonSignable, portailNonPartage, canalNonActif } from "./erreurs.js";
import { mettreEnFileEnvoi } from "./envois.js";
import { ajouterPreuve } from "./preuves.js";
import type { Canaux } from "./ports.js";
import { nomDuCabinet } from "./synthese.js";

/*
 * Signature électronique d'un PDF de mission (CLI-05, ADR-010, SPEC-3c §7.7). Fournisseur LOCAL :
 * niveau « simple simulée », SANS valeur juridique ; parcours « interne » (le signataire signe dans
 * MissionPilot après reconfirmation de son identité, second facteur ACTIF exigé). Aucun effet sur le
 * budget ni sur le statut de la mission. Le journal de preuves est chaîné (`preuves.ts`).
 */

export interface DependancesSignature {
  trousseau: Trousseau;
  canaux: Canaux;
  origineWeb: string;
}

interface LigneDemande {
  id: string;
  mission_id: string;
  client_id: string;
  document_id: string;
  fichier_id: string;
  empreinte_document: string;
  objet: "lettre_mission" | "avenant" | "proces_verbal";
  ordre: "parallele" | "sequentiel";
  statut: StatutDemandeSignature;
  expire_le: Date | null;
  signataires_total: number;
  signataires_signes: number;
  demandeur_id: string;
  cree_le: Date;
  envoyee_le: Date | null;
  budget_version_id: string | null;
  mode_fournisseur: string;
  document_nom: string;
}

interface LigneSignataire {
  id: string;
  utilisateur_id: string;
  nom: string;
  partie: PartieSignataire;
  rang: number;
  statut: StatutSignataire;
  invite_le: Date | null;
  decide_le: Date | null;
}

const COLONNES_DEMANDE = `d.id, d.mission_id, d.client_id, d.document_id, d.fichier_id, d.empreinte_document,
  d.objet, d.ordre, d.statut, d.expire_le, d.signataires_total::int AS signataires_total,
  d.signataires_signes::int AS signataires_signes, d.demandeur_id, d.cree_le, d.envoyee_le,
  d.budget_version_id, d.mode_fournisseur, md.nom AS document_nom`;

const DEPUIS_DEMANDE = `signatures_demandes d JOIN mission_documents md ON md.id = d.document_id`;

/** Demande par identifiant (RLS), ou null ; `verrouiller` pose FOR UPDATE sur la demande. */
export async function lireDemande(
  db: Db,
  id: string,
  verrouiller = false,
): Promise<LigneDemande | null> {
  const r = await db.query(
    `SELECT ${COLONNES_DEMANDE} FROM ${DEPUIS_DEMANDE} WHERE d.id = $1 ${verrouiller ? "FOR UPDATE OF d" : ""}`,
    [id],
  );
  return (r.rows[0] as LigneDemande | undefined) ?? null;
}

/** Demande dont la mission est visible de l'utilisateur, sinon 404 (comme une demande d'un autre cabinet). */
export async function exigerDemandeVisible(
  db: Db,
  auth: Auth,
  id: string,
  verrouiller = false,
): Promise<{ demande: LigneDemande; mission: MissionAcces }> {
  const demande = await lireDemande(db, id);
  if (!demande) throw introuvable("Demande de signature");
  const mission = await exigerMissionVisible(db, auth, demande.mission_id).catch((e: unknown) => {
    throw e instanceof AppError && e.statut === 404 ? introuvable("Demande de signature") : e;
  });
  if (!verrouiller) return { demande, mission };
  const verrouillee = await lireDemande(db, id, true);
  if (!verrouillee) throw introuvable("Demande de signature");
  return { demande: verrouillee, mission };
}

export async function lireSignataires(db: Db, demandeId: string): Promise<LigneSignataire[]> {
  const r = await db.query(
    `SELECT s.id, s.utilisateur_id, u.nom, s.partie, s.rang::int AS rang, s.statut, s.invite_le, s.decide_le
     FROM signatures_signataires s JOIN utilisateurs u ON u.id = s.utilisateur_id
     WHERE s.demande_id = $1 ORDER BY s.rang`,
    [demandeId],
  );
  return r.rows as LigneSignataire[];
}

/** Vue d'une demande : un avenant ne rend que le numéro et le type de la version de budget (FIN-02). */
export async function vueDemande(db: Db, d: LigneDemande): Promise<Record<string, unknown>> {
  let budget: { numero: number; type: string } | null = null;
  if (d.budget_version_id) {
    const b = await db.query(
      "SELECT numero::int AS numero, type FROM budget_versions WHERE id = $1",
      [d.budget_version_id],
    );
    budget = (b.rows[0] as { numero: number; type: string } | undefined) ?? null;
  }
  return {
    id: d.id,
    mission_id: d.mission_id,
    document_id: d.document_id,
    document_nom: d.document_nom,
    objet: d.objet,
    ordre: d.ordre,
    statut: d.statut,
    expire_le: d.expire_le,
    empreinte_document: d.empreinte_document,
    mode_fournisseur: d.mode_fournisseur,
    niveau: NIVEAU_SIGNATURE_SIMULEE,
    signataires_total: d.signataires_total,
    signataires_signes: d.signataires_signes,
    demandeur_id: d.demandeur_id,
    cree_le: d.cree_le,
    ...(d.objet === "avenant" ? { budget_version: budget } : {}),
  };
}

export const vueSignataire = (s: LigneSignataire) => ({
  id: s.id,
  utilisateur_id: s.utilisateur_id,
  nom: s.nom,
  partie: s.partie,
  rang: s.rang,
  statut: s.statut,
  invite_le: s.invite_le,
  decide_le: s.decide_le,
});

/* ----- Création ----- */

export async function creerDemandeSignature(
  db: Db,
  auth: Auth,
  mission: MissionAcces,
  corps: SignatureCreation,
  maintenant: Date,
): Promise<string> {
  const d = await db.query(
    `SELECT d.id, d.type, d.fichier_id, d.statut_contenu, f.type_mime, f.sha256,
            EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = d.fichier_id) AS supprime
     FROM mission_documents d LEFT JOIN fichiers f ON f.id = d.fichier_id
     WHERE d.id = $1 AND d.mission_id = $2`,
    [corps.document_id, mission.id],
  );
  const doc = d.rows[0] as
    | {
        id: string;
        type: string;
        fichier_id: string | null;
        statut_contenu: string | null;
        type_mime: string | null;
        sha256: string | null;
        supprime: boolean;
      }
    | undefined;
  if (!doc) throw introuvable("Document");
  const typeAttendu = corps.objet === "lettre_mission" ? "lettre_de_mission" : "autre";
  if (
    !doc.fichier_id ||
    doc.type_mime !== "application/pdf" ||
    !doc.sha256 ||
    doc.supprime ||
    doc.type !== typeAttendu ||
    (doc.statut_contenu !== null && doc.statut_contenu !== "valide")
  ) {
    throw documentNonSignable();
  }
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `signature_demande:${mission.id}`,
  ]);
  const ouverte = await db.query(
    `SELECT count(*) FILTER (WHERE document_id = $2)::int AS meme_document, count(*)::int AS total
     FROM signatures_demandes WHERE mission_id = $1 AND statut IN ('brouillon', 'envoyee', 'partielle')`,
    [mission.id, doc.id],
  );
  if ((ouverte.rows[0].meme_document as number) > 0) {
    throw new AppError(
      409,
      "SIGNATURE_EN_COURS",
      "Une demande de signature est déjà ouverte pour ce document.",
    );
  }
  if ((ouverte.rows[0].total as number) >= PLAFONDS_SIGNATURES.ouvertesParMission) {
    throw conflit("Trop de demandes de signature ouvertes pour cette mission.");
  }
  await verifierDebit(db, auth, "signature");
  if (corps.budget_version_id) {
    const b = await db.query("SELECT 1 FROM budget_versions WHERE id = $1 AND mission_id = $2", [
      corps.budget_version_id,
      mission.id,
    ]);
    if (!b.rows[0]) throw introuvable("Version de budget");
  }
  const ids = corps.signataires.map((s) => s.utilisateur_id);
  const connus = await db.query("SELECT id FROM utilisateurs WHERE id = ANY($1::uuid[])", [ids]);
  if (connus.rows.length !== ids.length) throw introuvable("Signataire");
  const r = await db.query(
    `INSERT INTO signatures_demandes
       (cabinet_id, mission_id, client_id, document_id, fichier_id, empreinte_document, objet,
        budget_version_id, ordre, expire_le, demandeur_id, cree_le)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz + make_interval(days => $11::int), $12, $10)
     RETURNING id`,
    [
      auth.cabinetId,
      mission.id,
      mission.client_id,
      doc.id,
      doc.fichier_id,
      doc.sha256,
      corps.objet,
      corps.budget_version_id ?? null,
      corps.ordre,
      maintenant,
      corps.expire_jours,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  let rang = 1;
  for (const s of corps.signataires) {
    await db.query(
      `INSERT INTO signatures_signataires (cabinet_id, demande_id, utilisateur_id, partie, rang)
       VALUES ($1, $2, $3, $4, $5)`,
      [auth.cabinetId, id, s.utilisateur_id, s.partie, rang++],
    );
  }
  await ajouterPreuve(db, {
    cabinetId: auth.cabinetId,
    demandeId: id,
    empreinteDocument: doc.sha256,
    type: "demande_creee",
    donnees: { objet: corps.objet, ordre: corps.ordre },
  });
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "signature.demander",
    entite: "signature_demande",
    entiteId: id,
    details: { mission_id: mission.id, objet: corps.objet, signataires: ids.length },
  });
  return id;
}

/* ----- Invitation et envoi ----- */

/** Invite un signataire : statut, preuve, notification interne et, côté client, message WhatsApp. */
async function inviter(
  db: Db,
  deps: DependancesSignature,
  auth: Auth | null,
  demande: LigneDemande,
  s: LigneSignataire,
  maintenant: Date,
  notifications: NotificationCreee[],
): Promise<void> {
  const cabinetId = auth?.cabinetId ?? (await cabinetDe(db, demande.id));
  await db.query(
    "UPDATE signatures_signataires SET statut = 'invite', invite_le = now() WHERE id = $1",
    [s.id],
  );
  await ajouterPreuve(db, {
    cabinetId,
    demandeId: demande.id,
    empreinteDocument: demande.empreinte_document,
    type: "invitation_envoyee",
    signataireId: s.id,
    donnees: { canal: "application" },
  });
  const n = await notifier(db, {
    cabinetId,
    destinataireId: s.utilisateur_id,
    type: "signature_a_effectuer",
    titre: "Un document attend votre signature",
    corps: "Ouvrez votre espace pour consulter le document et le signer.",
    lien:
      s.partie === "client"
        ? `/portail/signatures/${demande.id}`
        : `/missions/${demande.mission_id}/signatures`,
  });
  if (n) notifications.push(n);
  if (s.partie !== "client") return;
  // WhatsApp : seulement avec un numéro vérifié ET un consentement accordé.
  const d = await db.query(
    `SELECT id FROM canaux_destinataires WHERE utilisateur_id = $1 AND canal = 'whatsapp' AND verifie_le IS NOT NULL`,
    [s.utilisateur_id],
  );
  const destinataireId = d.rows[0]?.id as string | undefined;
  if (!destinataireId || (await consentementCourant(db, destinataireId)).statut !== "accorde")
    return;
  await mettreEnFileEnvoi(db, deps.trousseau, {
    cabinetId,
    canal: "whatsapp",
    destinataireId,
    gabarit: "signature_a_effectuer",
    variables: [await nomDuCabinet(db, cabinetId), `/portail/signatures/${demande.id}`],
    objetType: "signature_demande",
    objetId: demande.id,
    cle: `signature:${demande.id}:${s.id}`,
    maintenant,
  });
}

async function cabinetDe(db: Db, demandeId: string): Promise<string> {
  const r = await db.query("SELECT cabinet_id FROM signatures_demandes WHERE id = $1", [demandeId]);
  return r.rows[0].cabinet_id as string;
}

/**
 * Envoi : mission partagée avec le client (409 `PORTAIL_NON_PARTAGE`), fournisseur local, statut
 * `envoyee`, signataires invités (tous en parallèle, le rang 1 en séquentiel), preuves, notifications.
 * Le document est lu par les signataires du portail par la route de signature (aucun partage de
 * document supplémentaire n'est créé).
 */
export async function envoyerDemande(
  db: Db,
  deps: DependancesSignature,
  auth: Auth,
  id: string,
  maintenant: Date,
): Promise<{ demande: LigneDemande; notifications: NotificationCreee[] }> {
  const { demande } = await exigerDemandeVisible(db, auth, id, true);
  if (demande.statut !== "brouillon") throw conflit("Seule une demande en brouillon s'envoie.");
  const partage = await db.query(
    `SELECT 1 FROM portail_partages WHERE mission_id = $1 AND client_id = $2 AND document_id IS NULL`,
    [demande.mission_id, demande.client_id],
  );
  if (!partage.rows[0]) throw portailNonPartage();
  const fournisseur = deps.canaux.signature;
  if (!fournisseur) throw canalNonActif();
  const signataires = await lireSignataires(db, id);
  if (signataires.length === 0)
    throw conflit("Une demande de signature exige au moins un signataire.");
  const jours = demande.expire_le
    ? Math.round((demande.expire_le.getTime() - demande.cree_le.getTime()) / 86_400_000)
    : PLAFONDS_SIGNATURES.validiteJoursDefaut;
  const ref = await fournisseur.creerDemande({
    idempotence: id,
    empreintesDocument: demande.empreinte_document,
    nomDocument: demande.document_nom,
    signataires: signataires.map((s) => ({ id: s.id, rang: s.rang, partie: s.partie })),
    expireLe: new Date(maintenant.getTime() + jours * 86_400_000),
  });
  await db.query(
    `UPDATE signatures_demandes SET statut = 'envoyee', envoyee_le = now(),
       expire_le = now() + (expire_le - cree_le), signataires_total = $2, reference_externe = $3
     WHERE id = $1`,
    [id, signataires.length, ref.referenceExterne],
  );
  const notifications: NotificationCreee[] = [];
  const invites = demande.ordre === "parallele" ? signataires : signataires.slice(0, 1);
  for (const s of invites) await inviter(db, deps, auth, demande, s, maintenant, notifications);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "signature.envoyer",
    entite: "signature_demande",
    entiteId: id,
    details: { signataires: signataires.length },
  });
  return { demande: (await lireDemande(db, id)) as LigneDemande, notifications };
}

/* ----- Consultation, signature, refus, annulation ----- */

/** Signataire de CETTE demande pour cet utilisateur et cette partie, ou null. */
async function monSignataire(
  db: Db,
  demandeId: string,
  utilisateurId: string,
  partie: PartieSignataire,
  verrouiller = false,
): Promise<LigneSignataire | null> {
  const r = await db.query(
    `SELECT s.id, s.utilisateur_id, u.nom, s.partie, s.rang::int AS rang, s.statut, s.invite_le, s.decide_le
     FROM signatures_signataires s JOIN utilisateurs u ON u.id = s.utilisateur_id
     WHERE s.demande_id = $1 AND s.utilisateur_id = $2 AND s.partie = $3 ${verrouiller ? "FOR UPDATE OF s" : ""}`,
    [demandeId, utilisateurId, partie],
  );
  return (r.rows[0] as LigneSignataire | undefined) ?? null;
}

export { monSignataire };

/**
 * Preuve « document consulté » d'un signataire invité (une seule par signataire). Renvoie vrai si le
 * demandeur est bien un signataire de la partie ; la demande est verrouillée sous la chaîne.
 */
export async function noterConsultation(
  db: Db,
  p: { cabinetId: string; demandeId: string; utilisateurId: string; partie: PartieSignataire },
): Promise<void> {
  const demande = await lireDemande(db, p.demandeId, true);
  if (!demande || !["envoyee", "partielle"].includes(demande.statut)) return;
  const s = await monSignataire(db, p.demandeId, p.utilisateurId, p.partie);
  if (!s || s.statut !== "invite") return;
  const deja = await db.query(
    "SELECT 1 FROM signatures_preuves WHERE demande_id = $1 AND type_evenement = 'document_consulte' AND signataire_id = $2",
    [p.demandeId, s.id],
  );
  if (deja.rows[0]) return;
  await ajouterPreuve(db, {
    cabinetId: p.cabinetId,
    demandeId: p.demandeId,
    empreinteDocument: demande.empreinte_document,
    type: "document_consulte",
    signataireId: s.id,
    donnees: {},
  });
  await journaliser(db, {
    cabinetId: p.cabinetId,
    utilisateurId: p.utilisateurId,
    action: "signature.consulter",
    entite: "signature_demande",
    entiteId: p.demandeId,
    details: {},
  });
}

const REFUS_SIGNATURE: Record<RefusSignature, [string, string]> = {
  DEMANDE_TERMINEE: ["DEMANDE_TERMINEE", "Cette demande de signature n'est plus ouverte."],
  DEMANDE_EXPIREE: ["DEMANDE_EXPIREE", "Cette demande de signature est échue."],
  DEJA_SIGNE: ["DEJA_SIGNE", "Vous avez déjà signé ce document."],
  NON_INVITE: ["NON_INVITE", "Vous n'êtes pas encore invité à signer ce document."],
  ORDRE_NON_RESPECTE: ["ORDRE_NON_RESPECTE", "Les signataires précédents doivent signer d'abord."],
};

/**
 * Signature (dans la transaction de la reconfirmation d'identité) : contrôles (ordre, expiration,
 * statut, document consulté), preuves `reconfirmation_identite` puis `signature_apposee`, compteurs,
 * statut `partielle` ou `signee`, scellement à la dernière signature, invitation du suivant en
 * séquentiel. `clientId` : filtre explicite de la demande pour le portail (double barrière).
 */
export async function signerDemande(
  db: Db,
  deps: DependancesSignature,
  p: {
    cabinetId: string;
    utilisateurId: string;
    demandeId: string;
    partie: PartieSignataire;
    clientId: string | null;
    facteur: FacteurConfirme;
    sessionEmpreinte: string | null;
    maintenant: Date;
  },
): Promise<{ demande: LigneDemande; notifications: NotificationCreee[]; signeLe: Date }> {
  const demande = await lireDemande(db, p.demandeId, true);
  if (
    !demande ||
    demande.statut === "brouillon" ||
    (p.clientId !== null && demande.client_id !== p.clientId)
  ) {
    throw introuvable("Demande de signature");
  }
  const moi = await monSignataire(db, p.demandeId, p.utilisateurId, p.partie, true);
  if (!moi) throw introuvable("Demande de signature");
  const tous = await lireSignataires(db, p.demandeId);
  const decision = peutSigner({
    demande: {
      statut: demande.statut,
      expireLe: demande.expire_le ?? new Date(0),
      maintenant: p.maintenant,
    },
    signataire: { id: moi.id, rang: moi.rang, statut: moi.statut },
    ordre: demande.ordre,
    signataires: tous.map((s) => ({ id: s.id, rang: s.rang, statut: s.statut })),
  });
  if (!decision.autorise && decision.refus) {
    const [code, message] = REFUS_SIGNATURE[decision.refus];
    throw new AppError(409, code, message);
  }
  const consulte = await db.query(
    "SELECT 1 FROM signatures_preuves WHERE demande_id = $1 AND type_evenement = 'document_consulte' AND signataire_id = $2",
    [p.demandeId, moi.id],
  );
  if (!consulte.rows[0]) {
    throw new AppError(409, "DOCUMENT_NON_CONSULTE", "Consultez le document avant de le signer.");
  }
  const authentification = p.facteur === "mot_de_passe" ? "mot_de_passe" : "mot_de_passe_et_2fa";
  const base = {
    cabinetId: p.cabinetId,
    demandeId: p.demandeId,
    empreinteDocument: demande.empreinte_document,
    signataireId: moi.id,
    authentification,
    sessionEmpreinte: p.sessionEmpreinte,
  } as const;
  await ajouterPreuve(db, {
    ...base,
    type: "reconfirmation_identite",
    donnees: { facteur: p.facteur },
  });
  await ajouterPreuve(db, {
    ...base,
    type: "signature_apposee",
    donnees: { partie: p.partie, rang: moi.rang },
  });
  const signe = await db.query(
    "UPDATE signatures_signataires SET statut = 'signe', decide_le = now() WHERE id = $1 RETURNING decide_le",
    [moi.id],
  );
  const signes = tous.filter((s) => s.statut === "signe").length + 1;
  const toutes = signes === demande.signataires_total;
  await db.query(
    `UPDATE signatures_demandes SET statut = $2, signataires_signes = $3,
       termine_le = CASE WHEN $2 = 'signee' THEN now() ELSE termine_le END WHERE id = $1`,
    [p.demandeId, toutes ? "signee" : "partielle", signes],
  );
  const notifications: NotificationCreee[] = [];
  if (toutes) {
    await ajouterPreuve(db, {
      cabinetId: p.cabinetId,
      demandeId: p.demandeId,
      empreinteDocument: demande.empreinte_document,
      type: "scellement",
      donnees: { signataires: signes },
    });
    const n = await notifier(db, {
      cabinetId: p.cabinetId,
      destinataireId: demande.demandeur_id,
      type: "signature_terminee",
      titre: "Un document est signé par toutes les parties",
      corps: "Toutes les signatures demandées ont été apposées.",
      lien: `/missions/${demande.mission_id}/signatures`,
    });
    if (n) notifications.push(n);
    if (demande.objet === "lettre_mission") {
      const m = await db.query("SELECT statut, directeur_id FROM missions WHERE id = $1", [
        demande.mission_id,
      ]);
      if (m.rows[0]?.statut === "proposition" && m.rows[0]?.directeur_id) {
        const d = await notifier(db, {
          cabinetId: p.cabinetId,
          destinataireId: m.rows[0].directeur_id as string,
          type: "lettre_mission_signee",
          titre: "La lettre de mission est signée : vous pouvez signer la mission",
          corps: "Les signataires ont signé la lettre de mission.",
          lien: `/missions/${demande.mission_id}`,
        });
        if (d) notifications.push(d);
      }
    }
  } else if (demande.ordre === "sequentiel") {
    const suivant = tous.find((s) => s.statut === "en_attente" && s.rang > moi.rang);
    if (suivant) await inviter(db, deps, null, demande, suivant, p.maintenant, notifications);
  }
  await journaliser(db, {
    cabinetId: p.cabinetId,
    utilisateurId: p.utilisateurId,
    action: "signature.signer",
    entite: "signature_demande",
    entiteId: p.demandeId,
    details: { partie: p.partie, authentification },
  });
  return {
    demande: (await lireDemande(db, p.demandeId)) as LigneDemande,
    notifications,
    signeLe: signe.rows[0].decide_le as Date,
  };
}

/** Refus d'un signataire invité (motif obligatoire) : la demande passe `refusee`. */
export async function refuserDemande(
  db: Db,
  p: {
    cabinetId: string;
    utilisateurId: string;
    demandeId: string;
    partie: PartieSignataire;
    clientId: string | null;
    motif: string;
    maintenant: Date;
  },
): Promise<NotificationCreee[]> {
  const demande = await lireDemande(db, p.demandeId, true);
  if (
    !demande ||
    demande.statut === "brouillon" ||
    (p.clientId !== null && demande.client_id !== p.clientId)
  ) {
    throw introuvable("Demande de signature");
  }
  const moi = await monSignataire(db, p.demandeId, p.utilisateurId, p.partie, true);
  if (!moi) throw introuvable("Demande de signature");
  if (!["envoyee", "partielle"].includes(demande.statut)) {
    throw new AppError(409, "DEMANDE_TERMINEE", "Cette demande de signature n'est plus ouverte.");
  }
  if (moi.statut !== "invite") {
    throw new AppError(409, "NON_INVITE", "Vous n'êtes pas invité à signer ce document.");
  }
  await db.query(
    "UPDATE signatures_signataires SET statut = 'refuse', decide_le = now(), motif_refus = $2 WHERE id = $1",
    [moi.id, p.motif],
  );
  await ajouterPreuve(db, {
    cabinetId: p.cabinetId,
    demandeId: p.demandeId,
    empreinteDocument: demande.empreinte_document,
    type: "refus",
    signataireId: moi.id,
    donnees: { partie: p.partie },
  });
  await db.query(
    "UPDATE signatures_demandes SET statut = 'refusee', termine_le = now(), motif_fin = $2 WHERE id = $1",
    [p.demandeId, p.motif],
  );
  await journaliser(db, {
    cabinetId: p.cabinetId,
    utilisateurId: p.utilisateurId,
    action: "signature.refuser",
    entite: "signature_demande",
    entiteId: p.demandeId,
    details: { partie: p.partie },
  });
  const n = await notifier(db, {
    cabinetId: p.cabinetId,
    destinataireId: demande.demandeur_id,
    type: "signature_refusee",
    titre: "Une demande de signature a été refusée",
    corps: "Un signataire a refusé de signer le document.",
    lien: `/missions/${demande.mission_id}/signatures`,
  });
  return n ? [n] : [];
}

/** Annulation par le demandeur ou un associé (motif obligatoire), fournisseur prévenu. */
export async function annulerDemande(
  db: Db,
  deps: DependancesSignature,
  auth: Auth,
  id: string,
  motif: string,
): Promise<LigneDemande> {
  const { demande } = await exigerDemandeVisible(db, auth, id, true);
  if (demande.demandeur_id !== auth.utilisateurId && !auth.roles.includes("associe"))
    throw interdit();
  if (!["brouillon", "envoyee", "partielle"].includes(demande.statut)) {
    throw conflit("Cette demande de signature est terminée.");
  }
  const ref = await db.query("SELECT reference_externe FROM signatures_demandes WHERE id = $1", [
    id,
  ]);
  if (ref.rows[0]?.reference_externe && deps.canaux.signature) {
    await deps.canaux.signature.annuler(ref.rows[0].reference_externe as string, "annulation");
  }
  await ajouterPreuve(db, {
    cabinetId: auth.cabinetId,
    demandeId: id,
    empreinteDocument: demande.empreinte_document,
    type: "annulation",
    donnees: {},
  });
  await db.query(
    "UPDATE signatures_demandes SET statut = 'annulee', termine_le = now(), motif_fin = $2 WHERE id = $1",
    [id, motif],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "signature.annuler",
    entite: "signature_demande",
    entiteId: id,
    details: {},
  });
  return (await lireDemande(db, id)) as LigneDemande;
}

/**
 * Expiration d'une demande échue (maintenance quotidienne, horloge du job) : signataires `expire`,
 * preuve `expiration`, statut `expiree`. Renvoie vrai si la demande a été expirée.
 */
export async function expirerDemande(
  db: Db,
  cabinetId: string,
  demandeId: string,
  maintenant: Date,
): Promise<boolean> {
  const demande = await lireDemande(db, demandeId, true);
  if (
    !demande ||
    !["envoyee", "partielle"].includes(demande.statut) ||
    !demande.expire_le ||
    demande.expire_le.getTime() >= maintenant.getTime()
  ) {
    return false;
  }
  await db.query(
    `UPDATE signatures_signataires SET statut = 'expire', decide_le = now()
     WHERE demande_id = $1 AND statut IN ('en_attente', 'invite')`,
    [demandeId],
  );
  await ajouterPreuve(db, {
    cabinetId,
    demandeId,
    empreinteDocument: demande.empreinte_document,
    type: "expiration",
    donnees: {},
  });
  await db.query(
    "UPDATE signatures_demandes SET statut = 'expiree', termine_le = now(), motif_fin = 'Échéance dépassée' WHERE id = $1",
    [demandeId],
  );
  await journaliser(db, {
    cabinetId,
    utilisateurId: null,
    action: "signature.expirer",
    entite: "signature_demande",
    entiteId: demandeId,
    details: {},
  });
  return true;
}

/** Liste des demandes d'une mission (la mission est déjà contrôlée visible). */
export async function listerDemandesMission(
  db: Db,
  missionId: string,
  statut: string | undefined,
  apres: [string, string] | null,
  limite: number,
) {
  const r = await db.query(
    `SELECT ${COLONNES_DEMANDE},
       to_char(d.cree_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cle_tri
     FROM ${DEPUIS_DEMANDE}
     WHERE d.mission_id = $1 AND ($2::text IS NULL OR d.statut = $2)
       AND ($3::text IS NULL OR (d.cree_le, d.id) < ($3::timestamptz, $4::uuid))
     ORDER BY d.cree_le DESC, d.id DESC LIMIT $5`,
    [missionId, statut ?? null, apres?.[0] ?? null, apres?.[1] ?? null, limite + 1],
  );
  return r.rows as (LigneDemande & { cle_tri: string })[];
}

export type { LigneDemande, LigneSignataire };
