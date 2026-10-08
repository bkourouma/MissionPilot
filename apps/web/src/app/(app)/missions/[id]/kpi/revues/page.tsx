import Link from "next/link";
import type { Metadata } from "next";
import { FormulaireRevue } from "../../../../../../components/kpi/FormulairesRevueKpi";
import "../../../../../../components/kpi/kpi.css";
import { classesBouton } from "../../../../../../components/ui/Bouton";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { formaterDate } from "../../../../../../lib/format";
import { droitsKpi, hrefTableauKpi, lireCurseur } from "../../../../../../lib/kpi";
import {
  cheminRevues,
  hrefRevue,
  hrefRevues,
  LIBELLES_STATUT_REVUE,
  type PageRevues,
} from "../../../../../../lib/kpi-pilotage";
import { chargerOptionsPilotage } from "../../../../../../lib/kpi-pilotage-serveur";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import { aujourdhui } from "../../../../../../lib/periode";
import { exigerPermission } from "../../../../../../lib/session";

export const metadata: Metadata = { title: "Revues de performance" };

/**
 * Revues de performance de la mission (KPI-17) : une revue se prépare (ordre du jour proposé par
 * le moteur), se tient (le dossier examiné est figé) puis se clôture quand toutes ses décisions
 * et actions sont terminées ou abandonnées.
 */
export default async function PageRevuesKpi({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("kpi.lire");
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const curseur = lireCurseur((await searchParams).curseur);
  const droits = droitsKpi(utilisateur.roles, utilisateur.id, m);
  const [revues, options] = await Promise.all([
    chargerServeur<PageRevues>(
      cheminRevues(m.id, `limite=25${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ""}`),
    ),
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
        Le dossier et la présentation d&apos;une revue sont générés par MissionPilot à partir des
        mesures, des alertes et des actions ; les décisions prises sont suivies jusqu&apos;à leur
        exécution.
      </p>
      {!revues.ok ? (
        <EtatErreur
          titre="Les revues n'ont pas pu être chargées."
          message={revues.message}
          hrefReessayer={hrefRevues(m.id)}
        />
      ) : revues.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucune revue de performance." icone="calendrier">
          <p>
            {droits.gerer
              ? "Planifiez la première revue ci-dessous."
              : "Le directeur ou le chef de mission planifie les revues."}
          </p>
        </EtatVide>
      ) : (
        <>
          <Tableau
            legende="Revues de performance de la mission"
            colonnes={[
              { cle: "numero", entete: "N°", alignement: "droite" },
              {
                cle: "titre",
                entete: "Revue",
                rendu: (x) => <Link href={hrefRevue(m.id, x.id)}>{x.titre}</Link>,
              },
              { cle: "date", entete: "Date", rendu: (x) => formaterDate(x.date_prevue) },
              {
                cle: "arrete",
                entete: "Arrêté des KPI",
                rendu: (x) => formaterDate(x.date_reference),
              },
              { cle: "statut", entete: "Statut", rendu: (x) => LIBELLES_STATUT_REVUE[x.statut] },
              { cle: "animateur_nom", entete: "Animateur" },
            ]}
            lignes={revues.donnees.elements}
            cleLigne={(x) => x.id}
          />
          <PaginationCurseur
            hrefSuivante={
              revues.donnees.curseur_suivant
                ? `${hrefRevues(m.id)}?curseur=${encodeURIComponent(revues.donnees.curseur_suivant)}`
                : null
            }
            hrefDebut={curseur ? hrefRevues(m.id) : null}
          />
        </>
      )}
      {droits.gerer ? (
        <Carte titre="Planifier une revue">
          <FormulaireRevue missionId={m.id} personnes={options.personnes} jour={aujourdhui()} />
        </Carte>
      ) : null}
    </div>
  );
}
