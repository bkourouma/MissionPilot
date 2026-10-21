import type { RedClotureContenu } from "@missionpilot/shared";
import { formaterNombre } from "../../lib/format";
import {
  formaterEcartDixiemes,
  formaterScoreDixiemes,
  libelleChangementClasse,
  libelleStatutReNotation,
  TEXTE_RENOTATION_NON_COMPARABLE,
  tonaliteEvolution,
} from "../../lib/redressement-cloture";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";

type Version = RedClotureContenu["renotation"]["premiere"];

function texteVersion(v: Version): string {
  if (!v) return "Aucune version";
  const classe = v.classe ? `classe ${v.classe}` : "sans classe";
  return `Version ${formaterNombre(v.numero, 0)} : ${formaterScoreDixiemes(v.score_dixiemes)} sur 10, ${classe}`;
}

/** Re-notation : score et classe de la première et de la dernière version publiée de la notation. */
export function ClotureRenotation({ contenu }: { contenu: RedClotureContenu }) {
  const r = contenu.renotation;
  const comparable = r.statut === "compare";
  return (
    <Carte titre="Re-notation de la mission" niveauTitre={3}>
      <div className="mp-pile">
        <p className="mp-clo-meta">
          <BadgeStatut tonalite={comparable ? tonaliteEvolution(r.changement_classe) : "neutre"}>
            {comparable ? libelleChangementClasse(r.changement_classe) : "Non comparable"}
          </BadgeStatut>
          <span>{libelleStatutReNotation(r.statut)}</span>
        </p>
        <dl className="mp-clo-liste-def" aria-label="Score et classe avant et après">
          <div>
            <dt>Avant (première version publiée)</dt>
            <dd>{texteVersion(r.premiere)}</dd>
          </div>
          <div>
            <dt>Après (dernière version publiée)</dt>
            <dd>{texteVersion(r.derniere)}</dd>
          </div>
          <div>
            <dt>Écart de score</dt>
            <dd>{formaterEcartDixiemes(r.ecart_dixiemes)}</dd>
          </div>
        </dl>
        {comparable ? null : (
          <Alerte tonalite="info" annonce="aucune">
            <p>{TEXTE_RENOTATION_NON_COMPARABLE}</p>
          </Alerte>
        )}
      </div>
    </Carte>
  );
}
