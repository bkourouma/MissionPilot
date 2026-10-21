import Link from "next/link";
import {
  RED_VOYANTS_PILOTAGE,
  type RedTableauPortefeuilleElementVue,
  type RedTableauPortefeuilleVue,
} from "@missionpilot/shared";
import {
  hrefRedressement,
  libelleNiveauAlerte,
  libelleSecteur,
  libelleStatutDossier,
  libelleVoyant,
  tonaliteStatutDossier,
} from "../../lib/redressement";
import { libelleNombre, libelleVoyantPilotage } from "../../lib/redressement-tableau";
import { VALEUR_ABSENTE } from "../../lib/format";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Tableau } from "../ui/Tableau";
import { VoyantPilotage, VoyantPilotageMotifs } from "./VoyantPilotage";

/** Synthèse de la PAGE affichée : nombre de dossiers par voyant (jamais du portefeuille entier). */
export function TableauSynthesePage({
  synthese,
}: {
  synthese: RedTableauPortefeuilleVue["synthese_page"];
}) {
  return (
    <ul className="mp-tdb-synthese" aria-label="Dossiers de la page par voyant">
      {RED_VOYANTS_PILOTAGE.map((v) => (
        <li key={v} className="mp-tdb-synthese__item">
          <VoyantPilotage voyant={v} />
          <span className="mp-tdb-synthese__nombre">{libelleNombre(synthese[v] ?? 0)}</span>
          <span className="mp-visuellement-cache">
            {" "}
            dossier(s) au voyant {libelleVoyantPilotage(v)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Indicateurs d'une ligne du portefeuille, sur une ligne de texte. */
function IndicateursLigne({ i }: { i: RedTableauPortefeuilleElementVue["indicateurs"] }) {
  const parties = [
    `Urgence : ${i.dernier_voyant_urgence ? libelleVoyant(i.dernier_voyant_urgence) : VALEUR_ABSENTE}`,
    `Alerte : ${i.dernier_niveau_alerte ? libelleNiveauAlerte(i.dernier_niveau_alerte) : VALEUR_ABSENTE}`,
    `Score : ${i.dernier_score === null ? VALEUR_ABSENTE : libelleNombre(i.dernier_score)}`,
    `Semaines de tension : ${i.semaines_tension === null ? VALEUR_ABSENTE : libelleNombre(i.semaines_tension)}`,
    `Covenants non respectés : ${i.covenants_en_defaut === null ? VALEUR_ABSENTE : libelleNombre(i.covenants_en_defaut)}`,
    `Actions en retard : ${libelleNombre(i.actions_en_retard)}`,
  ];
  return (
    <ul className="mp-tdb-indic">
      {parties.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  );
}

/** Portefeuille : un dossier par ligne, voyant, trois motifs au plus, indicateurs, lien. */
export function TableauPortefeuille({
  elements,
}: {
  elements: readonly RedTableauPortefeuilleElementVue[];
}) {
  return (
    <Tableau
      legende="Dossiers de la page, avec voyant de pilotage"
      colonnes={[
        {
          cle: "dossier",
          entete: "Dossier",
          rendu: (e: RedTableauPortefeuilleElementVue) => (
            <div className="mp-pile">
              <Link href={hrefRedressement(e.dossier.mission.id, "tableau-de-bord")}>
                {e.dossier.intitule}
              </Link>
              <span className="mp-texte-doux">
                {e.dossier.client.raison_sociale} · {libelleSecteur(e.dossier.secteur)}
              </span>
              <BadgeStatut tonalite={tonaliteStatutDossier(e.dossier.statut)}>
                {libelleStatutDossier(e.dossier.statut)}
              </BadgeStatut>
            </div>
          ),
        },
        { cle: "voyant", entete: "Voyant", rendu: (e) => <VoyantPilotage voyant={e.voyant} /> },
        {
          cle: "motifs",
          entete: "Motifs principaux",
          rendu: (e) => <VoyantPilotageMotifs motifs={e.motifs} max={3} />,
        },
        {
          cle: "indicateurs",
          entete: "Indicateurs",
          rendu: (e) => <IndicateursLigne i={e.indicateurs} />,
        },
      ]}
      lignes={elements}
      cleLigne={(e) => e.dossier.id}
    />
  );
}
