import Link from "next/link";
import type { Metadata } from "next";
import { FormulaireKpi } from "../../../../../../components/kpi/FormulaireKpi";
import "../../../../../../components/kpi/kpi.css";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { classesBouton } from "../../../../../../components/ui/Bouton";
import { Carte } from "../../../../../../components/ui/Carte";
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import { candidatsProprietaire, droitsKpi, hrefTableauKpi } from "../../../../../../lib/kpi";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import { aujourdhui } from "../../../../../../lib/periode";
import { chargerPersonnes } from "../../../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Nouveau KPI", "New KPI") };
}

/** Définition d'un nouveau KPI de la mission (KPI-01) : directeur, chef ou associé. */
export default async function PageNouveauKpi({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("kpi.gerer");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const r = await chargerMission(id);
  // L'en-tête (layout) affiche déjà l'erreur de chargement de la mission.
  if (!r.ok) return null;
  const m = r.donnees;
  const droits = droitsKpi(utilisateur.roles, utilisateur.id, m);
  const retour = (
    <Link href={hrefTableauKpi(m.id)} className={classesBouton("secondaire")}>
      {t("Revenir au tableau de bord", "Back to the dashboard")}
    </Link>
  );
  if (!droits.gerer) {
    return (
      <div className="mp-kpi">
        <Alerte
          tonalite="info"
          titre={t("Création non disponible", "Creation not available")}
          annonce="aucune"
        >
          <p>
            {m.statut === "cloturee"
              ? t(
                  "La mission est clôturée : ses KPI ne se modifient plus.",
                  "The engagement is closed: its KPIs can no longer be edited.",
                )
              : t(
                  "Seuls le directeur, le chef de mission et les personnes qui modifient toutes les missions définissent les KPI d'une mission.",
                  "Only the engagement director, the engagement manager and the people who edit all engagements define an engagement's KPIs.",
                )}
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
      <Carte titre={t("Nouveau KPI", "New KPI")}>
        <FormulaireKpi
          missionId={m.id}
          proprietaires={candidatsProprietaire(m, noms, langue)}
          aujourdhui={aujourdhui()}
        />
      </Carte>
    </div>
  );
}
