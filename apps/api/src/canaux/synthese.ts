import { z } from "zod";
import {
  compteMessage,
  composerSyntheseDirigeant,
  rendreGabaritCanal,
  type SyntheseDirigeant,
} from "@missionpilot/engines";
import { journaliser } from "../audit.js";
import { trousseauDepuisConfig } from "../auth/chiffrement.js";
import type { Database, Db } from "../db/pool.js";
import { ErreurJobDefinitive } from "../jobs/erreurs.js";
import type { HandlerJob } from "../jobs/registre.js";
import { consentementCourant } from "./consentements.js";
import { mettreEnFileEnvoi } from "./envois.js";
import type { DependancesCanaux } from "./fabrique.js";
import { lireFaitsSynthese } from "./synthese-sources.js";

/*
 * Synthèse hebdomadaire du dirigeant (CLI-07, SPEC-3c §7.4) : calcul DÉTERMINISTE (moteur
 * `composerSyntheseDirigeant`), aucun modèle de langage. Le message WhatsApp ne porte que deux nombres
 * (0 à 999) et un lien vers `/portail/synthese` ; la page du portail affiche le détail. Si rien n'est
 * à signaler, rien n'est envoyé. L'aperçu côté cabinet calcule la même synthèse et n'envoie RIEN.
 */

export const TYPE_JOB_CANAL_SYNTHESE_HEBDO = "canal_synthese_hebdo";
export const LIEN_SYNTHESE_PORTAIL = "/portail/synthese";

const chargeSchema = z.object({ semaine: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();

export async function nomDuCabinet(db: Db, cabinetId: string): Promise<string> {
  const r = await db.query("SELECT nom FROM cabinets WHERE id = $1", [cabinetId]);
  const nom = String(r.rows[0]?.nom ?? "Votre cabinet")
    .replace(/\p{Cc}/gu, " ")
    .trim();
  return nom.slice(0, 60) || "Votre cabinet";
}

/** Variables du gabarit `synthese_hebdo` : cabinet, deux nombres plafonnés à 999, lien relatif. */
export function variablesSynthese(nomCabinet: string, s: SyntheseDirigeant): string[] {
  return [
    nomCabinet,
    String(compteMessage(s.pointsAttention)),
    String(compteMessage(s.decisionsAttendues)),
    LIEN_SYNTHESE_PORTAIL,
  ];
}

export interface ApercuSynthese {
  synthese: SyntheseDirigeant;
  /** Texte WhatsApp exact tel qu'il partirait ; nul si rien à signaler. */
  texteMessage: string | null;
}

/** Aperçu d'un dirigeant : calcule la synthèse et rend le message, SANS rien envoyer ni enregistrer. */
export async function apercuSynthese(
  database: Database,
  db: Db,
  p: {
    cabinetId: string;
    clientId: string;
    utilisateurId: string;
    date: string;
    origineWeb: string;
  },
): Promise<ApercuSynthese> {
  const faits = await lireFaitsSynthese(database, p.cabinetId, {
    clientId: p.clientId,
    utilisateurId: p.utilisateurId,
    date: p.date,
  });
  const synthese = composerSyntheseDirigeant(faits);
  if (synthese.vide) return { synthese, texteMessage: null };
  const nom = await nomDuCabinet(db, p.cabinetId);
  const rendu = rendreGabaritCanal(
    "synthese_hebdo",
    variablesSynthese(nom, synthese),
    p.origineWeb,
  );
  return { synthese, texteMessage: rendu.texte };
}

/**
 * Job du lundi : pour chaque dirigeant ayant un destinataire WhatsApp VÉRIFIÉ au consentement
 * accordé, met en file UN envoi par semaine (clé `synthese:<lundi>:<destinataire>`), sauf si rien
 * n'est à signaler (ligne d'audit `canal.synthese.vide`). Le coupe-circuit N4 bloque l'envoi
 * (`mettreEnFileEnvoi`). Rejoué : la clé empêche tout doublon.
 */
export function creerHandlerCanalSyntheseHebdo(dependances: () => DependancesCanaux): HandlerJob {
  return async (ctx) => {
    const charge = chargeSchema.safeParse(ctx.charge);
    if (!charge.success) throw new ErreurJobDefinitive("Charge de synthèse hebdomadaire invalide.");
    const database = ctx.database;
    if (!database) throw new ErreurJobDefinitive("Base de l'application absente.");
    const { config } = dependances();
    const compte = await ctx.db.query(
      "SELECT actif, synthese_hebdo FROM canaux_comptes WHERE canal = 'whatsapp'",
    );
    if (compte.rows[0]?.actif !== true || compte.rows[0]?.synthese_hebdo !== true) return [];
    const trousseau = trousseauDepuisConfig(config);
    const cibles = await ctx.db.query(
      `SELECT d.id AS destinataire_id, d.utilisateur_id, up.client_id
       FROM canaux_destinataires d
       JOIN utilisateurs u ON u.id = d.utilisateur_id AND u.actif AND 'client_dirigeant' = ANY (u.roles)
       JOIN utilisateurs_portail up ON up.utilisateur_id = u.id AND up.statut = 'actif'
       JOIN clients c ON c.id = up.client_id AND c.actif
       WHERE d.canal = 'whatsapp' AND d.verifie_le IS NOT NULL
       ORDER BY d.id`,
    );
    const date = ctx.maintenant.toISOString().slice(0, 10);
    const nom = await nomDuCabinet(ctx.db, ctx.cabinetId);
    for (const cible of cibles.rows as {
      destinataire_id: string;
      utilisateur_id: string;
      client_id: string;
    }[]) {
      if ((await consentementCourant(ctx.db, cible.destinataire_id)).statut !== "accorde") continue;
      const faits = await lireFaitsSynthese(database, ctx.cabinetId, {
        clientId: cible.client_id,
        utilisateurId: cible.utilisateur_id,
        date,
      });
      const synthese = composerSyntheseDirigeant(faits);
      if (synthese.vide) {
        await journaliser(ctx.db, {
          cabinetId: ctx.cabinetId,
          utilisateurId: null,
          action: "canal.synthese.vide",
          entite: "canal_destinataire",
          entiteId: cible.destinataire_id,
          details: { semaine: charge.data.semaine },
        });
        continue;
      }
      await mettreEnFileEnvoi(ctx.db, trousseau, {
        cabinetId: ctx.cabinetId,
        canal: "whatsapp",
        destinataireId: cible.destinataire_id,
        gabarit: "synthese_hebdo",
        variables: variablesSynthese(nom, synthese),
        objetType: "synthese",
        objetId: cible.destinataire_id,
        cle: `synthese:${charge.data.semaine}:${cible.destinataire_id}`,
        maintenant: ctx.maintenant,
      });
    }
    return [];
  };
}

/** Planification du lundi 07:30 UTC (valeur PROVISOIRE) : fonction étroite `planifier_synthese_hebdo`. */
export const HEURE_SYNTHESE_HEBDO_UTC = "07:30:00";

export async function planifierSyntheseHebdo(db: Db, maintenant: Date): Promise<number> {
  const jour = maintenant.toISOString().slice(0, 10);
  const d = new Date(`${jour}T00:00:00Z`);
  // Planifiée le lundi seulement (la synthèse est celle de la semaine qui commence).
  if (d.getUTCDay() !== 1) return 0;
  const lundi = jour;
  const r = await db.query("SELECT planifier_synthese_hebdo($1, $2, $3) AS n", [
    `synthese_hebdo:${lundi}`,
    new Date(`${lundi}T${HEURE_SYNTHESE_HEBDO_UTC}Z`),
    lundi,
  ]);
  return r.rows[0].n as number;
}
