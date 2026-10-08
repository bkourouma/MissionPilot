import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import type { Collaborateur, Grade } from "../../../../../lib/collaborateurs";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { exigerPermission } from "../../../../../lib/session";
import { FormulaireCollaborateur } from "../../FormulaireCollaborateur";

export const metadata: Metadata = { title: "Modifier un collaborateur" };

export default async function PageModifierCollaborateur({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
        titre={r.ok ? `Modifier ${r.donnees.nom}` : "Modifier un collaborateur"}
        retour={{ href: `/collaborateurs/${id}`, libelle: "Fiche collaborateur" }}
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
          titre="La fiche du collaborateur n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={`/collaborateurs/${id}/modifier`}
        />
      )}
    </div>
  );
}
