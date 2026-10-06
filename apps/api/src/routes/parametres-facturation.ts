import type { FastifyPluginAsync } from "fastify";
import {
  aPermission,
  CHAMPS_CONFIRMATION,
  CHAMPS_PARAMETRES_BANCAIRES,
  CHAMPS_PARAMETRES_IDENTITE,
  CHAMPS_PARAMETRES_OPERATIONNELS,
  confirmationIdentiteSchema,
  parametresFacturationSchema,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { serviceIdentite, type FacteurConfirme } from "../auth/confirmer-identite.js";
import { exiger, type Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, interdit, requeteInvalide } from "../errors.js";
import {
  lireParametresFacturation,
  type ParametresFacturation,
} from "../facturation/parametres.js";
import { associesActifs, notifierAvecEmailEnFile } from "../notifications/notifier.js";

const CHAMPS = [...CHAMPS_PARAMETRES_IDENTITE, ...CHAMPS_PARAMETRES_OPERATIONNELS] as const;
const BANCAIRES: readonly string[] = CHAMPS_PARAMETRES_BANCAIRES;

/** IBAN masqué pour le journal et les alertes : 2 premiers et 4 derniers caractères. */
export function masquerIban(iban: string | null): string | null {
  if (!iban) return null;
  if (iban.length <= 6) return "…";
  return `${iban.slice(0, 2)}…${iban.slice(-4)}`;
}

const confirmationRequise = () =>
  new AppError(
    403,
    "CONFIRMATION_REQUISE",
    "Confirmez votre mot de passe (et votre code de vérification) pour modifier les coordonnées bancaires.",
  );

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
 *
 * Coordonnées bancaires (iban, banque, autres_coordonnees ; constat M3) :
 * une MODIFICATION (valeur différente de l'actuelle) exige en plus, dans le
 * même corps, `mot_de_passe` et `code` ou `code_secours` (auth/
 * confirmer-identite.ts) ; sans 2FA active, le mot de passe seul suffit (le
 * journal le note). Le journal porte l'IBAN MASQUÉ avant et après ; tous les
 * associés actifs sont alertés par e-mail.
 */
export const routesParametresFacturation: FastifyPluginAsync = async (app) => {
  const identite = serviceIdentite(app);

  app.get("/parametres-facturation", async (request) => {
    const auth = exiger(request);
    if (!aPermission(auth.roles, "facture.lire") && !aPermission(auth.roles, "cabinet.gerer")) {
      throw interdit();
    }
    return app.db.withTenant(auth.cabinetId, (db) => lireParametresFacturation(db, auth.cabinetId));
  });

  app.patch("/parametres-facturation", async (request) => {
    const auth = exiger(request);
    const corps = (request.body ?? {}) as Record<string, unknown>;
    if (typeof corps !== "object" || Array.isArray(corps)) throw requeteInvalide("Corps invalide.");
    const confirmation = confirmationIdentiteSchema.parse(
      Object.fromEntries(
        Object.entries(corps).filter(([c]) =>
          (CHAMPS_CONFIRMATION as readonly string[]).includes(c),
        ),
      ),
    );
    const modif = parametresFacturationSchema.parse(
      Object.fromEntries(
        Object.entries(corps).filter(
          ([c]) => !(CHAMPS_CONFIRMATION as readonly string[]).includes(c),
        ),
      ),
    );
    const champs = Object.keys(modif).filter(
      (c) => (modif as Record<string, unknown>)[c] !== undefined,
    );
    const identiteLegale = champs.some((c) =>
      (CHAMPS_PARAMETRES_IDENTITE as readonly string[]).includes(c),
    );
    const operationnel = champs.some((c) =>
      (CHAMPS_PARAMETRES_OPERATIONNELS as readonly string[]).includes(c),
    );
    if (identiteLegale && !aPermission(auth.roles, "cabinet.gerer")) throw interdit();
    if (operationnel && !aPermission(auth.roles, "facture.emettre")) throw interdit();

    const bancairesModifies = (avant: ParametresFacturation) =>
      champs.filter(
        (c) =>
          BANCAIRES.includes(c) &&
          (modif as Record<string, unknown>)[c] !== avant[c as keyof ParametresFacturation],
      );

    /** Écriture dans la transaction ; `facteur` null : aucune reconfirmation faite. */
    const ecrire = async (db: Db, facteur: FacteurConfirme | null) => {
      const avant = await lireParametresFacturation(db, auth.cabinetId, true);
      const bancaires = bancairesModifies(avant);
      // Contrôle sous verrou : une valeur changée entre-temps exige la reconfirmation.
      if (bancaires.length > 0 && facteur === null) throw confirmationRequise();
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
      const ibanModifie = bancaires.includes("iban");
      // Noms des champs ; l'IBAN seulement MASQUÉ ; jamais les autres coordonnées.
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification",
        entite: "parametres_facturation",
        entiteId: auth.cabinetId,
        details: {
          champs,
          ...(bancaires.length > 0 ? { coordonnees_bancaires: bancaires, facteur } : {}),
          ...(ibanModifie
            ? { iban_avant: masquerIban(avant.iban), iban_apres: masquerIban(apres.iban) }
            : {}),
        },
      });
      if (bancaires.length > 0) await alerterAssocies(db, auth, bancaires, avant, apres);
      return lireParametresFacturation(db, auth.cabinetId);
    };

    // Lecture préalable (hors verrou) : la reconfirmation n'est demandée que pour un vrai changement.
    const avant = await app.db.withTenant(auth.cabinetId, (db) =>
      lireParametresFacturation(db, auth.cabinetId),
    );
    if (bancairesModifies(avant).length === 0) {
      return app.db.withTenant(auth.cabinetId, (db) => ecrire(db, null));
    }
    if (!confirmation.mot_de_passe) throw confirmationRequise();
    return identite.confirmerIdentite(auth, confirmation, "coordonnees_bancaires", ecrire, {
      motDePasseSeulSiInactive: true,
    });
  });

  async function alerterAssocies(
    db: Db,
    auth: Auth,
    bancaires: readonly string[],
    avant: ParametresFacturation,
    apres: ParametresFacturation,
  ): Promise<void> {
    const libelles: Record<string, string> = {
      iban: "IBAN",
      banque: "banque",
      autres_coordonnees: "autres coordonnées de paiement",
    };
    const corps = [
      `Coordonnées bancaires du cabinet modifiées par ${auth.nom} : ${bancaires
        .map((c) => libelles[c] ?? c)
        .join(", ")}.`,
      ...(bancaires.includes("iban")
        ? [
            `IBAN avant : ${masquerIban(avant.iban) ?? "aucun"} ; après : ${masquerIban(apres.iban) ?? "aucun"}.`,
          ]
        : []),
      "Si ce changement n'est pas attendu, vérifiez-le avant d'émettre une facture.",
    ].join("\n");
    for (const id of await associesActifs(db)) {
      await notifierAvecEmailEnFile(db, identite.trousseau, {
        cabinetId: auth.cabinetId,
        destinataireId: id,
        type: "securite_coordonnees_bancaires",
        titre: "Coordonnées bancaires du cabinet modifiées",
        corps,
        lien: "/parametres",
      });
    }
  }
};
