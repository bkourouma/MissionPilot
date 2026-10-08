import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Simulateur } from "../../../../../../components/methodes/Simulateur";
import { EnteteDePage } from "../../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { estIdentifiant } from "../../../../../../lib/identifiant";
import {
  hrefSimulateur,
  hrefVersion,
  type Facteur,
  type VersionDetail,
} from "../../../../../../lib/methodes";
import { exigerPermission } from "../../../../../../lib/session";

export const metadata: Metadata = { title: "Simulateur de modulation" };

/** Simulateur (STD-05) : les règles d'une version appliquées à deux contextes, sans rien enregistrer. */
export default async function PageSimulateur({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  await exigerPermission("standard.lire");
  const [r, f] = await Promise.all([
    chargerServeur<VersionDetail>(`/api/methodes/versions/${id}`),
    chargerServeur<{ elements: Facteur[] }>("/api/standard/facteurs"),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok || !f.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Simulateur" retour={{ href: hrefVersion(id), libelle: "Version" }} />
        <EtatErreur
          titre="Le simulateur n'a pas pu être chargé."
          message={!r.ok ? r.message : !f.ok ? f.message : ""}
          hrefReessayer={hrefSimulateur(id)}
        />
      </div>
    );
  }
  const v = r.donnees;
  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Simulateur de modulation"
        retour={{
          href: hrefVersion(id),
          libelle: `${v.methode.libelle} — version ${v.version.version}`,
        }}
        soustitre={`${v.regles.length} règle(s) de contexte. Renseignez deux contextes : le différentiel montre ce que les règles changent de l'un à l'autre. Rien n'est enregistré.`}
      />
      <Simulateur versionId={id} facteurs={f.donnees.elements} />
    </div>
  );
}
