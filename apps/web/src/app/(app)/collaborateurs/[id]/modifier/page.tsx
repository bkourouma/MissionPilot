import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import type { Collaborateur, Grade } from "../../../../../lib/collaborateurs";
import { obtenirT } from "../../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { exigerPermission } from "../../../../../lib/session";
import { FormulaireCollaborateur } from "../../FormulaireCollaborateur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Modifier un collaborateur", "Edit a team member") };
}

export default async function PageModifierCollaborateur({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = await obtenirT();
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("collaborateurs.ecrire");
  const [r, grades] = await Promise.all([
    chargerServeur<Collaborateur>(`/api/collaborateurs/${id}`),
    aPermission(utilisateur.roles, "catalogue.lire")
      ? chargerServeur<{ elements: Grade[] }>("/api/grades")
      : Promise.resolve(null),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={
          r.ok
            ? t(`Modifier ${r.donnees.nom}`, `Edit ${r.donnees.nom}`)
            : t("Modifier un collaborateur", "Edit a team member")
        }
        retour={{
          href: `/collaborateurs/${id}`,
          libelle: t("Fiche collaborateur", "Team member profile"),
        }}
      />
      {r.ok ? (
        <Carte>
          <FormulaireCollaborateur
            collaborateur={r.donnees}
            grades={grades?.ok ? grades.donnees.elements.filter((g) => g.actif) : null}
          />
        </Carte>
      ) : (
        <EtatErreur
          titre={t(
            "La fiche du collaborateur n'a pas pu être chargée.",
            "The team member profile could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={`/collaborateurs/${id}/modifier`}
        />
      )}
    </div>
  );
}
