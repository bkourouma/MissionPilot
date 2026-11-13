import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { Carte } from "../../../../../components/ui/Carte";
import { droitsMission, estSignee, saisieDepuisMission } from "../../../../../lib/missions";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { optionsPersonnes } from "../../../../../lib/personnes";
import { chargerPersonnes, chargerTypesActifs } from "../../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../../lib/session";
import { FormulaireMission } from "../../FormulaireMission";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Modifier la mission", "Edit the engagement") };
}

export default async function PageModifierMission({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await exigerPermission("mission.creer");
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const droits = droitsMission(m, utilisateur.roles, utilisateur.id, langue);
  if (!droits.modifier) redirect(`/missions/${id}`);
  const [types, personnes] = await Promise.all([
    chargerTypesActifs(utilisateur.roles),
    chargerPersonnes(utilisateur.roles),
  ]);
  return (
    <Carte titre={t("Modifier la fiche", "Edit the engagement sheet")}>
      <FormulaireMission
        mission={m}
        saisieInitiale={saisieDepuisMission(m)}
        signee={estSignee(m.statut)}
        clients={[]}
        types={types}
        personnes={optionsPersonnes(personnes)}
        voitToutes={aPermission(utilisateur.roles, "mission.lire_toutes")}
        reaffecter={droits.reaffecter}
        designerDirecteur={droits.designerDirecteur}
      />
    </Carte>
  );
}
