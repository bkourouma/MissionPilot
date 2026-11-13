import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import {
  aideContenuIa,
  libelleContenuIa,
  ligneHistoriqueIa,
  type OrigineIa,
} from "../../../../../lib/questionnaires-ia";

/**
 * Origine IA d'une version (SOC-11) : statut du contenu (brouillon IA, modifié, validé),
 * besoin décrit et historique. Affiché seulement pour une version proposée par l'IA.
 */
export async function PanneauIa({ ia }: { ia: OrigineIa }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const statut = libelleContenuIa(ia.statut_contenu, langue);
  const brief = ia.brief;
  return (
    <Carte
      niveauTitre={2}
      titre={t("Contenu proposé par l'IA", "Content proposed by the AI")}
      actions={<BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>}
    >
      <div className="mp-pile">
        <Alerte tonalite={ia.statut_contenu === "valide" ? "succes" : "attention"} annonce="status">
          <p>{aideContenuIa(ia, langue)}</p>
          {ia.chiffres_non_verifies && ia.statut_contenu !== "valide" ? (
            <p>
              {t(
                "Des nombres du questionnaire ne viennent pas d'un moteur de calcul : ils sont à vérifier et à acquitter explicitement avant la validation.",
                "Some numbers in the questionnaire do not come from a calculation engine: they must be checked and explicitly acknowledged before approval.",
              )}
            </p>
          ) : null}
        </Alerte>
        {brief.service || brief.population || brief.theme ? (
          <dl className="mp-liste-def">
            {brief.service ? (
              <div>
                <dt>{t("Service", "Service")}</dt>
                <dd>{brief.service}</dd>
              </div>
            ) : null}
            {brief.population ? (
              <div>
                <dt>{t("Population interrogée", "Surveyed population")}</dt>
                <dd>{brief.population}</dd>
              </div>
            ) : null}
            {brief.theme ? (
              <div>
                <dt>{t("Thème", "Topic")}</dt>
                <dd>{brief.theme}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        <ol className="mp-liste-simple" aria-label={t("Historique du contenu", "Content history")}>
          {ia.historique.map((r) => (
            <li key={r.rang}>{ligneHistoriqueIa(r, langue)}</li>
          ))}
        </ol>
      </div>
    </Carte>
  );
}
