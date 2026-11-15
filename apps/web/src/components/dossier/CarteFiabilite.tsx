import "./dossier.css";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { formaterNombre } from "../../lib/format";
import { obtenirLangue } from "../../lib/i18n/serveur";
import { classeFiabilite, composantesFiabilite, type Fiabilite } from "../../lib/dossier";

/**
 * Indice de fiabilité des données du client (DOS-04), calculé par le moteur de l'API :
 * classe, composantes en points, recommandations de prudence.
 */
export async function CarteFiabilite({ fiabilite }: { fiabilite: Fiabilite }) {
  const langue = await obtenirLangue();
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  const classe = classeFiabilite(fiabilite.classe, langue);
  return (
    <Carte
      titre={t("Fiabilité des données", "Data reliability")}
      actions={<BadgeStatut tonalite={classe.tonalite}>{classe.libelle}</BadgeStatut>}
    >
      <div className="mp-fiabilite">
        <p>
          <strong>
            {formaterNombre(fiabilite.points, 0, langue)}{" "}
            {t("points sur 100.", "points out of 100.")}
          </strong>{" "}
          {fiabilite.analyses_indicatives
            ? t(
                "Toute analyse financière de ce client est à présenter comme indicative.",
                "Any financial analysis of this client must be presented as indicative.",
              )
            : t(
                "Les analyses peuvent s'appuyer sur ces données sans réserve particulière.",
                "Analyses can rely on this data without particular reservation.",
              )}
        </p>
        <dl className="mp-liste-def mp-liste-def--compacte">
          {composantesFiabilite(langue).map((c) => (
            <div key={c.cle}>
              <dt>{c.libelle}</dt>
              <dd>
                {formaterNombre(fiabilite.detail[c.cle], 0, langue)} / {c.max}
              </dd>
            </div>
          ))}
        </dl>
        {fiabilite.recommandations.length > 0 ? (
          <>
            <h3 className="mp-section__titre">
              {t("Recommandations de prudence", "Cautionary recommendations")}
            </h3>
            <ul>
              {fiabilite.recommandations.map((r) => (
                <li key={r.code}>{r.message}</li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </Carte>
  );
}
