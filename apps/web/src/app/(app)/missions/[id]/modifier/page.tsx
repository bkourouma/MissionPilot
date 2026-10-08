import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { Carte } from "../../../../../components/ui/Carte";
import { droitsMission, estSignee, saisieDepuisMission } from "../../../../../lib/missions";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { optionsPersonnes } from "../../../../../lib/personnes";
import { chargerPersonnes, chargerTypesActifs } from "../../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../../lib/session";
import { FormulaireMission } from "../../FormulaireMission";

export const metadata: Metadata = { title: "Modifier la mission" };

export default async function PageModifierMission({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("mission.creer");
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const droits = droitsMission(m, utilisateur.roles, utilisateur.id);
  if (!droits.modifier) redirect(`/missions/${id}`);
  const [types, personnes] = await Promise.all([
    chargerTypesActifs(utilisateur.roles),
    chargerPersonnes(utilisateur.roles),
  ]);
  return (
    <Carte titre="Modifier la fiche">
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
