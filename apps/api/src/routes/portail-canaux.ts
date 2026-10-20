import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { composerSyntheseDirigeant } from "@missionpilot/engines";
import {
  canalParamSchema,
  codeVerificationNumeroSchema,
  corpsVideCanauxSchema,
  preferenceCanalPortailSchema,
  type CanalMessagerie,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import { trousseauDepuisConfig } from "../auth/chiffrement.js";
import {
  ajouterConsentement,
  consentementCourant,
  exigerMentionCourante,
  mentionEnVigueur,
  retirerConsentement,
} from "../canaux/consentements.js";
import {
  controlerAvantNumero,
  ecrireNumero,
  erreurDeVerification,
  lireMesNumeros,
  planifierCode,
  verifierCodeNumero,
  type DependancesDestinataires,
} from "../canaux/destinataires.js";
import { consentementRequis, traduireErreurCanaux } from "../canaux/erreurs.js";
import { lireFaitsSynthese } from "../canaux/synthese-sources.js";
import type { Db } from "../db/pool.js";
import { introuvable } from "../errors.js";
import {
  avecPortail,
  exigerPortail,
  journaliserPortail,
  type AccesPortail,
} from "../portail/acces.js";
import { horsContextePortail } from "../portail/contexte.js";

/*
 * Canaux simulés côté portail (lot 3c, SPEC-3c §10.2 n° 31 à 34 et 40, §12.3) : le dirigeant ou le
 * contributeur gère SES numéros WhatsApp et SMS et son consentement ; le dirigeant lit sa synthèse
 * hebdomadaire. Règles du portail : permission `portail.*`, lectures et écritures de SA ligne dans
 * `avecPortail` (RLS), numéro MASQUÉ seulement, aucune donnée du cabinet. La table des envois et des
 * tâches est fermée au contexte du portail : la mise en file du code de vérification et la lecture du
 * compte de canal passent par `horsContextePortail`, sortie inventoriée (test/portail-contexte.test.ts),
 * après un contrôle fait DANS `avecPortail`, avec des filtres explicites sur l'utilisateur.
 */

const maintenant = () => new Date();

function deps(app: FastifyInstance): DependancesDestinataires {
  return { trousseau: trousseauDepuisConfig(app.config), canaux: app.canaux };
}

const portDe = (app: FastifyInstance, canal: CanalMessagerie) =>
  canal === "whatsapp" ? app.canaux.whatsapp : app.canaux.sms;

/** Comptes de canal actifs du cabinet (lecture interne, hors contexte du portail : un booléen par canal). */
async function canauxActifs(
  app: FastifyInstance,
  acces: AccesPortail,
): Promise<Record<CanalMessagerie, boolean>> {
  return horsContextePortail(() =>
    app.db.withTenant(acces.auth.cabinetId, async (db) => {
      const r = await db.query("SELECT canal, actif FROM canaux_comptes");
      const actifs = new Set(
        (r.rows as { canal: CanalMessagerie; actif: boolean }[])
          .filter((c) => c.actif)
          .map((c) => c.canal),
      );
      return { whatsapp: actifs.has("whatsapp"), sms: actifs.has("sms") };
    }),
  );
}

export const routesPortailCanaux: FastifyPluginAsync = async (app) => {
  app.setErrorHandler(async (error) => {
    throw traduireErreurCanaux(error);
  });

  app.get("/portail/canaux/moi", async (request) => {
    const acces = exigerPortail(request, "portail.canaux.gerer");
    const actifs = await canauxActifs(app, acces);
    return avecPortail(app, acces, async (db) => {
      const mes = await lireMesNumeros(db, acces.auth.utilisateurId);
      await journaliserPortail(db, acces, "portail_lecture", "canal_preferences", null);
      return {
        elements: mes.map((m) => ({
          canal: m.canal,
          mode_fournisseur: "simule" as const,
          canal_actif: actifs[m.canal] && portDe(app, m.canal) !== null,
          numero_masque: m.numero_masque,
          verifie: m.verifie,
          consentement: m.consentement,
          mention: (({ version, texte }) => ({ version, texte }))(mentionEnVigueur(m.canal)),
        })),
      };
    });
  });

  app.put("/portail/canaux/moi/:canal", async (request) => {
    const acces = exigerPortail(request, "portail.canaux.gerer");
    const { canal } = canalParamSchema.parse(request.params);
    const corps = preferenceCanalPortailSchema.parse(request.body);
    const mention = exigerMentionCourante(canal, corps.mention_version);
    const d = deps(app);
    const quand = maintenant();
    const utilisateurId = acces.auth.utilisateurId;
    // 1. Contrôles qui lisent le compte de canal (fermé au portail) : hors contexte, sans rien écrire.
    let numero: string | null = null;
    if (corps.numero !== undefined) {
      const saisi = corps.numero;
      numero = await horsContextePortail(() =>
        app.db.withTenant(acces.auth.cabinetId, (db) =>
          controlerAvantNumero(db, d, {
            utilisateurId,
            canal,
            numeroSaisi: saisi,
            maintenant: quand,
          }),
        ),
      );
    }
    // 2. Écriture de SA ligne et de SES consentements, dans le contexte du portail.
    const ecrit = await avecPortail(app, acces, async (db) => {
      let code: string | null = null;
      if (numero !== null) {
        const r = await ecrireNumero(db, d, {
          acteur: acces.auth,
          utilisateurId,
          canal,
          numero,
          maintenant: quand,
        });
        code = r.code;
      }
      const l = await db.query(
        `SELECT id, verifie_le FROM canaux_destinataires WHERE utilisateur_id = $1 AND canal = $2 FOR UPDATE`,
        [utilisateurId, canal],
      );
      const ligne = l.rows[0] as { id: string; verifie_le: Date | null } | undefined;
      if (!ligne) throw consentementRequis();
      let consentement = (await consentementCourant(db, ligne.id)).statut;
      // Le consentement ne s'accorde que sur un numéro VÉRIFIÉ ; sinon, le code à saisir d'abord.
      if (ligne.verifie_le !== null && consentement !== "accorde") {
        await ajouterConsentement(db, {
          cabinetId: acces.auth.cabinetId,
          destinataireId: ligne.id,
          canal,
          statut: "accorde",
          source: "portail",
          acteurId: utilisateurId,
          mention,
        });
        await journaliser(db, {
          cabinetId: acces.auth.cabinetId,
          utilisateurId,
          action: "canal.consentement.accorder",
          entite: "canal_destinataire",
          entiteId: ligne.id,
          details: { canal, source: "portail", mention: mention.version, portail: true },
        });
        consentement = "accorde";
      }
      return { destinataireId: ligne.id, verifie: ligne.verifie_le !== null, consentement, code };
    });
    // 3. Mise en file du code (accès complet requis), avec filtre explicite sur l'utilisateur.
    if (ecrit.code !== null) {
      const code = ecrit.code;
      await horsContextePortail(() =>
        app.db.withTenant(acces.auth.cabinetId, async (db) => {
          const propre = await db.query(
            "SELECT 1 FROM canaux_destinataires WHERE id = $1 AND utilisateur_id = $2",
            [ecrit.destinataireId, utilisateurId],
          );
          if (!propre.rows[0]) throw introuvable("Numéro");
          await planifierCode(db, d, {
            cabinetId: acces.auth.cabinetId,
            destinataireId: ecrit.destinataireId,
            canal,
            code,
            maintenant: quand,
          });
        }),
      );
    }
    return {
      canal,
      verifie: ecrit.verifie,
      consentement: ecrit.consentement,
      code_envoye: ecrit.code !== null,
    };
  });

  app.post("/portail/canaux/moi/:canal/verification", async (request) => {
    const acces = exigerPortail(request, "portail.canaux.gerer");
    const { canal } = canalParamSchema.parse(request.params);
    const corps = codeVerificationNumeroSchema.parse(request.body);
    const d = deps(app);
    const resultat = await avecPortail(app, acces, async (db) => {
      const r = await db.query(
        "SELECT id FROM canaux_destinataires WHERE utilisateur_id = $1 AND canal = $2",
        [acces.auth.utilisateurId, canal],
      );
      if (!r.rows[0]) throw introuvable("Numéro");
      return verifierCodeNumero(db, d, {
        cabinetId: acces.auth.cabinetId,
        destinataireId: r.rows[0].id as string,
        canal,
        code: corps.code,
        maintenant: maintenant(),
        acteurId: acces.auth.utilisateurId,
      });
    });
    const erreur = erreurDeVerification(resultat);
    if (erreur) throw erreur;
    return { verifie: true };
  });

  app.post("/portail/canaux/moi/:canal/retrait", async (request) => {
    const acces = exigerPortail(request, "portail.canaux.gerer");
    const { canal } = canalParamSchema.parse(request.params);
    corpsVideCanauxSchema.parse(request.body ?? {});
    return avecPortail(app, acces, async (db: Db) => {
      const r = await db.query(
        "SELECT id FROM canaux_destinataires WHERE utilisateur_id = $1 AND canal = $2 FOR UPDATE",
        [acces.auth.utilisateurId, canal],
      );
      if (!r.rows[0]) return { consentement: "absent" as const };
      const id = r.rows[0].id as string;
      // Effet immédiat : un envoi concurrent relit le consentement sous le verrou du destinataire.
      const retire = await retirerConsentement(db, {
        cabinetId: acces.auth.cabinetId,
        destinataireId: id,
        canal,
        source: "retrait_portail",
        acteurId: acces.auth.utilisateurId,
      });
      if (retire) {
        await journaliser(db, {
          cabinetId: acces.auth.cabinetId,
          utilisateurId: acces.auth.utilisateurId,
          action: "canal.consentement.retirer",
          entite: "canal_destinataire",
          entiteId: id,
          details: { canal, source: "retrait_portail", portail: true },
        });
      }
      return { consentement: (await consentementCourant(db, id)).statut };
    });
  });

  // Synthèse hebdomadaire du dirigeant (CLI-07) : mêmes lectures que le portail, jamais un montant.
  app.get("/portail/synthese", async (request) => {
    const acces = exigerPortail(request, "portail.synthese.lire");
    const faits = await horsContextePortail(() =>
      lireFaitsSynthese(app.db, acces.auth.cabinetId, {
        clientId: acces.clientId,
        utilisateurId: acces.auth.utilisateurId,
        date: maintenant().toISOString().slice(0, 10),
      }),
    );
    const s = composerSyntheseDirigeant(faits);
    await avecPortail(app, acces, (db) =>
      journaliserPortail(db, acces, "portail_lecture", "synthese", null),
    );
    return {
      points_attention: s.pointsAttention,
      decisions_attendues: s.decisionsAttendues,
      vide: s.vide,
      sections: s.sections,
    };
  });
};
