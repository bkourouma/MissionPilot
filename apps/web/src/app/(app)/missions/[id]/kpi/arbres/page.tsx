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

export const metadata: Metadata = { title: "Arbres d'indicateurs" };

/**
 * Arbres d'indicateurs de la mission (KPI-13) : un KPI se décompose en leviers (somme pondérée
 * ou produit) ; le moteur chiffre la contribution de chaque levier à la variation du KPI entre
 * deux dates. La page liste les arbres et permet d'en créer (directeur ou chef de mission).
 */
export default async function PageArbresKpi({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("kpi.lire");
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const droits = droitsKpi(utilisateur.roles, utilisateur.id, m);
  const [arbres, options] = await Promise.all([
    chargerServeur<ListeArbres>(cheminArbres(m.id)),
    chargerOptionsPilotage(utilisateur.roles, m, m.id),
  ]);
  return (
    <div className="mp-kpi">
      <div className="mp-actions-formulaire">
        <Link href={hrefTableauKpi(m.id)} className={classesBouton("secondaire")}>
          Revenir au tableau de bord
        </Link>
      </div>
      <p className="mp-texte-doux">
        Décomposez un KPI en leviers pour comprendre ce qui a fait bouger le résultat. Les
        contributions sont calculées par le moteur de MissionPilot à partir des mesures des KPI liés
        ; elles décrivent une variation observée, pas une cause démontrée.
      </p>
      {!arbres.ok ? (
        <EtatErreur
          titre="Les arbres n'ont pas pu être chargés."
          message={arbres.message}
          hrefReessayer={hrefArbres(m.id)}
        />
      ) : arbres.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucun arbre d'indicateurs pour cette mission." icone="courbe">
          <p>
            {droits.gerer
              ? "Choisissez un KPI à décomposer ci-dessous, puis ajoutez ses leviers."
              : "Le directeur ou le chef de mission crée les arbres d'indicateurs."}
          </p>
        </EtatVide>
      ) : (
        <Tableau<ArbreResume>
          legende="Arbres d'indicateurs de la mission"
          colonnes={[
            {
              cle: "libelle",
              entete: "Arbre",
              rendu: (a) => <Link href={hrefArbre(m.id, a.id)}>{a.libelle}</Link>,
            },
            { cle: "nombre_noeuds", entete: "Nœuds actifs", alignement: "droite" },
            { cle: "actif", entete: "Situation", rendu: (a) => (a.actif ? "Actif" : "Désactivé") },
          ]}
          lignes={arbres.donnees.elements}
          cleLigne={(a) => a.id}
        />
      )}
      {arbres.ok && arbres.donnees.tronque ? (
        <Alerte tonalite="attention" titre="Liste incomplète" annonce="aucune">
          <p>{avertissementTronque(true, "arbres")}</p>
        </Alerte>
      ) : null}
      {droits.gerer ? (
        <Carte titre="Nouvel arbre">
          {options.erreurKpis ? (
            <Alerte tonalite="attention" titre="KPI indisponibles" annonce="aucune">
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
