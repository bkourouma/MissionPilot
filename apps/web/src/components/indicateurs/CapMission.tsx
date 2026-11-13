import { chargerServeur } from "../../lib/api-serveur";
import { formaterJours, formaterPourcentage } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { statutEcart } from "../../lib/indicateurs";
import type { SuiviMission } from "../../lib/suivi";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Calcule } from "../ui/Calcule";
import { Carte } from "../ui/Carte";
import { Trajectoire } from "../ui/Trajectoire";
import "./missions-en-vol.css";

/**
 * « Cap de la mission » en tête de la fiche : chemin parcouru, budget et atterrissage estimé,
 * tels que les sert le suivi de la mission (moteur de planning). Sans accès au suivi ou si le
 * calcul échoue, la carte n'apparaît pas : la fiche reste complète sans elle.
 */
export async function CapMission({ missionId }: { missionId: string }) {
  const tt = await obtenirT();
  const langue = await obtenirLangue();
  const r = await chargerServeur<SuiviMission>(`/api/missions/${missionId}/suivi`);
  if (!r.ok) return null;
  const t = r.donnees.arbre;
  if (t.budget <= 0 && t.realise <= 0) return null;
  const statut = statutEcart(t.ecart_relatif, t.ecart, langue);
  return (
    <Carte
      titre={tt("Cap de la mission", "Engagement course")}
      niveauTitre={2}
      actions={
        <span className="mp-cap__marques">
          <Calcule />
          <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>
        </span>
      }
    >
      <div className="mp-cap">
        <div className="mp-cap__trajectoire">
          <Trajectoire
            budget={t.budget}
            realises={t.realise}
            atterrissage={t.atterrissage}
            largeur={720}
            hauteur={36}
          />
        </div>
        <dl className="mp-cap__chiffres">
          <div>
            <dt>{tt("Réalisé", "Worked")}</dt>
            <dd>
              {formaterJours(t.realise, langue)}
              <span className="mp-cap__sur">
                {" "}
                / {formaterJours(t.budget, langue)} {tt("budgétés", "budgeted")}
              </span>
            </dd>
          </div>
          <div>
            <dt>{tt("Reste à faire", "Remaining")}</dt>
            <dd>{formaterJours(t.reste_a_faire, langue)}</dd>
          </div>
          <div>
            <dt>{tt("Atterrissage estimé", "Estimated landing")}</dt>
            <dd>{formaterJours(t.atterrissage, langue)}</dd>
          </div>
          <div>
            <dt>{tt("Écart de cap", "Course variance")}</dt>
            <dd>
              {t.ecart > 0 ? "+" : ""}
              {formaterJours(t.ecart, langue)}
              {t.ecart_relatif !== null ? (
                <span className="mp-cap__sur">
                  {" "}
                  ({formaterPourcentage(t.ecart_relatif, 1, langue)})
                </span>
              ) : null}
            </dd>
          </div>
        </dl>
      </div>
    </Carte>
  );
}
