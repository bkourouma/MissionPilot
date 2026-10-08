import type { Metadata } from "next";
import { FormulaireAssertion } from "../../../../../../../components/preuves/FormulaireAssertion";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../../components/ui/Carte";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import {
  cheminDimensions,
  droitsPreuves,
  type DimensionVue,
} from "../../../../../../../lib/preuves";
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "Nouvelle assertion" };

/** Formulation d'une assertion (PRV-02). */
export default async function PageNouvelleAssertion({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("preuve.ecrire");
  const r = await chargerMission(id);
  if (!r.ok) return null;
  if (!droitsPreuves(utilisateur.roles, r.donnees).ecrire) {
    return (
      <Alerte tonalite="info" titre="Enregistrement non disponible" annonce="aucune">
        <p>La mission est clôturée : son registre des preuves est figé.</p>
      </Alerte>
    );
  }
  const dimensions = await chargerServeur<{ elements: DimensionVue[] }>(cheminDimensions(id));
  return (
    <Carte titre="Nouvelle assertion">
      <FormulaireAssertion
        missionId={id}
        dimensions={dimensions.ok ? dimensions.donnees.elements : []}
      />
    </Carte>
  );
}
