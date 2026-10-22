import type { CorrectionOcr } from "@missionpilot/shared";
import { formaterMontantMineur, type Devise } from "../../lib/format";
import { decrireConfusionsOcr } from "../../lib/ingestion";
import { Carte } from "../ui/Carte";
import { Tableau } from "../ui/Tableau";

export interface CorrectionsOcrProps {
  corrections: readonly CorrectionOcr[] | null | undefined;
  /**
   * Devise de l'état pour formater le montant proposé. Absente (détail d'un document, qui ne la porte
   * pas) : le montant est donné en unités mineures, sans symbole.
   */
  devise?: Devise | null;
}

export const MENTION_CORRECTION_NON_APPLIQUEE =
  "Proposition : non appliquée à l'état, à vérifier dans le document";

/**
 * Corrections proposées par la tolérance aux confusions de lecture (O/0, l/1, virgule/point). Elles
 * ne modifient jamais l'état : le relecteur les vérifie dans le document d'origine. Ne rend rien
 * s'il n'y en a pas.
 */
export function CorrectionsOcr({ corrections, devise = null }: CorrectionsOcrProps) {
  if (!corrections || corrections.length === 0) return null;
  return (
    <Carte titre="Corrections proposées">
      <p>
        La lecture a rejeté ces lignes ; une confusion classique de caractères pourrait expliquer le
        montant lu. {MENTION_CORRECTION_NON_APPLIQUEE}.
      </p>
      <Tableau
        legende="Corrections proposées pour les lignes lues par reconnaissance de caractères"
        lignes={[...corrections]}
        cleLigne={(c) => `${c.page}-${c.code}-${c.texte_lu}`}
        colonnes={[
          { cle: "poste", entete: "Poste", rendu: (c) => `${c.code} — ${c.libelle}` },
          { cle: "page", entete: "Page", rendu: (c) => `p. ${c.page}` },
          { cle: "texte_lu", entete: "Lu dans le document", rendu: (c) => c.texte_lu },
          {
            cle: "montant_propose",
            entete: "Montant proposé",
            alignement: "droite",
            rendu: (c) =>
              devise
                ? formaterMontantMineur(c.montant_propose, devise)
                : `${new Intl.NumberFormat("fr-FR").format(c.montant_propose)} (unités mineures)`,
          },
          {
            cle: "confusions",
            entete: "Confusions probables",
            rendu: (c) => decrireConfusionsOcr(c.confusions),
          },
          { cle: "mention", entete: "Statut", rendu: () => MENTION_CORRECTION_NON_APPLIQUEE },
        ]}
      />
    </Carte>
  );
}
