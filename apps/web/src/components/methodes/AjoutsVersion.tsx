import type { Facteur, VersionDetail } from "../../lib/methodes";
import { Carte } from "../ui/Carte";
import { FormulaireBrique } from "./FormulaireBrique";
import { FormulaireCasType } from "./FormulaireCasType";
import { FormulaireElement } from "./FormulaireElement";
import { FormulaireEtape } from "./FormulaireEtape";
import { FormulaireRegle } from "./FormulaireRegle";
import { FormulaireRubrique } from "./FormulaireRubrique";

/**
 * Formulaires d'ajout de l'éditeur sans code (STD-11) pour un brouillon du cabinet : étape,
 * brique, règle de contexte, livrable ou item, rubrique à ancrages, cas type. La modification
 * et la suppression se font en place, dans le contenu de la version.
 */
export function AjoutsVersion({ v, facteurs }: { v: VersionDetail; facteurs: Facteur[] }) {
  const versionId = v.version.id;
  const briques = v.briques.map((b) => ({ id: b.id, libelle: b.libelle }));
  const regles = v.regles.map((r) => ({ code: r.code, libelle: r.regle.libelle ?? r.code }));
  return (
    <div className="mp-pile">
      <Carte titre="Ajouter une étape">
        <FormulaireEtape versionId={versionId} />
      </Carte>
      {v.etapes.length > 0 ? (
        <Carte titre="Ajouter une brique">
          <FormulaireBrique versionId={versionId} etapes={v.etapes} />
        </Carte>
      ) : null}
      <Carte titre="Ajouter une règle de contexte">
        <FormulaireRegle
          versionId={versionId}
          facteurs={facteurs}
          briques={v.briques.map((b) => ({ code: b.code, libelle: b.libelle }))}
        />
      </Carte>
      <Carte titre="Ajouter un livrable, un item, un KPI type…">
        <FormulaireElement versionId={versionId} briques={briques} />
      </Carte>
      <Carte titre="Ajouter une rubrique à ancrages">
        <FormulaireRubrique versionId={versionId} briques={briques} />
      </Carte>
      <Carte titre="Ajouter un cas type">
        <FormulaireCasType versionId={versionId} facteurs={facteurs} regles={regles} />
      </Carte>
    </div>
  );
}
