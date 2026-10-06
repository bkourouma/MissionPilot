import type { FastifyPluginAsync } from "fastify";
import {
  aPermission,
  CHAMPS_PARAMETRES_IDENTITE,
  CHAMPS_PARAMETRES_OPERATIONNELS,
  parametresFacturationSchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { exiger } from "../auth/contexte.js";
import { interdit, requeteInvalide } from "../errors.js";
import {
  lireParametresFacturation,
  type ParametresFacturation,
} from "../facturation/parametres.js";

const CHAMPS = [...CHAMPS_PARAMETRES_IDENTITE, ...CHAMPS_PARAMETRES_OPERATIONNELS] as const;

/**
 * Paramètres de facturation du cabinet (FIN-07).
 *
 * Lecture : « facture.lire » ou « cabinet.gerer ».
 * Écriture, selon le champ (choix documenté) :
 * - identité légale, coordonnées de paiement (IBAN) et numérotation :
 *   « cabinet.gerer » (associé) — un IBAN ou un préfixe modifié engage le
 *   cabinet et peut détourner des paiements ;
 * - délai de paiement, taux de TVA, retenue à la source et validation des
 *   valeurs de départ : « facture.emettre » (gestionnaire, associé).
 */
export const routesParametresFacturation: FastifyPluginAsync = async (app) => {
  app.get("/parametres-facturation", async (request) => {
    const auth = exiger(request);
    if (!aPermission(auth.roles, "facture.lire") && !aPermission(auth.roles, "cabinet.gerer")) {
      throw interdit();
    }
    return app.db.withTenant(auth.cabinetId, (db) => lireParametresFacturation(db, auth.cabinetId));
  });

  app.patch("/parametres-facturation", async (request) => {
    const auth = exiger(request);
    const modif = parametresFacturationSchema.parse(request.body);
    const champs = Object.keys(modif).filter(
      (c) => (modif as Record<string, unknown>)[c] !== undefined,
    );
    const identite = champs.some((c) =>
      (CHAMPS_PARAMETRES_IDENTITE as readonly string[]).includes(c),
    );
    const operationnel = champs.some((c) =>
      (CHAMPS_PARAMETRES_OPERATIONNELS as readonly string[]).includes(c),
    );
    if (identite && !aPermission(auth.roles, "cabinet.gerer")) throw interdit();
    if (operationnel && !aPermission(auth.roles, "facture.emettre")) throw interdit();
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const avant = await lireParametresFacturation(db, auth.cabinetId, true);
      const apres = { ...avant, ...modif } as ParametresFacturation;
      if (apres.prefixe_facture === apres.prefixe_avoir) {
        throw requeteInvalide("Les préfixes des factures et des avoirs doivent différer.");
      }
      if (!apres.taux_tva_autorises.includes(apres.taux_tva_defaut)) {
        throw requeteInvalide("Le taux de TVA par défaut doit figurer parmi les taux autorisés.");
      }
      if (!apres.taux_tva_autorises.includes(apres.taux_tva_debours)) {
        throw requeteInvalide("Le taux de TVA des débours doit figurer parmi les taux autorisés.");
      }
      const valeurs = CHAMPS.map((c) => apres[c]);
      const colonnes = CHAMPS.join(", ");
      const params = CHAMPS.map((_, i) => `$${i + 3}`).join(", ");
      const maj = CHAMPS.map((c) => `${c} = EXCLUDED.${c}`).join(", ");
      await db.query(
        `INSERT INTO parametres_facturation (cabinet_id, modifie_par, ${colonnes})
         VALUES ($1, $2, ${params})
         ON CONFLICT (cabinet_id) DO UPDATE SET ${maj}, modifie_par = EXCLUDED.modifie_par,
           modifie_le = now()`,
        [auth.cabinetId, auth.utilisateurId, ...valeurs],
      );
      // Noms des champs seulement : ni IBAN ni coordonnées dans le journal.
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "parametres_facturation",
        entiteId: auth.cabinetId,
        details: { champs },
      });
      return lireParametresFacturation(db, auth.cabinetId);
    });
  });
};
