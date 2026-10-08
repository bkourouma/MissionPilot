import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import type { TypeMissionDetaille } from "../../../../../lib/catalogue";
import type { Grade } from "../../../../../lib/collaborateurs";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { exigerPermission } from "../../../../../lib/session";
import { FormulaireTypeMission } from "../../FormulaireTypeMission";

export const metadata: Metadata = { title: "Modifier un type de mission" };

export default async function PageModifierType({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  await exigerPermission("catalogue.ecrire");
  const [r, grades] = await Promise.all([
    chargerServeur<TypeMissionDetaille>(`/api/types-mission/${id}`),
    chargerServeur<{ elements: Grade[] }>("/api/grades"),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={r.ok ? `Modifier ${r.donnees.libelle}` : "Modifier un type de mission"}
        retour={{ href: `/catalogue/${id}`, libelle: "Type de mission" }}
      />
      {r.ok ? (
        <Carte>
          <FormulaireTypeMission
            type={r.donnees}
            grades={
              grades.ok
                ? grades.donnees.elements
                    .filter((g) => g.actif)
                    .map((g) => ({ code: g.code, libelle: g.libelle }))
                : []
            }
          />
        </Carte>
      ) : (
        <EtatErreur
          titre="Le type de mission n'a pas pu être chargé."
          message={r.message}
          hrefReessayer={`/catalogue/${id}/modifier`}
        />
      )}
    </div>
  );
}
