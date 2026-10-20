import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { aPermission } from "@missionpilot/shared";
import {
  apercuSyntheseQuerySchema,
  canalParamSchema,
  canalUtilisateurParamSchema,
  codeVerificationNumeroSchema,
  compteCanalModificationSchema,
  consentementCabinetSchema,
  consentementsQuerySchema,
  corpsVideCanauxSchema,
  destinatairesQuerySchema,
  envoisCanauxQuerySchema,
  estDesactivationCanalSeule,
  idCanauxParamSchema,
  LIBELLES_CANAL,
  preferenceCanalPortailSchema,
  saisieKpiRejetSchema,
  saisieKpiRepriseSchema,
  saisiesKpiQuerySchema,
  simulateurEntrantSchema,
  numeroDestinataireSchema,
  type CanalMessagerie,
} from "@missionpilot/shared";
import { normaliserNumero } from "@missionpilot/engines";
import { journaliser } from "../audit.js";
import { serviceIdentite } from "../auth/confirmer-identite.js";
import { trousseauDepuisConfig } from "../auth/chiffrement.js";
import { exiger } from "../auth/contexte.js";
import {
  ajouterConsentement,
  consentementCourant,
  exigerMentionCourante,
  mentionEnVigueur,
  retirerConsentement,
  verrouillerDestinataire,
} from "../canaux/consentements.js";
import { verifierDebit } from "../canaux/debit.js";
import {
  controlerAvantNumero,
  ecrireNumero,
  erreurDeVerification,
  exigerDestinataire,
  exigerUtilisateurClient,
  listerDestinatairesClient,
  lireMesNumeros,
  numeroAcceptable,
  planifierCode,
  verifierCodeNumero,
  type DependancesDestinataires,
} from "../canaux/destinataires.js";
import { listerEnvois } from "../canaux/envois.js";
import { canalNonActif, consentementRequis, traduireErreurCanaux } from "../canaux/erreurs.js";
import { canalActif } from "../canaux/fabrique.js";
import {
  CanalWhatsAppSimule,
  ENTETE_HORODATAGE,
  signerWebhook,
} from "../canaux/whatsapp-simule.js";
import { PasserelleSmsSimulee } from "../canaux/sms-simule.js";
import { fabriquerConteneurAudioSimule } from "../canaux/transcripteur-simule.js";
import { listerSaisies, reprendreSaisie, rejeterSaisie } from "../canaux/saisies-kpi.js";
import { apercuSynthese } from "../canaux/synthese.js";
import { contexteCanauxSimulesAdmis } from "../config.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, interdit, introuvable } from "../errors.js";
import { decoderCurseur, encoderCurseur, paginer } from "../http/outils.js";
import { evaluerApresSaisie } from "../kpi/suivi.js";
import { envoyerEmails } from "../notifications/notifier.js";
import { clauseSet } from "../db/outils.js";

/*
 * Canaux externes SIMULÉS (lot 3c, SPEC-3c §10.2), sous /api : comptes, destinataires et
 * consentements, journal d'envois sans contenu, aperçu de la synthèse du dirigeant, saisies de KPI
 * reçues par message, « moi » (ses propres numéros) et simulateur de développement. AUCUN envoi réel,
 * aucune clé, aucune requête réseau. Jamais un numéro dans une réponse (masque seulement), jamais un
 * texte de message, jamais un coût sans `finance.lire` (FIN-02 : champ ABSENT). Toutes les routes sont
 * fermées au portail (liste blanche) ; une ressource d'un autre cabinet répond 404.
 */

const maintenant = () => new Date();

function deps(app: FastifyInstance): DependancesDestinataires {
  return { trousseau: trousseauDepuisConfig(app.config), canaux: app.canaux };
}

const portDe = (app: FastifyInstance, canal: CanalMessagerie) =>
  canal === "whatsapp" ? app.canaux.whatsapp : app.canaux.sms;

/** Curseur opaque d'un identifiant numérique (historique des consentements). */
const encoderCurseurId = (id: string) =>
  Buffer.from(JSON.stringify({ id }), "utf8").toString("base64url");
function decoderCurseurId(curseur: string | undefined): string | null {
  if (!curseur) return null;
  try {
    const v = JSON.parse(Buffer.from(curseur, "base64url").toString("utf8")) as { id?: unknown };
    if (typeof v.id === "string" && /^\d{1,18}$/.test(v.id)) return v.id;
  } catch {
    // curseur illisible : 400 ci-dessous
  }
  throw new AppError(400, "REQUETE_INVALIDE", "Curseur de pagination invalide.");
}

interface LigneCompte {
  canal: CanalMessagerie;
  identifiant_compte: string;
  actif: boolean;
  repli_sms: boolean;
  relance_questionnaire_j10: boolean;
  synthese_hebdo: boolean;
  saisie_kpi: boolean;
  modifie_le: Date;
}

function vueCompte(app: FastifyInstance, canal: CanalMessagerie, l: LigneCompte | undefined) {
  return {
    canal,
    mode_fournisseur: "simule" as const,
    /** Un fournisseur est configuré pour ce canal (sinon aucun envoi n'est possible). */
    disponible: portDe(app, canal) !== null,
    identifiant_compte: l?.identifiant_compte ?? null,
    actif: l?.actif ?? false,
    repli_sms: l?.repli_sms ?? true,
    relance_questionnaire_j10: l?.relance_questionnaire_j10 ?? true,
    synthese_hebdo: l?.synthese_hebdo ?? false,
    saisie_kpi: l?.saisie_kpi ?? false,
    modifie_le: l?.modifie_le ?? null,
  };
}

const COLONNES_COMPTE = `canal, identifiant_compte, actif, repli_sms, relance_questionnaire_j10,
  synthese_hebdo, saisie_kpi, modifie_le`;

async function lireComptes(db: Db): Promise<Map<CanalMessagerie, LigneCompte>> {
  const r = await db.query(`SELECT ${COLONNES_COMPTE} FROM canaux_comptes`);
  return new Map((r.rows as LigneCompte[]).map((l) => [l.canal, l]));
}

function routesComptes(app: FastifyInstance) {
  app.get("/canaux/comptes", async (request) => {
    const auth = exiger(request, "canaux.lire");
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const comptes = await lireComptes(db);
      return {
        elements: (["whatsapp", "sms"] as const).map((c) => vueCompte(app, c, comptes.get(c))),
      };
    });
  });

  app.put("/canaux/comptes/:canal", async (request) => {
    const auth = exiger(request);
    const { canal } = canalParamSchema.parse(request.params);
    const corps = compteCanalModificationSchema.parse(request.body);
    // Désactiver (coupe-circuit par canal) : `canaux.gerer` ; tout le reste : `canaux.configurer`.
    exiger(request, estDesactivationCanalSeule(corps) ? "canaux.gerer" : "canaux.configurer");
    const { mot_de_passe, code, code_secours, ...champs } = corps;
    const modif = Object.fromEntries(Object.entries(champs).filter(([, v]) => v !== undefined));
    const ecrire = async (db: Db) => {
      const existant = await db.query(
        `SELECT ${COLONNES_COMPTE} FROM canaux_comptes WHERE canal = $1 FOR UPDATE`,
        [canal],
      );
      if (existant.rows[0]) {
        const set = clauseSet(modif, 3);
        await db.query(
          `UPDATE canaux_comptes SET ${set.sql}, modifie_par = $2, modifie_le = now() WHERE canal = $1`,
          [canal, auth.utilisateurId, ...set.valeurs],
        );
      } else {
        await db.query(
          `INSERT INTO canaux_comptes (cabinet_id, canal, identifiant_compte, actif, repli_sms,
             relance_questionnaire_j10, synthese_hebdo, saisie_kpi, modifie_par)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            auth.cabinetId,
            canal,
            `cpt-${randomBytes(8).toString("hex")}`,
            champs.actif ?? false,
            champs.repli_sms ?? true,
            champs.relance_questionnaire_j10 ?? true,
            champs.synthese_hebdo ?? false,
            champs.saisie_kpi ?? false,
            auth.utilisateurId,
          ],
        );
      }
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "canal.compte.modifier",
        entite: "canal_compte",
        entiteId: null,
        details: { canal, champs: modif },
      });
      return vueCompte(app, canal, (await lireComptes(db)).get(canal));
    };
    if (corps.actif === true) {
      if (portDe(app, canal) === null) throw canalNonActif();
      // Activation : reconfirmation d'identité (mot de passe seul admis sans 2FA active), même transaction.
      return serviceIdentite(app).confirmerIdentite(
        auth,
        { mot_de_passe, code, code_secours },
        "canal_activation",
        (db) => ecrire(db),
        { motDePasseSeulSiInactive: true },
      );
    }
    return app.db.withTenant(auth.cabinetId, ecrire);
  });
}

function routesDestinataires(app: FastifyInstance) {
  app.get("/canaux/destinataires", async (request) => {
    const auth = exiger(request, "canaux.lire");
    const q = destinatairesQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const client = await db.query("SELECT 1 FROM clients WHERE id = $1", [q.client_id]);
      if (!client.rows[0]) throw introuvable("Client");
      const { lignes, suivant } = await listerDestinatairesClient(db, q.client_id, apres, q.limite);
      return {
        elements: lignes,
        curseur_suivant: suivant ? encoderCurseur(suivant) : null,
      };
    });
  });

  app.put("/canaux/destinataires/:utilisateurId/:canal", async (request) => {
    const auth = exiger(request, "canaux.gerer");
    const { utilisateurId, canal } = canalUtilisateurParamSchema.parse(request.params);
    const corps = numeroDestinataireSchema.parse(request.body);
    const d = deps(app);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerUtilisateurClient(db, utilisateurId);
      const quand = maintenant();
      const numero = await controlerAvantNumero(db, d, {
        utilisateurId,
        canal,
        numeroSaisi: corps.numero,
        maintenant: quand,
      });
      const r = await ecrireNumero(db, d, {
        acteur: auth,
        utilisateurId,
        canal,
        numero,
        maintenant: quand,
      });
      if (r.code) {
        await planifierCode(db, d, {
          cabinetId: auth.cabinetId,
          destinataireId: r.destinataire.id,
          canal,
          code: r.code,
          maintenant: quand,
        });
      }
      return { destinataire: r.destinataire, code_envoye: r.code !== null };
    });
  });

  app.post("/canaux/destinataires/:id/verification", async (request) => {
    const auth = exiger(request, "canaux.gerer");
    const { id } = idCanauxParamSchema.parse(request.params);
    const corps = codeVerificationNumeroSchema.parse(request.body);
    const d = deps(app);
    const resultat = await app.db.withTenant(auth.cabinetId, async (db) => {
      const dest = await exigerDestinataire(db, id);
      return verifierCodeNumero(db, d, {
        cabinetId: auth.cabinetId,
        destinataireId: id,
        canal: dest.canal,
        code: corps.code,
        maintenant: maintenant(),
        acteurId: auth.utilisateurId,
      });
    });
    // Erreur levée APRÈS la validation de la transaction : un échec de code est bien compté.
    const erreur = erreurDeVerification(resultat);
    if (erreur) throw erreur;
    return { verifie: true };
  });

  app.post("/canaux/destinataires/:id/consentements", async (request) => {
    const auth = exiger(request, "canaux.gerer");
    const { id } = idCanauxParamSchema.parse(request.params);
    const corps = consentementCabinetSchema.parse(request.body);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const verrou = await verrouillerDestinataire(db, id, "UPDATE");
      if (!verrou) throw introuvable("Destinataire");
      if (corps.statut === "accorde") {
        if (verrou.verifie_le === null) throw consentementRequis();
        await ajouterConsentement(db, {
          cabinetId: auth.cabinetId,
          destinataireId: id,
          canal: verrou.canal,
          statut: "accorde",
          source: "recueilli_cabinet",
          acteurId: auth.utilisateurId,
          referencePreuve: corps.reference_preuve as string,
        });
      } else {
        // Un retrait n'est jamais refusé : effet immédiat.
        await retirerConsentement(db, {
          cabinetId: auth.cabinetId,
          destinataireId: id,
          canal: verrou.canal,
          source: "retrait_cabinet",
          acteurId: auth.utilisateurId,
        });
      }
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action:
          corps.statut === "accorde" ? "canal.consentement.accorder" : "canal.consentement.retirer",
        entite: "canal_destinataire",
        entiteId: id,
        details: {
          canal: verrou.canal,
          source: corps.statut === "accorde" ? "recueilli_cabinet" : "retrait_cabinet",
        },
      });
      const etat = await consentementCourant(db, id);
      return { consentement: etat.statut, source: etat.source, consentement_le: etat.cree_le };
    });
  });

  app.get("/canaux/destinataires/:id/consentements", async (request) => {
    const auth = exiger(request, "canaux.lire");
    const { id } = idCanauxParamSchema.parse(request.params);
    const q = consentementsQuerySchema.parse(request.query);
    const apres = decoderCurseurId(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      await exigerDestinataire(db, id);
      const r = await db.query(
        `SELECT id::text AS id, statut, source, mention_version, reference_preuve, cree_le
         FROM canaux_consentements
         WHERE destinataire_id = $1 AND ($2::bigint IS NULL OR id < $2::bigint)
         ORDER BY id DESC LIMIT $3`,
        [id, apres, q.limite + 1],
      );
      const page = r.rows.slice(0, q.limite);
      const dernier = page[page.length - 1] as { id: string } | undefined;
      return {
        elements: page,
        curseur_suivant: r.rows.length > q.limite && dernier ? encoderCurseurId(dernier.id) : null,
      };
    });
  });
}

function routesEnvois(app: FastifyInstance) {
  app.get("/canaux/envois", async (request) => {
    const auth = exiger(request, "canaux.lire");
    const q = envoisCanauxQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    const finance = aPermission(auth.roles, "finance.lire");
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const lignes = await listerEnvois(db, q, apres, q.limite);
      const page = paginer(lignes, q.limite);
      return {
        elements: page.elements.map(({ cout_estime_micro_usd: cout, ...reste }) => ({
          ...reste,
          // FIN-02 : le coût est ABSENT sans `finance.lire`, jamais masqué par un zéro.
          ...(finance ? { cout_estime_micro_usd: cout === null ? null : Number(cout) } : {}),
        })),
        curseur_suivant: page.curseur_suivant,
      };
    });
  });

  app.get("/canaux/synthese-dirigeant/apercu", async (request) => {
    const auth = exiger(request, "canaux.lire");
    const q = apercuSyntheseQuerySchema.parse(request.query);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const client = await db.query("SELECT 1 FROM clients WHERE id = $1", [q.client_id]);
      if (!client.rows[0]) throw introuvable("Client");
      const dest = await db.query(
        `SELECT up.client_id, u.id AS utilisateur_id FROM utilisateurs u
         JOIN utilisateurs_portail up ON up.utilisateur_id = u.id AND up.statut = 'actif'
         WHERE u.id = $1 AND up.client_id = $2 AND u.actif AND 'client_dirigeant' = ANY (u.roles)`,
        [q.destinataire_id, q.client_id],
      );
      if (!dest.rows[0]) throw introuvable("Destinataire");
      await verifierDebit(db, auth, "apercu_synthese");
      const a = await apercuSynthese(app.db, db, {
        cabinetId: auth.cabinetId,
        clientId: q.client_id,
        utilisateurId: q.destinataire_id,
        date: maintenant().toISOString().slice(0, 10),
        origineWeb: new URL(app.config.WEB_ORIGIN).origin,
      });
      // N'envoie RIEN et ne crée AUCUNE ligne d'envoi : seule la ligne d'audit de l'aperçu.
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "canal.synthese.apercu",
        entite: "client",
        entiteId: q.client_id,
        details: {},
      });
      return {
        points_attention: a.synthese.pointsAttention,
        decisions_attendues: a.synthese.decisionsAttendues,
        vide: a.synthese.vide,
        sections: a.synthese.sections,
        mode_fournisseur: "simule" as const,
        texte_message: a.texteMessage,
      };
    });
  });
}

function routesSaisies(app: FastifyInstance) {
  app.get("/canaux/saisies-kpi", async (request) => {
    const auth = exiger(request, "kpi.saisir");
    const q = saisiesKpiQuerySchema.parse(request.query);
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const lignes = await listerSaisies(db, auth, q.statut, apres, q.limite);
      return paginer(lignes, q.limite);
    });
  });

  app.post("/canaux/saisies-kpi/:id/reprendre", async (request) => {
    const auth = exiger(request, "kpi.saisir");
    const { id } = idCanauxParamSchema.parse(request.params);
    const corps = saisieKpiRepriseSchema.parse(request.body);
    const r = await app.db.withTenant(auth.cabinetId, (db) => reprendreSaisie(db, auth, id, corps));
    await evaluerApresSaisie(app, auth.cabinetId, r.kpiId, request.log);
    return { statut: "reprise", mesure_id: r.mesureId };
  });

  app.post("/canaux/saisies-kpi/:id/rejeter", async (request) => {
    const auth = exiger(request, "kpi.saisir");
    const { id } = idCanauxParamSchema.parse(request.params);
    const corps = saisieKpiRejetSchema.parse(request.body);
    await app.db.withTenant(auth.cabinetId, (db) => rejeterSaisie(db, auth, id, corps.motif));
    return { statut: "rejetee_cabinet" };
  });
}

/** « Moi » : l'utilisateur du cabinet gère SES numéros et SES consentements (`canaux.moi`). */
function routesMoi(app: FastifyInstance) {
  app.get("/canaux/moi", async (request) => {
    const auth = exiger(request, "canaux.moi");
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const comptes = await lireComptes(db);
      const mes = await lireMesNumeros(db, auth.utilisateurId);
      return {
        elements: mes.map((m) => ({
          canal: m.canal,
          mode_fournisseur: "simule" as const,
          canal_actif: comptes.get(m.canal)?.actif === true && portDe(app, m.canal) !== null,
          numero_masque: m.numero_masque,
          verifie: m.verifie,
          consentement: m.consentement,
          mention: (({ version, texte }) => ({ version, texte }))(mentionEnVigueur(m.canal)),
        })),
      };
    });
  });

  app.put("/canaux/moi/:canal", async (request) => {
    const auth = exiger(request, "canaux.moi");
    const { canal } = canalParamSchema.parse(request.params);
    const corps = preferenceCanalPortailSchema.parse(request.body);
    const mention = exigerMentionCourante(canal, corps.mention_version);
    const d = deps(app);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const quand = maintenant();
      let enregistre: Awaited<ReturnType<typeof ecrireNumero>> | null = null;
      if (corps.numero !== undefined) {
        const numero = await controlerAvantNumero(db, d, {
          utilisateurId: auth.utilisateurId,
          canal,
          numeroSaisi: corps.numero,
          maintenant: quand,
        });
        enregistre = await ecrireNumero(db, d, {
          acteur: auth,
          utilisateurId: auth.utilisateurId,
          canal,
          numero,
          maintenant: quand,
        });
        if (enregistre.code) {
          await planifierCode(db, d, {
            cabinetId: auth.cabinetId,
            destinataireId: enregistre.destinataire.id,
            canal,
            code: enregistre.code,
            maintenant: quand,
          });
        }
      }
      const dest = await db.query(
        "SELECT id, verifie_le FROM canaux_destinataires WHERE utilisateur_id = $1 AND canal = $2 FOR UPDATE",
        [auth.utilisateurId, canal],
      );
      const ligne = dest.rows[0] as { id: string; verifie_le: Date | null } | undefined;
      if (!ligne) throw consentementRequis();
      let consentement = (await consentementCourant(db, ligne.id)).statut;
      // Le consentement ne s'accorde que sur un numéro VÉRIFIÉ (MPH02) : sinon, code à saisir d'abord.
      if (ligne.verifie_le !== null && consentement !== "accorde") {
        await ajouterConsentement(db, {
          cabinetId: auth.cabinetId,
          destinataireId: ligne.id,
          canal,
          statut: "accorde",
          source: "portail",
          acteurId: auth.utilisateurId,
          mention,
        });
        await journaliser(db, {
          cabinetId: auth.cabinetId,
          utilisateurId: auth.utilisateurId,
          action: "canal.consentement.accorder",
          entite: "canal_destinataire",
          entiteId: ligne.id,
          details: { canal, source: "portail", mention: mention.version },
        });
        consentement = "accorde";
      }
      return {
        canal,
        verifie: ligne.verifie_le !== null,
        consentement,
        code_envoye: enregistre?.code != null,
      };
    });
  });

  app.post("/canaux/moi/:canal/verification", async (request) => {
    const auth = exiger(request, "canaux.moi");
    const { canal } = canalParamSchema.parse(request.params);
    const corps = codeVerificationNumeroSchema.parse(request.body);
    const d = deps(app);
    const resultat = await app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        "SELECT id FROM canaux_destinataires WHERE utilisateur_id = $1 AND canal = $2",
        [auth.utilisateurId, canal],
      );
      if (!r.rows[0]) throw introuvable("Numéro");
      return verifierCodeNumero(db, d, {
        cabinetId: auth.cabinetId,
        destinataireId: r.rows[0].id as string,
        canal,
        code: corps.code,
        maintenant: maintenant(),
        acteurId: auth.utilisateurId,
      });
    });
    const erreur = erreurDeVerification(resultat);
    if (erreur) throw erreur;
    return { verifie: true };
  });

  app.post("/canaux/moi/:canal/retrait", async (request) => {
    const auth = exiger(request, "canaux.moi");
    const { canal } = canalParamSchema.parse(request.params);
    corpsVideCanauxSchema.parse(request.body ?? {});
    return app.db.withTenant(auth.cabinetId, async (db) => {
      const r = await db.query(
        "SELECT id FROM canaux_destinataires WHERE utilisateur_id = $1 AND canal = $2 FOR UPDATE",
        [auth.utilisateurId, canal],
      );
      if (!r.rows[0]) return { consentement: "absent" as const };
      const id = r.rows[0].id as string;
      const retire = await retirerConsentement(db, {
        cabinetId: auth.cabinetId,
        destinataireId: id,
        canal,
        source: "retrait_portail",
        acteurId: auth.utilisateurId,
      });
      if (retire) {
        await journaliser(db, {
          cabinetId: auth.cabinetId,
          utilisateurId: auth.utilisateurId,
          action: "canal.consentement.retirer",
          entite: "canal_destinataire",
          entiteId: id,
          details: { canal, source: "retrait_portail" },
        });
      }
      return { consentement: (await consentementCourant(db, id)).statut };
    });
  });
}

/**
 * Simulateur de développement : enregistré SEULEMENT en mode simulé ET en contexte local (sinon ces
 * routes n'existent pas : 404). Il fabrique des événements SIGNÉS (HMAC) et les envoie à la route du
 * webhook par `app.inject` : aucun réseau.
 */
function routesSimulateur(app: FastifyInstance) {
  app.get("/canaux/simulateur/boite", async (request) => {
    exiger(request, "canaux.configurer");
    const messages = [
      ...(app.canaux.whatsapp instanceof CanalWhatsAppSimule ? app.canaux.whatsapp.boite : []).map(
        (m) => ({ canal: "whatsapp" as const, m }),
      ),
      ...(app.canaux.sms instanceof PasserelleSmsSimulee ? app.canaux.sms.boite : []).map((m) => ({
        canal: "sms" as const,
        m,
      })),
    ];
    return {
      elements: messages
        .map(({ canal, m }) => ({
          id_externe: m.idExterne,
          canal,
          gabarit: m.gabarit,
          numero_masque: normaliserNumeroMasque(m.numero),
          texte: m.texte,
          instant: m.instant,
        }))
        .sort((a, b) => b.instant.getTime() - a.instant.getTime()),
    };
  });

  app.post("/canaux/simulateur/entrant", async (request) => {
    const auth = exiger(request, "canaux.configurer");
    const corps = simulateurEntrantSchema.parse(request.body);
    const whatsapp = app.canaux.whatsapp;
    const secret = app.config.WHATSAPP_WEBHOOK_SECRET;
    if (!(whatsapp instanceof CanalWhatsAppSimule) || !secret) throw canalNonActif();
    const identifiant = await app.db.withTenant(auth.cabinetId, async (db) => {
      await verifierDebit(db, auth, "simulateur");
      const c = await db.query(
        "SELECT identifiant_compte FROM canaux_comptes WHERE canal = 'whatsapp' AND actif",
      );
      if (!c.rows[0]) throw canalNonActif();
      await journaliser(db, {
        cabinetId: auth.cabinetId,
        utilisateurId: auth.utilisateurId,
        action: "canal.simulateur.entrant",
        entite: "canal_compte",
        entiteId: null,
        details: { type: corps.type },
      });
      return c.rows[0].identifiant_compte as string;
    });
    const evenement = `sim-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    let charge: Record<string, unknown>;
    if (corps.type === "statut") {
      charge = {
        compte: identifiant,
        evenement,
        type: "statut",
        id_externe_message: corps.id_externe,
        statut: corps.statut,
      };
    } else {
      // Numéro de test seulement : un numéro réel est refusé (400), comme à l'enregistrement.
      const numero = numeroAcceptable(app.canaux, "whatsapp", corps.numero);
      if ("texte" in corps) {
        charge = {
          compte: identifiant,
          evenement,
          type: "message",
          numero,
          recu_le: new Date().toISOString(),
          genre: "texte",
          texte: corps.texte,
        };
      } else {
        const ref = `media-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
        const duree = corps.duree_ms ?? 4000;
        whatsapp.deposerMedia(identifiant, ref, {
          contenu: fabriquerConteneurAudioSimule({
            texte: corps.audio_texte,
            dureeMs: duree,
            confiance: 900,
          }),
          typeMime: "audio/ogg",
        });
        charge = {
          compte: identifiant,
          evenement,
          type: "message",
          numero,
          recu_le: new Date().toISOString(),
          genre: "audio",
          ref_media: ref,
          type_mime: "audio/ogg",
          duree_ms: duree,
        };
      }
    }
    const corpsBrut = JSON.stringify(charge);
    const reponse = await app.inject({
      method: "POST",
      url: "/api/canaux/whatsapp/webhook",
      headers: signerWebhook(corpsBrut, secret, Math.floor(Date.now() / 1000)),
      payload: corpsBrut,
    });
    if (reponse.statusCode !== 200)
      throw new AppError(409, "SIMULATEUR_REFUSE", "Le webhook a refusé l'événement simulé.");
    return { recus: (reponse.json() as { recus: number }).recus };
  });
}

function normaliserNumeroMasque(numero: string): string {
  try {
    const n = normaliserNumero(numero);
    return `${n.slice(0, 4)}…${n.slice(-2)}`;
  } catch {
    return "…";
  }
}

export const routesCanaux: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    throw traduireErreurCanaux(error);
  });
  routesComptes(app);
  routesDestinataires(app);
  routesEnvois(app);
  routesSaisies(app);
  routesMoi(app);
  // Simulateur : jamais hors développement local avec un fournisseur simulé.
  if (
    canalActif(app.canaux) &&
    app.canaux.whatsapp instanceof CanalWhatsAppSimule &&
    contexteCanauxSimulesAdmis(app.config)
  ) {
    routesSimulateur(app);
  }
};

void LIBELLES_CANAL;
void conflit;
void interdit;
void envoyerEmails;
void ENTETE_HORODATAGE;
