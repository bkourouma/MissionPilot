import type { ContexteTenantDemo } from "../contexte.js";
import type { Casting } from "./casting.js";
import { semerCloture } from "./collaboration-cloture.js";
import { semerCommentaires } from "./collaboration-commentaires.js";
import { semerFichiersSupprimes } from "./collaboration-fichiers.js";
import { lireActeurs } from "./collaboration-outils.js";
import { semerTaches } from "./collaboration-taches.js";
import { assurerComptesAjoutes } from "./portail-comptes.js";
import { accesPortailParClient } from "./portail-acces.js";
import { semerPartagesEtValidations } from "./portail-partages.js";
import { journalTablesVides } from "./collaboration-verif.js";

/*
 * Module COLLABORATION, PORTAIL CLIENT et tables diverses de la phase `gestion` (lot 2b). Ordre :
 *
 *   1. commentaires (fils, mentions, révisions, suppressions) ;
 *   2. tâches assignées ;
 *   3. portail client : comptes ajoutés (invitations acceptées, en attente, expirée, révoquée),
 *      partages (`portail_partages`, `portail_clients`) et validations de jalons ;
 *   4. check-list de clôture : modèle du cabinet, dérogation, attestations (sans jamais rendre
 *      bloquant un contrôle que les missions terminées ne satisfont pas) ;
 *   5. fichiers supprimés (retrait par l'auteur, purge des orphelins) ;
 *   6. relevé des tables encore vides, en fin de journal.
 *
 * Tout passe par les vraies routes sous le rôle qui en a le droit ; le SQL du propriétaire ne sert
 * qu'à remonter les dates (voir collaboration-outils.ts). Idempotent : chaque étape relit l'existant
 * par clé naturelle. Doit tourner APRÈS le temps, la facturation et les rapports (les factures
 * émises reçoivent un commentaire) et AVANT la clôture des missions terminées.
 */
export async function semerCollaboration(ctx: ContexteTenantDemo, casting: Casting): Promise<void> {
  const acteurs = await lireActeurs(ctx);
  await semerCommentaires(ctx, casting, acteurs);
  await semerTaches(ctx, casting, acteurs);
  await assurerComptesAjoutes(ctx);
  const acces = await accesPortailParClient(ctx);
  await semerPartagesEtValidations(ctx, casting, acces);
  await semerCloture(ctx, casting);
  await semerFichiersSupprimes(ctx);
  await journalTablesVides(ctx);
}
