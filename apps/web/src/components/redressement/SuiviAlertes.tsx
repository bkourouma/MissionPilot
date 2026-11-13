import type { RedSuiviVue } from "@missionpilot/shared";
import { formaterNombre } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import {
  libelleGraviteSuivi,
  libelleTypeAlerteSuivi,
  tonaliteGraviteSuivi,
} from "../../lib/redressement-suivi";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";

/** Alertes internes calculées à chaque lecture (constats arithmétiques) et leur décompte. */
export async function SuiviAlertes({
  suivi,
}: {
  suivi: Pick<RedSuiviVue, "alertes" | "synthese">;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { alertes, synthese } = suivi;
  const nb = (v: number) => formaterNombre(v, 0, langue);
  return (
    <Carte titre={t("Alertes du suivi", "Follow-up alerts")} niveauTitre={3}>
      <div className="mp-pile">
        <p className="mp-texte-doux">
          {t(
            `${nb(synthese.nombre)} alerte(s) : ${nb(synthese.attention)} à surveiller, ${nb(synthese.information)} d'information.`,
            `${nb(synthese.nombre)} alert(s): ${nb(synthese.attention)} to watch, ${nb(synthese.information)} informational.`,
          )}
        </p>
        {alertes.length === 0 ? (
          <p>{t("Aucune alerte à ce jour.", "No alert to date.")}</p>
        ) : (
          <ul
            className="mp-sui-liste"
            aria-label={t("Alertes du suivi post-mission", "Post-engagement follow-up alerts")}
          >
            {alertes.map((a) => (
              <li key={`${a.type}-${a.jalon_id}-${a.ratio ?? "jalon"}`} className="mp-clo-meta">
                <BadgeStatut tonalite={tonaliteGraviteSuivi(a.gravite)}>
                  {libelleGraviteSuivi(a.gravite, langue)}
                </BadgeStatut>
                <span className="mp-texte-doux">{libelleTypeAlerteSuivi(a.type, langue)}</span>
                <span>{a.libelle}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Carte>
  );
}
