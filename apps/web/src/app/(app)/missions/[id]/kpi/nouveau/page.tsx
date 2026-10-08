import Link from "next/link";
import type { Metadata } from "next";
import { FormulaireKpi } from "../../../../../../components/kpi/FormulaireKpi";
import "../../../../../../components/kpi/kpi.css";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { classesBouton } from "../../../../../../components/ui/Bouton";
import { Carte } from "../../../../../../components/ui/Carte";
import { candidatsProprietaire, droitsKpi, hrefTableauKpi } from "../../../../../../lib/kpi";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import { aujourdhui } from "../../../../../../lib/periode";
import { chargerPersonnes } from "../../../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../../../lib/session";

export const metadata: Metadata = { title: "Nouveau KPI" };

/** Définition d'un nouveau KPI de la mission (KPI-01) : directeur, chef ou associé. */
export default async function PageNouveauKpi({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("kpi.gerer");
  const r = await chargerMission(id);
  // L'en-tête (layout) affiche déjà l'erreur de chargement de la mission.
  if (!r.ok) return null;
  const m = r.donnees;
  const droits = droitsKpi(utilisateur.roles, utilisateur.id, m);
  const retour = (
    <Link href={hrefTableauKpi(m.id)} className={classesBouton("secondaire")}>
      Revenir au tableau de bord
    </Link>
  );
  if (!droits.gerer) {
    return (
      <div className="mp-kpi">
        <Alerte tonalite="info" titre="Création non disponible" annonce="aucune">
          <p>
            {m.statut === "cloturee"
              ? "La mission est clôturée : ses KPI ne se modifient plus."
              : "Seuls le directeur, le chef de mission et les personnes qui modifient toutes les missions définissent les KPI d'une mission."}
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
      <Carte titre="Nouveau KPI">
        <FormulaireKpi
          missionId={m.id}
          proprietaires={candidatsProprietaire(m, noms)}
          aujourdhui={aujourdhui()}
        />
      </Carte>
    </div>
  );
}
