import { chargerServeur } from "../../lib/api-serveur";
import { formaterJours, formaterPourcentage } from "../../lib/format";
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
  const r = await chargerServeur<SuiviMission>(`/api/missions/${missionId}/suivi`);
  if (!r.ok) return null;
  const t = r.donnees.arbre;
  if (t.budget <= 0 && t.realise <= 0) return null;
  const statut = statutEcart(t.ecart_relatif, t.ecart);
  return (
    <Carte
      titre="Cap de la mission"
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
            <dt>Réalisé</dt>
            <dd>
              {formaterJours(t.realise)}
              <span className="mp-cap__sur"> / {formaterJours(t.budget)} budgétés</span>
            </dd>
          </div>
          <div>
            <dt>Reste à faire</dt>
            <dd>{formaterJours(t.reste_a_faire)}</dd>
          </div>
          <div>
            <dt>Atterrissage estimé</dt>
            <dd>{formaterJours(t.atterrissage)}</dd>
          </div>
          <div>
            <dt>Écart de cap</dt>
            <dd>
              {t.ecart > 0 ? "+" : ""}
              {formaterJours(t.ecart)}
              {t.ecart_relatif !== null ? (
                <span className="mp-cap__sur"> ({formaterPourcentage(t.ecart_relatif)})</span>
              ) : null}
            </dd>
          </div>
        </dl>
      </div>
    </Carte>
  );
}
