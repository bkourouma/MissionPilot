import type { Metadata } from "next";
import { Alerte } from "../../../../components/ui/Alerte";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { obtenirT } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";
import { FormulaireGenerationIa } from "./FormulaireGenerationIa";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Générer un questionnaire avec l'IA", "Generate a questionnaire with AI") };
}

/**
 * Génération assistée de questionnaires (SOC-11) : le consultant décrit le besoin, l'IA propose
 * un brouillon (version 1 d'un nouveau modèle) qui s'ouvre dans l'éditeur pour relecture.
 */
export default async function PageGenerationIa() {
  const t = await obtenirT();
  await exigerPermission("questionnaire.gerer");
  await exigerPermission("ia.utiliser");
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={t("Générer un questionnaire avec l'IA", "Generate a questionnaire with AI")}
        soustitre={t(
          "Décrivez le besoin : l'IA propose un brouillon à relire, modifier puis valider avant tout envoi à un client.",
          "Describe the need: the AI proposes a draft to review, edit and approve before anything is sent to a client.",
        )}
        retour={{ href: "/questionnaires", libelle: t("Questionnaires", "Questionnaires") }}
      />
      <Alerte
        tonalite="info"
        titre={t("L'IA propose, l'expert dispose", "AI proposes, the expert decides")}
      >
        <p>
          {t(
            "Le brouillon n'est jamais envoyé tel quel : un consultant autre que son auteur doit le relire et le valider. Sans clé ou si l'IA est désactivée par le cabinet, un questionnaire générique construit sur votre thème est proposé à la place.",
            "The draft is never sent as is: a consultant other than its author must review and approve it. Without a key, or if the AI is disabled by the firm, a generic questionnaire built on your topic is proposed instead.",
          )}
        </p>
      </Alerte>
      <Carte>
        <FormulaireGenerationIa />
      </Carte>
    </div>
  );
}
