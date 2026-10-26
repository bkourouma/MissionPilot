import { estNumeroDeTest } from "@missionpilot/engines";
import { journaliser } from "../../../audit.js";
import { mentionEnVigueur } from "../../../canaux/consentements.js";
import {
  controlerAvantNumero,
  ecrireNumero,
  verifierCodeNumero,
} from "../../../canaux/destinataires.js";
import { MOT_DE_PASSE_DEMO_TENANT } from "../constantes.js";
import type { CleCompte } from "../cles.js";
import { corps, type ContexteCanaux } from "./canaux-contexte.js";
import {
  CONTACTS_CANAUX,
  DATE_ACTIVATION_CANAL,
  type ContactCanal,
} from "./donnees-canaux-contacts.js";
import { sql } from "./outils.js";

/*
 * Compte WhatsApp simulé, numéros de TEST vérifiés et consentements du module « canaux ».
 *
 * Le compte est activé par la vraie route (reconfirmation du mot de passe d'un associé). Les
 * numéros passent par les services de `canaux/destinataires` avec la date fictive du jour
 * d'enregistrement (le code de vérification est consommé aussitôt : aucun message n'est envoyé).
 * Les consentements sont insérés en SQL propriétaire avec leur date fictive, car l'historique est
 * en ajout seul (MPH01) et la route écrit « maintenant » : mêmes colonnes que
 * `ajouterConsentement`, mêmes déclencheurs de contrôle (numéro vérifié, source, acteur).
 */

interface CompteVu {
  canal: string;
  actif: boolean;
  disponible: boolean;
  saisie_kpi: boolean;
  alerte_kpi: boolean;
  synthese_hebdo: boolean;
  relance_questionnaire_j10: boolean;
  repli_sms: boolean;
}

/** Options voulues du compte : saisie de KPI par messagerie et alerte de KPI sortante ACTIVÉES. */
const OPTIONS_VOULUES = {
  saisie_kpi: true,
  alerte_kpi: true,
  synthese_hebdo: true,
  relance_questionnaire_j10: true,
  repli_sms: false,
} as const;

/** Active le compte WhatsApp simulé et pose ses options (par un associé). Renvoie vrai si écrit. */
export async function activerCompteWhatsapp(cc: ContexteCanaux): Promise<boolean> {
  const lire = async () =>
    corps<{ elements: CompteVu[] }>(
      200,
      await cc.appel("associe", "GET", "/api/canaux/comptes"),
      "comptes de canal",
    ).elements;
  const wa = (await lire()).find((c) => c.canal === "whatsapp");
  if (!wa?.disponible) throw new Error("Le fournisseur WhatsApp simulé n'est pas disponible.");
  let ecrit = false;
  if (!wa.actif) {
    corps(
      200,
      await cc.appel("associe", "PUT", "/api/canaux/comptes/whatsapp", {
        actif: true,
        ...OPTIONS_VOULUES,
        mot_de_passe: MOT_DE_PASSE_DEMO_TENANT,
      }),
      "activation du compte WhatsApp simulé",
    );
    ecrit = true;
  } else if (
    (Object.keys(OPTIONS_VOULUES) as (keyof typeof OPTIONS_VOULUES)[]).some(
      (k) => wa[k] !== OPTIONS_VOULUES[k],
    )
  ) {
    corps(
      200,
      await cc.appel("associe", "PUT", "/api/canaux/comptes/whatsapp", { ...OPTIONS_VOULUES }),
      "options du compte WhatsApp simulé",
    );
    ecrit = true;
  }
  // Le compte « existe depuis » son jour d'activation fictif (la colonne `cree_le` est libre).
  await cc.ctx.proprietaire.query(
    "UPDATE canaux_comptes SET cree_le = $1::timestamptz WHERE cabinet_id = $2 AND canal = 'whatsapp' AND cree_le > $1::timestamptz",
    [`${DATE_ACTIVATION_CANAL}T09:00:00Z`, cc.ctx.cabinetId],
  );
  return ecrit;
}

/** Comptes du canal tels que l'API les rend (contrôle final : alerte KPI sortante activée). */
export async function lireComptes(cc: ContexteCanaux): Promise<CompteVu[]> {
  return corps<{ elements: CompteVu[] }>(
    200,
    await cc.appel("associe", "GET", "/api/canaux/comptes"),
    "comptes de canal",
  ).elements;
}

export type Destinataires = Map<CleCompte, string>;

async function preparerContact(
  cc: ContexteCanaux,
  c: ContactCanal,
  associeId: string,
): Promise<string> {
  if (!estNumeroDeTest(c.numero)) throw new Error("Seuls les numéros de test sont admis.");
  const utilisateurId = cc.ctx.utilisateurs[c.cle];
  if (!utilisateurId) throw new Error(`Utilisateur « ${c.cle} » introuvable.`);
  const cabinetId = cc.ctx.cabinetId;
  const quand = new Date(`${c.jour}T10:00:00Z`);
  const existant = await sql<{ id: string }>(
    cc.ctx,
    "SELECT id FROM canaux_destinataires WHERE cabinet_id = $1 AND utilisateur_id = $2 AND canal = 'whatsapp'",
    [cabinetId, utilisateurId],
  );
  let id = existant[0]?.id;
  if (!id) {
    // Le gestionnaire du numéro est la personne elle-même (portail, responsable interne) ou, pour
    // un consentement recueilli, l'associé qui l'a enregistré.
    const acteurId = c.consentement === "cabinet" ? associeId : utilisateurId;
    id = await cc.database.withTenant(cabinetId, async (db) => {
      const numero = await controlerAvantNumero(db, cc.deps, {
        utilisateurId,
        canal: "whatsapp",
        numeroSaisi: c.numero,
        maintenant: quand,
      });
      const r = await ecrireNumero(db, cc.deps, {
        acteur: { cabinetId, utilisateurId: acteurId },
        utilisateurId,
        canal: "whatsapp",
        numero,
        maintenant: quand,
      });
      if (c.verifie) {
        if (r.code === null) throw new Error("Code de vérification absent.");
        const v = await verifierCodeNumero(db, cc.deps, {
          cabinetId,
          destinataireId: r.destinataire.id,
          canal: "whatsapp",
          code: r.code,
          maintenant: quand,
          acteurId,
        });
        if (v.statut !== "verifie") throw new Error("Vérification du numéro échouée.");
      }
      return r.destinataire.id;
    });
    await cc.ctx.proprietaire.query(
      "UPDATE canaux_destinataires SET cree_le = $1::timestamptz WHERE id = $2 AND cree_le > $1::timestamptz",
      [`${c.jour}T09:55:00Z`, id],
    );
  }
  if (c.verifie && c.consentement !== "aucun")
    await poserConsentement(cc, c, id, utilisateurId, associeId);
  return id;
}

async function poserConsentement(
  cc: ContexteCanaux,
  c: ContactCanal,
  destinataireId: string,
  utilisateurId: string,
  associeId: string,
): Promise<void> {
  const deja = await sql(cc.ctx, "SELECT 1 FROM canaux_consentements WHERE destinataire_id = $1", [
    destinataireId,
  ]);
  if (deja.length > 0) return; // un consentement (ou son retrait par STOP) n'est jamais écrasé
  const date = `${c.jour}T10:05:00Z`;
  const cabinetId = cc.ctx.cabinetId;
  if (c.consentement === "portail") {
    const mention = mentionEnVigueur("whatsapp");
    await cc.ctx.proprietaire.query(
      `INSERT INTO canaux_consentements (cabinet_id, destinataire_id, canal, statut, source,
         mention_version, mention_empreinte, acteur_id, cree_le)
       VALUES ($1, $2, 'whatsapp', 'accorde', 'portail', $3, $4, $5, $6::timestamptz)`,
      [cabinetId, destinataireId, mention.version, mention.empreinte, utilisateurId, date],
    );
  } else {
    await cc.ctx.proprietaire.query(
      `INSERT INTO canaux_consentements (cabinet_id, destinataire_id, canal, statut, source,
         reference_preuve, acteur_id, cree_le)
       VALUES ($1, $2, 'whatsapp', 'accorde', 'recueilli_cabinet', $3, $4, $5::timestamptz)`,
      [cabinetId, destinataireId, c.reference, associeId, date],
    );
  }
  await cc.database.withTenant(cabinetId, (db) =>
    journaliser(db, {
      cabinetId,
      utilisateurId: c.consentement === "portail" ? utilisateurId : associeId,
      action: "canal.consentement.accorder",
      entite: "canal_destinataire",
      entiteId: destinataireId,
      details: {
        canal: "whatsapp",
        source: c.consentement === "portail" ? "portail" : "recueilli_cabinet",
        demonstration: true,
      },
    }),
  );
}

/** Numéros de test vérifiés (ou en attente de code) et consentements des contacts. */
export async function preparerContacts(cc: ContexteCanaux): Promise<Destinataires> {
  const associeId = cc.ctx.utilisateurs["associe"] as string;
  const ids: Destinataires = new Map();
  for (const c of CONTACTS_CANAUX) ids.set(c.cle, await preparerContact(cc, c, associeId));
  return ids;
}
