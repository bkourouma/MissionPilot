import type { Metadata } from "next";
import { Alerte } from "../../../../components/ui/Alerte";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { exigerPermission } from "../../../../lib/session";
import { FormulaireGenerationIa } from "./FormulaireGenerationIa";

export const metadata: Metadata = { title: "Générer un questionnaire avec l'IA" };

/**
 * Génération assistée de questionnaires (SOC-11) : le consultant décrit le besoin, l'IA propose
 * un brouillon (version 1 d'un nouveau modèle) qui s'ouvre dans l'éditeur pour relecture.
 */
export default async function PageGenerationIa() {
  await exigerPermission("questionnaire.gerer");
  await exigerPermission("ia.utiliser");
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre="Générer un questionnaire avec l'IA"
        soustitre="Décrivez le besoin : l'IA propose un brouillon à relire, modifier puis valider avant tout envoi à un client."
        retour={{ href: "/questionnaires", libelle: "Questionnaires" }}
      />
      <Alerte tonalite="info" titre="L'IA propose, l'expert dispose">
        <p>
          Le brouillon n&apos;est jamais envoyé tel quel : un consultant autre que son auteur doit
          le relire et le valider. Sans clé ou si l&apos;IA est désactivée par le cabinet, un
          questionnaire générique construit sur votre thème est proposé à la place.
        </p>
      </Alerte>
      <Carte>
        <FormulaireGenerationIa />
      </Carte>
    </div>
  );
}
