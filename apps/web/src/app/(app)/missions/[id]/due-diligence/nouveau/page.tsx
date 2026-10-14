import type { Metadata } from "next";
import { FormulaireCadrage } from "../../../../../../components/due-diligence/FormulaireCadrage";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../../components/ui/EnteteDePage";
import { droitsDd, hrefListeDossiers } from "../../../../../../lib/due-diligence";
import { chargerTaxonomies } from "../../../../../../lib/due-diligence-serveur";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../lib/session";

export const metadata: Metadata = { title: "Nouveau dossier de due diligence" };

/** Création d'un dossier : cadrage de l'opération (DD-01). */
export default async function PageNouveauDossierDd({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("dd.ecrire");
  const m = await chargerMission(id);
  if (!m.ok) return null;
  const droits = droitsDd(utilisateur.roles, m.donnees);
  if (!droits.ecrire) {
    return (
      <Alerte tonalite="info" titre="Création non disponible" annonce="aucune">
        <p>La mission est clôturée : ses dossiers de due diligence sont figés.</p>
      </Alerte>
    );
  }
  const taxonomies = await chargerTaxonomies();
  return (
    <>
      <EnteteDePage
        titre="Nouveau dossier"
        soustitre="Cadrez l'opération étudiée : elle guidera toutes les analyses du dossier."
        retour={{ href: hrefListeDossiers(id), libelle: "Dossiers de due diligence" }}
      />
      <Carte titre="Cadrage de l'opération">
        <FormulaireCadrage
          missionId={id}
          secteurs={taxonomies.secteurs}
          filieres={taxonomies.filieres}
          pays={taxonomies.pays}
          devise={m.donnees.devise}
        />
      </Carte>
    </>
  );
}
