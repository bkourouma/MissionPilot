import type { FastifyPluginAsync } from "fastify";
import { briefQuerySchema } from "@missionpilot/shared";
import { trousseauDepuisConfig } from "../auth/chiffrement.js";
import { exiger } from "../auth/contexte.js";
import { calculerBrief } from "../brief/calcul.js";
import { verifierDebitBrief } from "../brief/debit.js";
import { aujourdhui } from "../missions/outils.js";

/**
 * AUT-07 : brief quotidien par rôle (PRD complémentaire §8.3).
 *
 * `GET /api/brief` (`brief.lire`) : ce qui attend la décision de l'utilisateur, ce qui dérive,
 * ce qui est prêt à envoyer. Le brief est un calcul DÉTERMINISTE (moteur `brief` de
 * `packages/engines`, aucun appel IA), établi dans les droits de l'utilisateur connecté : chaque
 * source exige la permission de l'action qu'elle propose et applique la visibilité des missions ;
 * aucun montant sans `finance.lire` (FIN-02) ; aucune validation n'est proposée à qui a rédigé
 * l'élément. Le contenu client n'est jamais recopié (identifiants, numéros et intitulés
 * internes). `?date=AAAA-MM-JJ` (2000 à 2100) rejoue le brief à une autre date. Route fermée au
 * portail client (absente de `LISTE_BLANCHE_PORTAIL`, permission interne).
 *
 * Débit : le calcul est coûteux et la page d'accueil l'appelle à chaque affichage ; au plus
 * REQUETES_BRIEF_PAR_FENETRE appels par utilisateur et par FENETRE_BRIEF_MINUTES minutes
 * (429 `TROP_DE_REQUETES_BRIEF`, compteur en base partagé entre instances : brief/debit.ts), contrôlé avant le calcul.
 */
export const routesBrief: FastifyPluginAsync = async (app) => {
  const trousseau = trousseauDepuisConfig(app.config);
  app.get("/brief", async (request, reply) => {
    const auth = exiger(request, "brief.lire");
    const q = briefQuerySchema.parse(request.query);
    await verifierDebitBrief(app.db, trousseau, auth.utilisateurId);
    const brief = await app.db.withTenant(auth.cabinetId, (db) =>
      calculerBrief(db, auth, q.date ?? aujourdhui()),
    );
    // Réponse personnelle, jamais mise en cache (partagée ni navigateur).
    reply.header("cache-control", "private, no-store");
    return brief;
  });
};
