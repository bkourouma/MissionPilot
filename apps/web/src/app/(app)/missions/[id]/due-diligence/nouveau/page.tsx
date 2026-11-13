import type { Metadata } from "next";
import { FormulaireCadrage } from "../../../../../../components/due-diligence/FormulaireCadrage";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../../components/ui/EnteteDePage";
import { droitsDd, hrefListeDossiers } from "../../../../../../lib/due-diligence";
import { chargerTaxonomies } from "../../../../../../lib/due-diligence-serveur";
import { obtenirT } from "../../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return {
    title: t("Nouveau dossier de due diligence", "New due diligence file"),
  };
}

/** Création d'un dossier : cadrage de l'opération (DD-01). */
export default async function PageNouveauDossierDd({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await obtenirT();
  const { utilisateur } = await exigerPermission("dd.ecrire");
  const m = await chargerMission(id);
  if (!m.ok) return null;
  const droits = droitsDd(utilisateur.roles, m.donnees);
  if (!droits.ecrire) {
    return (
      <Alerte
        tonalite="info"
        titre={t("Création non disponible", "Creation not available")}
        annonce="aucune"
      >
        <p>
          {t(
            "La mission est clôturée : ses dossiers de due diligence sont figés.",
            "The engagement is closed: its due diligence files are frozen.",
          )}
        </p>
      </Alerte>
    );
  }
  const taxonomies = await chargerTaxonomies();
  return (
    <>
      <EnteteDePage
        titre={t("Nouveau dossier", "New file")}
        soustitre={t(
          "Cadrez l'opération étudiée : elle guidera toutes les analyses du dossier.",
          "Scope the transaction under study: it will guide all the analyses of the file.",
        )}
        retour={{
          href: hrefListeDossiers(id),
          libelle: t("Dossiers de due diligence", "Due diligence files"),
        }}
      />
      <Carte titre={t("Cadrage de l'opération", "Transaction scoping")}>
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
