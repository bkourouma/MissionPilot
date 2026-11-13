import type { CorrectionOcr } from "@missionpilot/shared";
import { formaterMontantMineur, type Devise } from "../../lib/format";
import { libellePosteEtat } from "../../lib/codes-lisibles";
import { LOCALES_INTL } from "@missionpilot/shared";
import { obtenirLangue } from "../../lib/i18n/serveur";
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
export const MENTION_CORRECTION_NON_APPLIQUEE_EN =
  "Proposal: not applied to the statement, to be checked in the document";

/**
 * Corrections proposées par la tolérance aux confusions de lecture (O/0, l/1, virgule/point). Elles
 * ne modifient jamais l'état : le relecteur les vérifie dans le document d'origine. Ne rend rien
 * s'il n'y en a pas.
 */
export async function CorrectionsOcr({ corrections, devise = null }: CorrectionsOcrProps) {
  if (!corrections || corrections.length === 0) return null;
  const langue = await obtenirLangue();
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  const mention = t(MENTION_CORRECTION_NON_APPLIQUEE, MENTION_CORRECTION_NON_APPLIQUEE_EN);
  return (
    <Carte titre={t("Corrections proposées", "Proposed corrections")}>
      <p>
        {t(
          "La lecture a rejeté ces lignes ; une confusion classique de caractères pourrait expliquer le montant lu.",
          "Reading rejected these lines; a classic character confusion could explain the amount read.",
        )}{" "}
        {mention}.
      </p>
      <Tableau
        legende={t(
          "Corrections proposées pour les lignes lues par reconnaissance de caractères",
          "Corrections proposed for lines read by character recognition",
        )}
        lignes={[...corrections]}
        cleLigne={(c) => `${c.page}-${c.code}-${c.texte_lu}`}
        colonnes={[
          {
            cle: "poste",
            entete: t("Poste", "Line item"),
            rendu: (c) => `${libellePosteEtat(c.code, langue)} — ${c.libelle}`,
          },
          { cle: "page", entete: "Page", rendu: (c) => `p. ${c.page}` },
          {
            cle: "texte_lu",
            entete: t("Lu dans le document", "Read in the document"),
            rendu: (c) => c.texte_lu,
          },
          {
            cle: "montant_propose",
            entete: t("Montant proposé", "Proposed amount"),
            alignement: "droite",
            rendu: (c) =>
              devise
                ? formaterMontantMineur(c.montant_propose, devise, langue)
                : `${new Intl.NumberFormat(LOCALES_INTL[langue]).format(c.montant_propose)} ${t("(unités mineures)", "(minor units)")}`,
          },
          {
            cle: "confusions",
            entete: t("Confusions probables", "Likely confusions"),
            rendu: (c) => decrireConfusionsOcr(c.confusions, langue),
          },
          { cle: "mention", entete: t("Statut", "Status"), rendu: () => mention },
        ]}
      />
    </Carte>
  );
}
