import type { Metadata } from "next";
import { FormulaireAssertion } from "../../../../../../../components/preuves/FormulaireAssertion";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../../components/ui/Carte";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import { obtenirT } from "../../../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import {
  cheminDimensions,
  droitsPreuves,
  peutSignerAvisExpert,
  type DimensionVue,
} from "../../../../../../../lib/preuves";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Nouvelle assertion", "New assertion") };
}

/** Formulation d'une assertion (PRV-02). */
export default async function PageNouvelleAssertion({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await obtenirT();
  const { utilisateur } = await exigerPermission("preuve.ecrire");
  const r = await chargerMission(id);
  if (!r.ok) return null;
  if (!droitsPreuves(utilisateur.roles, r.donnees).ecrire) {
    return (
      <Alerte
        tonalite="info"
        titre={t("Enregistrement non disponible", "Saving is not available")}
        annonce="aucune"
      >
        <p>
          {t(
            "La mission est clôturée : son registre des preuves est figé.",
            "The engagement is closed: its evidence register is frozen.",
          )}
        </p>
      </Alerte>
    );
  }
  const dimensions = await chargerServeur<{ elements: DimensionVue[] }>(cheminDimensions(id));
  return (
    <Carte titre={t("Nouvelle assertion", "New assertion")}>
      <FormulaireAssertion
        missionId={id}
        dimensions={dimensions.ok ? dimensions.donnees.elements : []}
        peutSigner={peutSignerAvisExpert(utilisateur.roles)}
      />
    </Carte>
  );
}
