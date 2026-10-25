import type { ContexteTenantDemo } from "../contexte.js";
import { semerM3 } from "./redressement-m3.js";
import { semerM7 } from "./redressement-m7.js";
import {
  parametrerCabinet2025,
  recalibrerServices2026,
  reviserModele2026,
} from "./redressement-parametrage.js";

/*
 * Redressement du cabinet « Tenant démo » (service #5), par les VRAIES routes de l'API et dans
 * l'ordre chronologique fictif. « Aujourd'hui » vaut le 24 octobre 2026.
 *
 *  1. Paramétrage du cabinet (mars 2025) : seuils d'alerte « industrie » et « services » rédigés
 *     par un expert métier et publiés par un autre expert, modèle de check-list du cabinet.
 *  2. Mission 3 « Redressement — Brasseries du Wouri » (mars à novembre 2025) : dossier COMPLET
 *     jusqu'à la clôture validée par le directeur de la mission, rapport de clôture, puis suivi
 *     post-mission (jalons à 6 et 12 mois, un relevé avec écart défavorable).
 *  3. Évolutions du paramétrage (modèle de check-list v2 en février 2026, seuils « services » v2
 *     en juin 2026), avant l'ouverture de la mission 7.
 *  4. Mission 7 « Redressement — Gabon Offshore Services » (depuis juillet 2026) : dossier OUVERT et
 *     vivant (urgence élevée, créanciers en négociation, plan en brouillon avec actions en retard).
 *
 * Les missions du casting existent déjà (aucune n'est créée ici) et les missions 1 à 5 restent
 * ouvertes pendant la phase : aucune réouverture, aucun contournement. Les contenus produits par
 * l'IA sont des brouillons issus du gabarit (aucune clé), jamais validés d'office. Chaque étape est
 * marquée (une exécution par cabinet) ; les modules par thème sont dans redressement-*.ts.
 */
export async function semerRedressement(ctx: ContexteTenantDemo): Promise<void> {
  await parametrerCabinet2025(ctx);
  await semerM3(ctx);
  await reviserModele2026(ctx);
  await recalibrerServices2026(ctx);
  await semerM7(ctx);
}
