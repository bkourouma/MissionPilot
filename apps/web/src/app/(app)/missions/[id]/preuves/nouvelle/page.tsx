import type { Metadata } from "next";
import { FormulairePreuve } from "../../../../../../components/preuves/FormulairePreuve";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../components/ui/Carte";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import { aujourdhui } from "../../../../../../lib/periode";
import { cheminDimensions, droitsPreuves, type DimensionVue } from "../../../../../../lib/preuves";
import { exigerPermission } from "../../../../../../lib/session";

export const metadata: Metadata = { title: "Nouvelle preuve" };

/** Enregistrement d'une preuve (PRV-01). */
export default async function PageNouvellePreuve({ params }: { params: Promise<{ id: string }> }) {
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
    <Carte titre="Nouvelle preuve">
      <FormulairePreuve
        missionId={id}
        dimensions={dimensions.ok ? dimensions.donnees.elements : []}
        aujourdhui={aujourdhui()}
      />
    </Carte>
  );
}
