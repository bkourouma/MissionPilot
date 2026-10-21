import type { RedClotureVue } from "@missionpilot/shared";
import { formaterDate, formaterDateHeure, formaterNombre } from "../../lib/format";
import {
  libelleStatutCloture,
  tonaliteStatutCloture,
  TEXTE_CLOTURE_EVOLUTION,
} from "../../lib/redressement-cloture";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";

/** Bilan courant : statut, dates, auteurs et décompte des évolutions (déjà calculé par le moteur). */
export function ClotureEntete({ bilan }: { bilan: RedClotureVue }) {
  const s = bilan.contenu.synthese;
  return (
    <Carte titre={`Bilan de clôture, version ${bilan.version}`} niveauTitre={2}>
      <div className="mp-pile">
        <p className="mp-clo-meta">
          <BadgeStatut tonalite={tonaliteStatutCloture(bilan.statut)}>
            {libelleStatutCloture(bilan.statut)}
          </BadgeStatut>
          <span>{`État au ${formaterDate(bilan.date_reference)}`}</span>
          <span className="mp-texte-doux">
            {`Établi par ${bilan.cree_par.nom} le ${formaterDateHeure(bilan.cree_le)}`}
          </span>
          {bilan.valide_par && bilan.valide_le ? (
            <span className="mp-texte-doux">
              {`Validé par ${bilan.valide_par.nom} le ${formaterDateHeure(bilan.valide_le)}`}
            </span>
          ) : null}
        </p>
        {bilan.motif ? <p className="mp-texte-doux">{`Motif : ${bilan.motif}`}</p> : null}
        <dl className="mp-clo-compteurs" aria-label="Synthèse des évolutions">
          <div>
            <dt>Améliorations</dt>
            <dd>{formaterNombre(s.ameliorations, 0)}</dd>
          </div>
          <div>
            <dt>Dégradations</dt>
            <dd>{formaterNombre(s.degradations, 0)}</dd>
          </div>
          <div>
            <dt>Stables</dt>
            <dd>{formaterNombre(s.stables, 0)}</dd>
          </div>
          <div>
            <dt>Non comparables</dt>
            <dd>{formaterNombre(s.non_comparables, 0)}</dd>
          </div>
        </dl>
        <Alerte tonalite="info" annonce="aucune">
          <p>{TEXTE_CLOTURE_EVOLUTION}</p>
        </Alerte>
      </div>
    </Carte>
  );
}
