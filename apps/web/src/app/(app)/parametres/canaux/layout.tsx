import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { BandeauSimule } from "../../../../components/canaux/BandeauSimule";
import { Onglets } from "../../../../components/ui/Onglets";
import { droitsCanaux, estSimule, ongletsCanaux } from "../../../../lib/canaux";
import { chargerComptesCanaux } from "../../../../lib/canaux-serveur";
import { exigerPermission } from "../../../../lib/session";

/**
 * Canaux externes SIMULÉS (lot 3c) : onglets Comptes, Destinataires et consentements, Journal des
 * envois, Saisies reçues et, en développement, Simulateur. Le bandeau « Simulé : aucun envoi réel »
 * reste affiché sur chaque onglet. La source de vérité des droits reste l'API.
 */
export default async function LayoutCanaux({ children }: { children: ReactNode }) {
  const session = await exigerPermission("canaux.lire");
  const comptes = await chargerComptesCanaux();
  const simule = comptes.ok && comptes.donnees.some((c) => estSimule(c.mode_fournisseur));
  const onglets = ongletsCanaux(droitsCanaux(session.utilisateur.roles), { simule });
  if (onglets.length === 0) redirect("/acces-refuse");
  return (
    <div className="mp-pile">
      <BandeauSimule />
      <Onglets libelle="Sections des canaux" pages={onglets} />
      {children}
    </div>
  );
}
