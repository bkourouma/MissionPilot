import type { RedSuiviVue } from "@missionpilot/shared";
import { formaterNombre } from "../../lib/format";
import {
  libelleGraviteSuivi,
  libelleTypeAlerteSuivi,
  tonaliteGraviteSuivi,
} from "../../lib/redressement-suivi";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";

/** Alertes internes calculées à chaque lecture (constats arithmétiques) et leur décompte. */
export function SuiviAlertes({ suivi }: { suivi: Pick<RedSuiviVue, "alertes" | "synthese"> }) {
  const { alertes, synthese } = suivi;
  return (
    <Carte titre="Alertes du suivi" niveauTitre={3}>
      <div className="mp-pile">
        <p className="mp-texte-doux">
          {`${formaterNombre(synthese.nombre, 0)} alerte(s) : ${formaterNombre(synthese.attention, 0)} à surveiller, ${formaterNombre(synthese.information, 0)} d'information.`}
        </p>
        {alertes.length === 0 ? (
          <p>Aucune alerte à ce jour.</p>
        ) : (
          <ul className="mp-sui-liste" aria-label="Alertes du suivi post-mission">
            {alertes.map((a) => (
              <li key={`${a.type}-${a.jalon_id}-${a.ratio ?? "jalon"}`} className="mp-clo-meta">
                <BadgeStatut tonalite={tonaliteGraviteSuivi(a.gravite)}>
                  {libelleGraviteSuivi(a.gravite)}
                </BadgeStatut>
                <span className="mp-texte-doux">{libelleTypeAlerteSuivi(a.type)}</span>
                <span>{a.libelle}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Carte>
  );
}
