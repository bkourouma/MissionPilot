import Link from "next/link";
import {
  RED_VOYANTS_PILOTAGE,
  type Langue,
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
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Tableau } from "../ui/Tableau";
import { VoyantPilotage, VoyantPilotageMotifs } from "./VoyantPilotage";

/** Synthèse de la PAGE affichée : nombre de dossiers par voyant (jamais du portefeuille entier). */
export async function TableauSynthesePage({
  synthese,
}: {
  synthese: RedTableauPortefeuilleVue["synthese_page"];
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <ul
      className="mp-tdb-synthese"
      aria-label={t("Dossiers de la page par voyant", "Files on this page by steering light")}
    >
      {RED_VOYANTS_PILOTAGE.map((v) => (
        <li key={v} className="mp-tdb-synthese__item">
          <VoyantPilotage voyant={v} />
          <span className="mp-tdb-synthese__nombre">{libelleNombre(synthese[v] ?? 0, langue)}</span>
          <span className="mp-visuellement-cache">
            {" "}
            {t(
              `dossier(s) au voyant ${libelleVoyantPilotage(v)}`,
              `file(s) with steering light ${libelleVoyantPilotage(v, langue)}`,
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Indicateurs d'une ligne du portefeuille, sur une ligne de texte. */
function IndicateursLigne({
  i,
  langue,
}: {
  i: RedTableauPortefeuilleElementVue["indicateurs"];
  langue: Langue;
}) {
  const en = langue === "en";
  const nb = (v: number) => libelleNombre(v, langue);
  const parties = [
    `${en ? "Urgency" : "Urgence"}${en ? ": " : " : "}${i.dernier_voyant_urgence ? libelleVoyant(i.dernier_voyant_urgence, langue) : VALEUR_ABSENTE}`,
    `${en ? "Alert" : "Alerte"}${en ? ": " : " : "}${i.dernier_niveau_alerte ? libelleNiveauAlerte(i.dernier_niveau_alerte, langue) : VALEUR_ABSENTE}`,
    `${en ? "Score: " : "Score : "}${i.dernier_score === null ? VALEUR_ABSENTE : nb(i.dernier_score)}`,
    `${en ? "Strain weeks: " : "Semaines de tension : "}${i.semaines_tension === null ? VALEUR_ABSENTE : nb(i.semaines_tension)}`,
    `${en ? "Covenants not met: " : "Covenants non respectés : "}${i.covenants_en_defaut === null ? VALEUR_ABSENTE : nb(i.covenants_en_defaut)}`,
    `${en ? "Overdue actions: " : "Actions en retard : "}${nb(i.actions_en_retard)}`,
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
export async function TableauPortefeuille({
  elements,
}: {
  elements: readonly RedTableauPortefeuilleElementVue[];
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <Tableau
      legende={t(
        "Dossiers de la page, avec voyant de pilotage",
        "Files on this page, with steering light",
      )}
      colonnes={[
        {
          cle: "dossier",
          entete: t("Dossier", "File"),
          rendu: (e: RedTableauPortefeuilleElementVue) => (
            <div className="mp-pile">
              <Link href={hrefRedressement(e.dossier.mission.id, "tableau-de-bord")}>
                {e.dossier.intitule}
              </Link>
              <span className="mp-texte-doux">
                {e.dossier.client.raison_sociale} · {libelleSecteur(e.dossier.secteur, langue)}
              </span>
              <BadgeStatut tonalite={tonaliteStatutDossier(e.dossier.statut)}>
                {libelleStatutDossier(e.dossier.statut, langue)}
              </BadgeStatut>
            </div>
          ),
        },
        {
          cle: "voyant",
          entete: t("Voyant", "Steering light"),
          rendu: (e) => <VoyantPilotage voyant={e.voyant} />,
        },
        {
          cle: "motifs",
          entete: t("Motifs principaux", "Main reasons"),
          rendu: (e) => <VoyantPilotageMotifs motifs={e.motifs} max={3} />,
        },
        {
          cle: "indicateurs",
          entete: t("Indicateurs", "Indicators"),
          rendu: (e) => <IndicateursLigne i={e.indicateurs} langue={langue} />,
        },
      ]}
      lignes={elements}
      cleLigne={(e) => e.dossier.id}
    />
  );
}
