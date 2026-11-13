import Link from "next/link";
import type { Metadata } from "next";
import { FormulaireArbre } from "../../../../../../components/kpi/FormulairesArbreKpi";
import "../../../../../../components/kpi/kpi.css";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { classesBouton } from "../../../../../../components/ui/Bouton";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import { droitsKpi, hrefTableauKpi } from "../../../../../../lib/kpi";
import {
  avertissementTronque,
  cheminArbres,
  hrefArbre,
  hrefArbres,
  type ArbreResume,
  type ListeArbres,
} from "../../../../../../lib/kpi-pilotage";
import { chargerOptionsPilotage } from "../../../../../../lib/kpi-pilotage-serveur";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Arbres d'indicateurs", "KPI trees") };
}

/**
 * Arbres d'indicateurs de la mission (KPI-13) : un KPI se décompose en leviers (somme pondérée
 * ou produit) ; le moteur chiffre la contribution de chaque levier à la variation du KPI entre
 * deux dates. La page liste les arbres et permet d'en créer (directeur ou chef de mission).
 */
export default async function PageArbresKpi({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("kpi.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const droits = droitsKpi(utilisateur.roles, utilisateur.id, m);
  const [arbres, options] = await Promise.all([
    chargerServeur<ListeArbres>(cheminArbres(m.id)),
    chargerOptionsPilotage(utilisateur.roles, m, m.id, langue),
  ]);
  return (
    <div className="mp-kpi">
      <div className="mp-actions-formulaire">
        <Link href={hrefTableauKpi(m.id)} className={classesBouton("secondaire")}>
          {t("Revenir au tableau de bord", "Back to the dashboard")}
        </Link>
      </div>
      <p className="mp-texte-doux">
        {t(
          "Décomposez un KPI en leviers pour comprendre ce qui a fait bouger le résultat. Les contributions sont calculées par le moteur de CabinetPilot à partir des mesures des KPI liés ; elles décrivent une variation observée, pas une cause démontrée.",
          "Break a KPI down into drivers to understand what moved the result. Contributions are computed by the CabinetPilot engine from the measurements of the linked KPIs; they describe an observed change, not a proven cause.",
        )}
      </p>
      {!arbres.ok ? (
        <EtatErreur
          titre={t("Les arbres n'ont pas pu être chargés.", "The trees could not be loaded.")}
          message={arbres.message}
          hrefReessayer={hrefArbres(m.id)}
        />
      ) : arbres.donnees.elements.length === 0 ? (
        <EtatVide
          titre={t(
            "Aucun arbre d'indicateurs pour cette mission.",
            "No KPI tree for this engagement.",
          )}
          icone="courbe"
        >
          <p>
            {droits.gerer
              ? t(
                  "Choisissez un KPI à décomposer ci-dessous, puis ajoutez ses leviers.",
                  "Choose a KPI to break down below, then add its drivers.",
                )
              : t(
                  "Le directeur ou le chef de mission crée les arbres d'indicateurs.",
                  "The engagement director or manager creates the KPI trees.",
                )}
          </p>
        </EtatVide>
      ) : (
        <Tableau<ArbreResume>
          legende={t("Arbres d'indicateurs de la mission", "The engagement's KPI trees")}
          colonnes={[
            {
              cle: "libelle",
              entete: t("Arbre", "Tree"),
              rendu: (a) => <Link href={hrefArbre(m.id, a.id)}>{a.libelle}</Link>,
            },
            {
              cle: "nombre_noeuds",
              entete: t("Nœuds actifs", "Active nodes"),
              alignement: "droite",
            },
            {
              cle: "actif",
              entete: t("Situation", "Status"),
              rendu: (a) => (a.actif ? t("Actif", "Active") : t("Désactivé", "Disabled")),
            },
          ]}
          lignes={arbres.donnees.elements}
          cleLigne={(a) => a.id}
        />
      )}
      {arbres.ok && arbres.donnees.tronque ? (
        <Alerte
          tonalite="attention"
          titre={t("Liste incomplète", "Incomplete list")}
          annonce="aucune"
        >
          <p>{avertissementTronque(true, t("arbres", "trees"), langue)}</p>
        </Alerte>
      ) : null}
      {droits.gerer ? (
        <Carte titre={t("Nouvel arbre", "New tree")}>
          {options.erreurKpis ? (
            <Alerte
              tonalite="attention"
              titre={t("KPI indisponibles", "KPIs unavailable")}
              annonce="aucune"
            >
              <p>{options.erreurKpis}</p>
            </Alerte>
          ) : (
            <FormulaireArbre missionId={m.id} kpis={options.kpis} />
          )}
        </Carte>
      ) : null}
    </div>
  );
}
