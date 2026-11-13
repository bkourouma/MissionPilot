import type { Langue, RedClotureContenu } from "@missionpilot/shared";
import { formaterNombre } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import {
  formaterEcartDixiemes,
  formaterScoreDixiemes,
  libelleChangementClasse,
  libelleStatutReNotation,
  textesCloture,
  tonaliteEvolution,
} from "../../lib/redressement-cloture";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";

type Version = RedClotureContenu["renotation"]["premiere"];

function texteVersion(v: Version, langue: Langue): string {
  const en = langue === "en";
  if (!v) return en ? "No version" : "Aucune version";
  const classe = v.classe
    ? `${en ? "class" : "classe"} ${v.classe}`
    : en
      ? "no class"
      : "sans classe";
  const score = formaterScoreDixiemes(v.score_dixiemes, langue);
  return en
    ? `Version ${formaterNombre(v.numero, 0, langue)}: ${score} out of 10, ${classe}`
    : `Version ${formaterNombre(v.numero, 0)} : ${score} sur 10, ${classe}`;
}

/** Re-notation : score et classe de la première et de la dernière version publiée de la notation. */
export async function ClotureRenotation({ contenu }: { contenu: RedClotureContenu }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const r = contenu.renotation;
  const comparable = r.statut === "compare";
  return (
    <Carte titre={t("Re-notation de la mission", "Engagement re-rating")} niveauTitre={3}>
      <div className="mp-pile">
        <p className="mp-clo-meta">
          <BadgeStatut tonalite={comparable ? tonaliteEvolution(r.changement_classe) : "neutre"}>
            {comparable
              ? libelleChangementClasse(r.changement_classe, langue)
              : t("Non comparable", "Not comparable")}
          </BadgeStatut>
          <span>{libelleStatutReNotation(r.statut, langue)}</span>
        </p>
        <dl
          className="mp-clo-liste-def"
          aria-label={t("Score et classe avant et après", "Score and class before and after")}
        >
          <div>
            <dt>{t("Avant (première version publiée)", "Before (first published version)")}</dt>
            <dd>{texteVersion(r.premiere, langue)}</dd>
          </div>
          <div>
            <dt>{t("Après (dernière version publiée)", "After (latest published version)")}</dt>
            <dd>{texteVersion(r.derniere, langue)}</dd>
          </div>
          <div>
            <dt>{t("Écart de score", "Score gap")}</dt>
            <dd>{formaterEcartDixiemes(r.ecart_dixiemes, langue)}</dd>
          </div>
        </dl>
        {comparable ? null : (
          <Alerte tonalite="info" annonce="aucune">
            <p>{textesCloture(langue).renotationNonComparable}</p>
          </Alerte>
        )}
      </div>
    </Carte>
  );
}
