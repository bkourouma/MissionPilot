import type { RedClotureVue } from "@missionpilot/shared";
import { formaterDate, formaterDateHeure, formaterNombre } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import {
  libelleStatutCloture,
  textesCloture,
  tonaliteStatutCloture,
} from "../../lib/redressement-cloture";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";

/** Bilan courant : statut, dates, auteurs et décompte des évolutions (déjà calculé par le moteur). */
export async function ClotureEntete({ bilan }: { bilan: RedClotureVue }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const s = bilan.contenu.synthese;
  const nb = (v: number) => formaterNombre(v, 0, langue);
  const dateRef = formaterDate(bilan.date_reference, "UTC", langue);
  const creeLe = formaterDateHeure(bilan.cree_le, undefined, langue);
  return (
    <Carte
      titre={t(
        `Bilan de clôture, version ${bilan.version}`,
        `Close-out review, version ${bilan.version}`,
      )}
      niveauTitre={2}
    >
      <div className="mp-pile">
        <p className="mp-clo-meta">
          <BadgeStatut tonalite={tonaliteStatutCloture(bilan.statut)}>
            {libelleStatutCloture(bilan.statut, langue)}
          </BadgeStatut>
          <span>{t(`État au ${dateRef}`, `State as of ${dateRef}`)}</span>
          <span className="mp-texte-doux">
            {t(
              `Établi par ${bilan.cree_par.nom} le ${creeLe}`,
              `Prepared by ${bilan.cree_par.nom} on ${creeLe}`,
            )}
          </span>
          {bilan.valide_par && bilan.valide_le ? (
            <span className="mp-texte-doux">
              {t(
                `Validé par ${bilan.valide_par.nom} le ${formaterDateHeure(bilan.valide_le, undefined, langue)}`,
                `Approved by ${bilan.valide_par.nom} on ${formaterDateHeure(bilan.valide_le, undefined, langue)}`,
              )}
            </span>
          ) : null}
        </p>
        {bilan.motif ? (
          <p className="mp-texte-doux">{`${t("Motif :", "Reason:")} ${bilan.motif}`}</p>
        ) : null}
        <dl
          className="mp-clo-compteurs"
          aria-label={t("Synthèse des évolutions", "Summary of changes")}
        >
          <div>
            <dt>{t("Améliorations", "Improvements")}</dt>
            <dd>{nb(s.ameliorations)}</dd>
          </div>
          <div>
            <dt>{t("Dégradations", "Deteriorations")}</dt>
            <dd>{nb(s.degradations)}</dd>
          </div>
          <div>
            <dt>{t("Stables", "Stable")}</dt>
            <dd>{nb(s.stables)}</dd>
          </div>
          <div>
            <dt>{t("Non comparables", "Not comparable")}</dt>
            <dd>{nb(s.non_comparables)}</dd>
          </div>
        </dl>
        <Alerte tonalite="info" annonce="aucune">
          <p>{textesCloture(langue).evolution}</p>
        </Alerte>
      </div>
    </Carte>
  );
}
