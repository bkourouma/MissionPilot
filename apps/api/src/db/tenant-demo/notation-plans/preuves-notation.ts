import type { ContexteTenantDemo } from "../contexte.js";
import {
  REGISTRE_BRASSERIES,
  REGISTRE_SAHEL_COTON,
  REGISTRE_SICAFE,
} from "./preuves-notation-donnees-a.js";
import {
  REGISTRE_ATLANTIQUE,
  REGISTRE_BANQUE,
  REGISTRE_BAOBAB,
} from "./preuves-notation-donnees-b.js";
import { semerRegistreNotation } from "./preuves-notation-ecriture.js";

/*
 * Étape « preuves-notation » de la phase « notation-plans » : registre de preuves aligné sur les
 * dimensions de la grille de chaque mission notée (1, 2, 3, 5, 6 et 9), AVANT les notations.
 *
 * Pourquoi : l'indice de confiance d'une notation (notation/confiance.ts) ne retient que les
 * affirmations RETENUES rattachées à une dimension DE LA GRILLE ; le registre des autres lots
 * (redressement-dd) utilise ses propres codes et passe après, alors que la confiance est calculée
 * et enregistrée à la publication. Sans cette étape, la solidité des preuves serait nulle.
 *
 * Par mission : 10 dimensions de registre (celles de la grille), 6 preuves de types et fiabilités
 * variés, 8 affirmations « retenue » à deux liens « pour » de types distincts, 1 affirmation
 * partiellement étayée (une preuve fragile) et 1 dimension sans affirmation. Les missions
 * terminées (1, 2, 3, 5) sont antidatées entre 5 % et 40 % de leur durée ; 6 et 9 ne le sont pas.
 * Codes de dimension sans collision avec ceux du registre de redressement-dd.
 */
export async function semerPreuvesNotation(ctx: ContexteTenantDemo): Promise<void> {
  const registres = [
    REGISTRE_SICAFE,
    REGISTRE_SAHEL_COTON,
    REGISTRE_BRASSERIES,
    REGISTRE_ATLANTIQUE,
    REGISTRE_BAOBAB,
    REGISTRE_BANQUE,
  ];
  for (const def of registres) await semerRegistreNotation(ctx, def);
}
