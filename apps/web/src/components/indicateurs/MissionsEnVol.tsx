import Link from "next/link";
import { formaterJours, formaterPourcentage } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { statutEcart, type ElementMission } from "../../lib/indicateurs";
import { BadgeStatut } from "../ui/BadgeStatut";
import { classesBouton } from "../ui/Bouton";
import { Calcule } from "../ui/Calcule";
import { EtatVide } from "../ui/EtatListe";
import { Tableau, type ColonneTableau } from "../ui/Tableau";
import { Trajectoire } from "../ui/Trajectoire";
import "./missions-en-vol.css";

/** Plus forte dérive d'abord : c'est la mission à regarder en premier. */
function parDerive(a: ElementMission, b: ElementMission): number {
  return (
    (b.ecart_terminaison.relatif_jours ?? 0) - (a.ecart_terminaison.relatif_jours ?? 0) ||
    b.ecart_terminaison.jours - a.ecart_terminaison.jours
  );
}

/**
 * « Missions en vol » : chaque mission avec son chemin parcouru, son budget de jours et son
 * atterrissage estimé (chiffres du moteur, jamais recalculés ici). La marge n'apparaît que si
 * l'API la sert (FIN-02).
 */
export async function MissionsEnVol({
  elements,
  limite = 8,
  hrefPeriode = "/indicateurs",
}: {
  elements: readonly ElementMission[];
  limite?: number;
  /** Écran détaillé (changer de période ou de niveau), proposé quand rien n'est en vol. */
  hrefPeriode?: string;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const lignes = [...elements].sort(parDerive).slice(0, limite);
  const avecMarge = lignes.some((m) => typeof m.marge?.taux_marge === "number");
  const colonnes: ColonneTableau<ElementMission>[] = [
    {
      cle: "mission",
      entete: t("Mission", "Engagement"),
      rendu: (m) => <Link href={`/missions/${m.mission_id}`}>{m.intitule}</Link>,
    },
    {
      cle: "jours",
      entete: t("Réalisés / budgétés", "Worked / budgeted"),
      alignement: "droite",
      rendu: (m) =>
        `${formaterJours(m.jours_realises, langue)} / ${formaterJours(m.jours_budget, langue)}`,
    },
    {
      cle: "trajectoire",
      entete: t("Trajectoire", "Trajectory"),
      rendu: (m) => (
        <Trajectoire
          budget={m.jours_budget}
          realises={m.jours_realises}
          atterrissage={m.jours_atterrissage}
        />
      ),
    },
    ...(avecMarge
      ? [
          {
            cle: "marge",
            entete: t("Marge", "Margin"),
            alignement: "droite" as const,
            rendu: (m: ElementMission) =>
              typeof m.marge?.taux_marge === "number" ? (
                formaterPourcentage(m.marge.taux_marge, 1, langue)
              ) : (
                <span data-vide>—</span>
              ),
          },
        ]
      : []),
    {
      cle: "ecart",
      entete: t("Écart de cap", "Course variance"),
      rendu: (m) => {
        const s = statutEcart(m.ecart_terminaison.relatif_jours, m.ecart_terminaison.jours, langue);
        return <BadgeStatut tonalite={s.tonalite}>{s.libelle}</BadgeStatut>;
      },
    },
  ];
  return (
    <section className="mp-missions-en-vol" aria-labelledby="titre-missions-en-vol">
      <div className="mp-missions-en-vol__entete">
        <h3 id="titre-missions-en-vol" className="mp-missions-en-vol__titre">
          {t("Missions en vol", "Engagements in flight")}
        </h3>
        <Calcule />
      </div>
      {lignes.length === 0 ? (
        <EtatVide
          titre={t("Aucune mission en vol sur la période", "No engagement in flight this period")}
          icone="dossier"
          action={
            <Link href={hrefPeriode} className={classesBouton("secondaire")}>
              {t("Changer de période", "Change the period")}
            </Link>
          }
        >
          <p>
            {t(
              "Les missions actives de la période apparaissent ici, classées par écart de cap. Élargissez la période pour en voir.",
              "Active engagements of the period appear here, ranked by course variance. Widen the period to see some.",
            )}
          </p>
        </EtatVide>
      ) : (
        <Tableau
          legende={t(
            "Missions en vol, classées par écart de cap",
            "Engagements in flight, ranked by course variance",
          )}
          colonnes={colonnes}
          lignes={lignes}
          cleLigne={(m) => m.mission_id}
        />
      )}
      {elements.length > lignes.length ? (
        <p className="mp-texte-doux">
          {t(
            `${lignes.length} missions sur ${elements.length}. `,
            `${lignes.length} engagements out of ${elements.length}. `,
          )}
          <Link href="/indicateurs">
            {t(
              "Voir toutes les missions dans les indicateurs",
              "See all engagements in the indicators",
            )}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
