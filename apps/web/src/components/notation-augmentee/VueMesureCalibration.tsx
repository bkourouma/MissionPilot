import { BadgeStatut } from "../ui/BadgeStatut";
import { Tableau } from "../ui/Tableau";
import { formaterNombre } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import {
  formaterPointsSignes,
  formaterRatio,
  libelleAccord,
  phraseBiais,
  type MesureCalibrationVue,
} from "../../lib/notation-augmentee";
import "./notation-augmentee.css";

/**
 * Mesure d'écart d'une session (moteur `mesurerCalibration`) : accord, cas à discuter, biais par
 * évaluateur. Tous les chiffres viennent de l'API ; ici, seulement la présentation. Avant la
 * clôture la mesure est PARTIELLE : limitée aux cas que l'expert a lui-même cotés.
 */
export async function VueMesureCalibration({
  mesure,
  libellesCas,
  partielle,
}: {
  mesure: MesureCalibrationVue;
  libellesCas: ReadonlyMap<string, string>;
  partielle: boolean;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const libelle = (code: string) => libellesCas.get(code) ?? code;
  return (
    <div className="mp-pile">
      {partielle ? (
        <p className="mp-texte-doux">
          {t(
            "Mesure partielle : elle ne porte que sur les cas que vous avez cotés. La mesure complète apparaît à la clôture de la session.",
            "Partial measure: it covers only the cases you rated. The full measure appears when the session is closed.",
          )}
        </p>
      ) : null}
      <dl className="mp-na-synthese">
        <div>
          <dt>{t("Taux d'accord", "Agreement rate")}</dt>
          <dd>{formaterRatio(mesure.taux_accord)}</dd>
        </div>
        <div>
          <dt>{t("Écart moyen (niveaux)", "Average gap (levels)")}</dt>
          <dd>{formaterNombre(mesure.ecart_moyen, 2, langue)}</dd>
        </div>
        <div>
          <dt>{t("Cas doublement cotés", "Cases rated twice or more")}</dt>
          <dd>{mesure.cas_doublement_cotes}</dd>
        </div>
        <div>
          <dt>{t("Cas en accord", "Cases in agreement")}</dt>
          <dd>{mesure.cas_en_accord}</dd>
        </div>
        <div>
          <dt>{t("Tolérance (niveaux)", "Tolerance (levels)")}</dt>
          <dd>{mesure.tolerance}</dd>
        </div>
      </dl>

      {mesure.a_discuter.length > 0 ? (
        <div className="mp-pile">
          <p className="mp-na-liste__titre">
            {t(
              "Cas à discuter en séance de calibrage",
              "Cases to discuss in the calibration session",
            )}
          </p>
          <ul className="mp-na-cotations">
            {mesure.a_discuter.map((c) => (
              <li key={c}>{libelle(c)}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mp-texte-doux">
          {t("Aucun cas à discuter pour le moment.", "No case to discuss for now.")}
        </p>
      )}

      <Tableau
        legende={t("Mesure par cas", "Measure by case")}
        legendeVisible
        cleLigne={(c) => c.cas}
        lignes={mesure.cas}
        colonnes={[
          { cle: "cas", entete: t("Cas", "Case"), rendu: (c) => libelle(c.cas) },
          { cle: "cotations", entete: t("Cotations", "Ratings"), alignement: "droite" },
          { cle: "min", entete: t("Niveau min.", "Min. level"), alignement: "droite" },
          { cle: "max", entete: t("Niveau max.", "Max. level"), alignement: "droite" },
          { cle: "ecart", entete: t("Écart", "Gap"), alignement: "droite" },
          {
            cle: "mediane",
            entete: t("Médiane", "Median"),
            alignement: "droite",
            rendu: (c) => formaterNombre(c.mediane, 1, langue),
          },
          {
            cle: "accord",
            entete: t("Accord", "Agreement"),
            rendu: (c) => {
              const a = libelleAccord(c.accord, langue);
              return <BadgeStatut tonalite={a.tonalite}>{a.libelle}</BadgeStatut>;
            },
          },
        ]}
      />

      <Tableau
        legende={t("Mesure par évaluateur", "Measure by rater")}
        legendeVisible
        cleLigne={(e) => e.evaluateur.id}
        lignes={mesure.evaluateurs}
        colonnes={[
          {
            cle: "evaluateur",
            entete: t("Évaluateur", "Rater"),
            rendu: (e) => e.evaluateur.nom ?? t("Un membre du cabinet", "A firm member"),
          },
          { cle: "cotations", entete: t("Cotations", "Ratings"), alignement: "droite" },
          {
            cle: "cas_compares",
            entete: t("Cas comparés", "Cases compared"),
            alignement: "droite",
          },
          {
            cle: "biais",
            entete: t("Biais (niveaux)", "Bias (levels)"),
            alignement: "droite",
            rendu: (e) => (e.biais === null ? "—" : formaterPointsSignes(e.biais, langue)),
          },
          {
            cle: "ecart_absolu_moyen",
            entete: t("Écart absolu moyen", "Mean absolute gap"),
            alignement: "droite",
            rendu: (e) => formaterNombre(e.ecart_absolu_moyen, 2, langue),
          },
          {
            cle: "lecture",
            entete: t("Lecture", "Reading"),
            rendu: (e) => phraseBiais(e.biais, langue),
          },
        ]}
      />
      <p className="mp-texte-doux mp-texte-petit">
        {t(
          "Le biais est l'écart moyen à la médiane du cas, sur les cas doublement cotés : positif, l'évaluateur est plus généreux que ses pairs.",
          "Bias is the average gap to the case median, over cases rated twice or more: positive means the rater is more generous than peers.",
        )}
      </p>
    </div>
  );
}
