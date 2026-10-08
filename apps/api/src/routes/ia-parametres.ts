import type { FastifyPluginAsync } from "fastify";
import {
  aPermission,
  iaParametresModificationSchema,
  iaTestSchema,
  TACHES_IA,
} from "@missionpilot/shared";
import { avecErreursAgents } from "../agents/erreurs.js";
import { journaliser } from "../audit.js";
import { trousseauDepuisConfig } from "../auth/chiffrement.js";
import { serviceIdentite, type FacteurConfirme } from "../auth/confirmer-identite.js";
import { exiger } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, requeteInvalide } from "../errors.js";
import {
  enregistrerConsommation,
  estimerCoutAppel,
  reserverAppel,
  solderReservation,
} from "../ia/couts.js";
import {
  ErreurLlm,
  estimerTokens,
  fournisseurDepuisConfig,
  type ReponseLlm,
} from "../ia/fournisseur.js";
import { reglerEvaluationLocale } from "../ia/evaluation.js";
import { MODELES_AUTORISES, modeleAutorise } from "../ia/modeles.js";
import { generationsSimultanees, ISSUES_FACTURABLES } from "../ia/orchestrateur.js";
import {
  chiffrerCle,
  lireParametres,
  modeleDe,
  plafondEffectif,
  resoudreCle,
  sourceCleDisponible,
  vueModeles,
} from "../ia/parametres.js";
import {
  associesActifs,
  envoyerEmails,
  notifierAvecEmailEnFile,
  type NotificationCreee,
} from "../notifications/notifier.js";

/*
 * Paramètres IA du cabinet (ADR-003).
 * - GET (ia.utiliser) : état SANS la clé (`cle_configuree`, source de clé,
 *   mode IA ou gabarit) et modèles par tâche ; plafonds (du cabinet, de la
 *   plateforme, effectif), modèles autorisés et auteur de la dernière
 *   modification pour « ia.configurer » seulement.
 * - PUT (ia.configurer) : interrupteur (l'IA est désactivée tant que le
 *   cabinet ne l'a pas activée), plafond, modèles (au tarif connu seulement),
 *   clé du cabinet (chiffrée, jamais renvoyée). Définir ou retirer la clé, ou
 *   RELEVER le plafond, exige la reconfirmation de l'identité (bloc
 *   `confirmation` : mot de passe, et code si la 2FA est active ; mot de passe
 *   seul sans 2FA, facteur journalisé), comme les coordonnées bancaires. Un
 *   changement de clé est journalisé (sans la valeur) et signalé aux associés
 *   par notification et e-mail en file : une clé substituée détournerait les
 *   données vers un autre compte.
 * - POST /tester (ia.configurer) : appel minimal du modèle de la tâche, IA
 *   activée seulement (409 sinon) ; coût réservé sous le plafond puis compté
 *   (issue « test »).
 */

const sansCache = { "cache-control": "no-store" } as const;

const confirmationRequise = () =>
  new AppError(
    403,
    "CONFIRMATION_REQUISE",
    "Confirmez votre mot de passe (et votre code de vérification) pour changer la clé API IA ou relever le plafond.",
  );

export const routesIaParametres: FastifyPluginAsync = async (app) => {
  const identite = serviceIdentite(app);

  const vue = async (configurer: boolean, cabinetId: string) =>
    app.db.withTenant(cabinetId, async (db) => {
      const p = await lireParametres(db);
      const source = sourceCleDisponible(p, app.config);
      return {
        fournisseur: "openrouter",
        ia_activee: p.ia_activee,
        cle_configuree: p.cle_configuree,
        cle_plateforme_disponible: Boolean(app.config.OPENROUTER_API_KEY?.trim()),
        source_cle: source,
        mode: p.ia_activee && source ? "ia" : "gabarit",
        modeles: vueModeles(p),
        ...(configurer
          ? {
              plafond_mensuel_micro_usd: p.plafond_mensuel_micro_usd,
              plafond_plateforme_micro_usd: app.config.IA_PLAFOND_PLATEFORME_MICRO_USD,
              plafond_effectif_micro_usd: plafondEffectif(p, app.config, source),
              modeles_autorises: MODELES_AUTORISES,
              cle_modifiee_le: p.cle_modifiee_le,
              modifie_par: p.modifie_par,
              modifie_le: p.modifie_le,
            }
          : {}),
      };
    });

  app.get("/ia/parametres", async (request, reply) => {
    const auth = exiger(request, "ia.utiliser");
    reply.headers(sansCache);
    return vue(aPermission(auth.roles, "ia.configurer"), auth.cabinetId);
  });

  app.put("/ia/parametres", async (request, reply) => {
    const auth = exiger(request, "ia.configurer");
    const m = iaParametresModificationSchema.parse(request.body);
    for (const tache of TACHES_IA) {
      const modele = m.modeles?.[tache];
      if (modele && !modeleAutorise(modele)) {
        throw requeteInvalide(
          `Modèle non disponible : ${modele}. Choisissez un modèle au tarif connu (${MODELES_AUTORISES.join(", ")}).`,
        );
      }
    }
    const trousseau = trousseauDepuisConfig(app.config);
    const cleModifiee = m.cle_api !== undefined;
    const exigeConfirmation = (plafondAvant: number) =>
      cleModifiee ||
      (m.plafond_mensuel_micro_usd !== undefined && m.plafond_mensuel_micro_usd > plafondAvant);

    /** Écriture sous verrou ; `facteur` null : aucune reconfirmation faite. */
    const ecrire = async (
      db: Db,
      facteur: FacteurConfirme | null,
    ): Promise<(NotificationCreee | null)[]> => {
      await db.query(
        `INSERT INTO ia_parametres_cabinet (cabinet_id, modifie_par) VALUES ($1, $2)
           ON CONFLICT (cabinet_id) DO NOTHING`,
        [auth.cabinetId, auth.utilisateurId],
      );
      const avant = await db.query(
        "SELECT plafond_mensuel_micro_usd::text AS plafond FROM ia_parametres_cabinet FOR UPDATE",
      );
      // Contrôle sous verrou : un plafond abaissé entre-temps rend le relèvement à confirmer.
      if (exigeConfirmation(Number(avant.rows[0].plafond)) && facteur === null) {
        throw confirmationRequise();
      }
      if (m.ia_activee !== undefined || m.plafond_mensuel_micro_usd !== undefined) {
        await db.query(
          `UPDATE ia_parametres_cabinet SET ia_activee = coalesce($1, ia_activee),
               plafond_mensuel_micro_usd = coalesce($2, plafond_mensuel_micro_usd),
               modifie_par = $3, modifie_le = now()`,
          [m.ia_activee ?? null, m.plafond_mensuel_micro_usd ?? null, auth.utilisateurId],
        );
      }
      if (cleModifiee) {
        const c = m.cle_api ? chiffrerCle(trousseau, auth.cabinetId, m.cle_api) : null;
        await db.query(
          `UPDATE ia_parametres_cabinet SET cle_chiffree = $1, cle_version = $2,
               cle_modifiee_le = now(), modifie_par = $3, modifie_le = now()`,
          [c?.donnees ?? null, c?.version ?? null, auth.utilisateurId],
        );
      }
      for (const tache of TACHES_IA) {
        const modele = m.modeles?.[tache];
        if (modele === undefined) continue;
        if (modele === null) {
          await db.query("DELETE FROM ia_modeles_taches WHERE tache = $1", [tache]);
        } else {
          // MPG04 (0264, 0265) : un prompt actif doté d'un jeu d'essai n'a pas réussi ce
          // jeu avec ce modèle → 409 NON_REGRESSION_REQUISE, jamais une 500. Hors
          // production seulement, une évaluation locale est admise.
          await reglerEvaluationLocale(db, app.config);
          await avecErreursAgents(() =>
            db.query(
              `INSERT INTO ia_modeles_taches (cabinet_id, tache, modele, modifie_par)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (cabinet_id, tache) DO UPDATE
                   SET modele = excluded.modele, modifie_par = excluded.modifie_par, modifie_le = now()`,
              [auth.cabinetId, tache, modele, auth.utilisateurId],
            ),
          );
        }
      }
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "modification_parametres_ia",
        entite: "ia_parametres",
        entiteId: auth.cabinetId,
        // Jamais la clé : seulement le fait qu'elle a été définie ou retirée.
        details: {
          ia_activee: m.ia_activee,
          plafond_mensuel_micro_usd: m.plafond_mensuel_micro_usd,
          cle_api: !cleModifiee ? undefined : m.cle_api === null ? "retiree" : "definie",
          modeles: m.modeles,
          ...(facteur ? { facteur } : {}),
        },
      });
      if (!cleModifiee) return [];
      const alertes: (NotificationCreee | null)[] = [];
      for (const associe of await associesActifs(db)) {
        alertes.push(
          await notifierAvecEmailEnFile(db, trousseau, {
            cabinetId: auth.cabinetId,
            destinataireId: associe,
            type: "ia_cle_modifiee",
            titre:
              m.cle_api === null
                ? "Clé API IA du cabinet retirée"
                : "Clé API IA du cabinet modifiée",
            corps: `Modification faite par ${auth.nom}. Si vous n'en êtes pas à l'origine, retirez la clé et prévenez le support.`,
            lien: "/parametres/ia",
          }),
        );
      }
      return alertes;
    };

    // Lecture préalable (hors verrou) : la reconfirmation n'est demandée que si elle est due.
    const plafondAvant = await app.db.withTenant(
      auth.cabinetId,
      async (db) => (await lireParametres(db)).plafond_mensuel_micro_usd,
    );
    if (!exigeConfirmation(plafondAvant)) {
      // Les e-mails d'alerte partent EN FILE, dans la transaction (notifierAvecEmailEnFile).
      await app.db.withTenant(auth.cabinetId, (db) => ecrire(db, null));
    } else {
      if (!m.confirmation?.mot_de_passe) throw confirmationRequise();
      await identite.confirmerIdentite(auth, m.confirmation, "cle_api_ia", ecrire, {
        motDePasseSeulSiInactive: true,
      });
    }
    reply.headers(sansCache);
    return vue(true, auth.cabinetId);
  });

  app.post("/ia/parametres/tester", async (request, reply) => {
    const auth = exiger(request, "ia.configurer");
    const { tache } = iaTestSchema.parse(request.body ?? {});
    const maintenant = new Date();
    const MESSAGES = [
      { role: "system" as const, content: "Réponds uniquement par le mot OK." },
      { role: "user" as const, content: "Test de connexion." },
    ];
    const caracteres = MESSAGES.reduce((n, x) => n + x.content.length, 0);
    const prep = await app.db.withTenant(auth.cabinetId, async (db) => {
      const p = await lireParametres(db);
      if (!p.ia_activee) {
        throw new AppError(
          409,
          "IA_DESACTIVEE",
          "L'IA est désactivée pour le cabinet : activez-la avant de tester le fournisseur.",
        );
      }
      const cle = await resoudreCle(db, app.config, auth.cabinetId);
      if (cle.statut === "absente") {
        throw new AppError(409, "CLE_IA_ABSENTE", "Aucune clé API : l'IA fonctionne en gabarits.");
      }
      if (cle.statut === "illisible") {
        throw new AppError(
          409,
          "CLE_IA_ILLISIBLE",
          "La clé API IA du cabinet est illisible : enregistrez-la de nouveau.",
        );
      }
      const modele = modeleDe(p, tache);
      const plafond = plafondEffectif(p, app.config, cle.source);
      const reservation = await reserverAppel(db, {
        cabinetId: auth.cabinetId,
        demandeId: null,
        estimation: estimerCoutAppel(modele, caracteres, 5),
        plafond,
        maintenant,
      });
      if (reservation.statut === "plafond") {
        throw new AppError(409, "PLAFOND_IA_ATTEINT", "Plafond mensuel de coût IA atteint.");
      }
      if (reservation.statut === "simultanees") throw generationsSimultanees();
      return {
        cle: { cle: cle.cle, source: cle.source },
        modele,
        plafond,
        reservation: reservation.id,
      };
    });
    const consommationTest = (tokensEntree: number, tokensSortie: number, dureeMs: number) => ({
      cabinetId: auth.cabinetId,
      demandeId: null,
      missionId: null,
      tache,
      modele: prep.modele,
      issue: "test" as const,
      sourceCle: prep.cle.source,
      tokensEntree,
      tokensSortie,
      dureeMs,
    });
    const fournisseur = fournisseurDepuisConfig(app.config, (e) => app.log.info({ ia: e }));
    let rep: ReponseLlm;
    try {
      rep = await fournisseur.completer({
        tache,
        modele: prep.modele,
        messages: MESSAGES,
        maxTokens: 5,
        cleApi: prep.cle.cle,
      });
    } catch (error) {
      // Réservation soldée ; un appel peut-être facturé est compté au coût estimé.
      const facturable = error instanceof ErreurLlm && ISSUES_FACTURABLES[error.code] !== undefined;
      await app.db
        .withTenant(auth.cabinetId, async (db) => {
          await solderReservation(db, prep.reservation);
          if (facturable) {
            await enregistrerConsommation(
              db,
              consommationTest(estimerTokens(caracteres), 5, 0),
              prep.plafond,
              maintenant,
            );
          }
        })
        .catch(() => undefined);
      throw error;
    }
    const { notifications } = await app.db.withTenant(auth.cabinetId, async (db) => {
      await solderReservation(db, prep.reservation);
      const c = await enregistrerConsommation(
        db,
        consommationTest(rep.tokensEntree, rep.tokensSortie, rep.dureeMs),
        prep.plafond,
        maintenant,
      );
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "test_fournisseur_ia",
        entite: "ia_parametres",
        entiteId: auth.cabinetId,
        details: { modele: prep.modele, source_cle: prep.cle.source, duree_ms: rep.dureeMs },
      });
      return c;
    });
    await envoyerEmails(app.mailer, notifications, (msg) => app.log.warn(msg));
    reply.headers(sansCache);
    return {
      ok: true,
      tache,
      modele: prep.modele,
      modele_servi: rep.modele,
      source_cle: prep.cle.source,
      duree_ms: rep.dureeMs,
      tokens_entree: rep.tokensEntree,
      tokens_sortie: rep.tokensSortie,
    };
  });
};
