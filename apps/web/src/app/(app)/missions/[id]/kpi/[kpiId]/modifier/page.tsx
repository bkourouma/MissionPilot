import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FormulaireKpi } from "../../../../../../../components/kpi/FormulaireKpi";
import "../../../../../../../components/kpi/kpi.css";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { classesBouton } from "../../../../../../../components/ui/Bouton";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import { estIdentifiant } from "../../../../../../../lib/identifiant";
import {
  candidatsProprietaire,
  cheminKpi,
  droitsKpi,
  hrefKpi,
  hrefModifierKpi,
  type DetailKpi,
} from "../../../../../../../lib/kpi";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { aujourdhui } from "../../../../../../../lib/periode";
import { chargerPersonnes } from "../../../../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "Modifier un KPI" };

/** Modification d'un KPI : sens, nature, fréquence et début de suivi restent figés. */
export default async function PageModifierKpi({
  params,
}: {
  params: Promise<{ id: string; kpiId: string }>;
}) {
  const { id, kpiId } = await params;
  if (!estIdentifiant(kpiId)) notFound();
  const { utilisateur } = await exigerPermission("kpi.gerer");
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const k = await chargerServeur<DetailKpi>(cheminKpi(kpiId));
  if (!k.ok && k.statut === 404) notFound();
  if (!k.ok) {
    return (
      <EtatErreur
        titre="Le KPI n'a pas pu être chargé."
        message={k.message}
        hrefReessayer={hrefModifierKpi(m.id, kpiId)}
      />
    );
  }
  const kpi = k.donnees;
  if (kpi.mission_id !== m.id) notFound();
  const droits = droitsKpi(utilisateur.roles, utilisateur.id, m, kpi);
  const retour = (
    <Link href={hrefKpi(m.id, kpi.id)} className={classesBouton("secondaire")}>
      Revenir au KPI
    </Link>
  );
  if (!droits.gerer) {
    return (
      <div className="mp-kpi">
        <Alerte tonalite="info" titre="Modification non disponible" annonce="aucune">
          <p>
            {m.statut === "cloturee"
              ? "La mission est clôturée : ses KPI ne se modifient plus."
              : "Seuls le directeur, le chef de mission et les personnes qui modifient toutes les missions modifient les KPI d'une mission."}
          </p>
        </Alerte>
        <div>{retour}</div>
      </div>
    );
  }
  const personnes = await chargerPersonnes(utilisateur.roles);
  const noms = new Map(personnes.map((p) => [p.utilisateur_id, p.nom]));
  return (
    <div className="mp-kpi">
      <Carte titre={`Modifier « ${kpi.libelle} »`}>
        <FormulaireKpi
          missionId={m.id}
          initial={kpi}
          proprietaires={candidatsProprietaire(m, noms)}
          aujourdhui={aujourdhui()}
        />
      </Carte>
    </div>
  );
}
