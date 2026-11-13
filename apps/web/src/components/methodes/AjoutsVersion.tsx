import type { Facteur, VersionDetail } from "../../lib/methodes";
import { obtenirT } from "../../lib/i18n/serveur";
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
export async function AjoutsVersion({ v, facteurs }: { v: VersionDetail; facteurs: Facteur[] }) {
  const t = await obtenirT();
  const versionId = v.version.id;
  const briques = v.briques.map((b) => ({ id: b.id, libelle: b.libelle }));
  const regles = v.regles.map((r) => ({ code: r.code, libelle: r.regle.libelle ?? r.code }));
  return (
    <div className="mp-pile">
      <Carte titre={t("Ajouter une étape", "Add a step")}>
        <FormulaireEtape versionId={versionId} />
      </Carte>
      {v.etapes.length > 0 ? (
        <Carte titre={t("Ajouter une brique", "Add a building block")}>
          <FormulaireBrique versionId={versionId} etapes={v.etapes} />
        </Carte>
      ) : null}
      <Carte titre={t("Ajouter une règle de contexte", "Add a context rule")}>
        <FormulaireRegle
          versionId={versionId}
          facteurs={facteurs}
          briques={v.briques.map((b) => ({ code: b.code, libelle: b.libelle }))}
        />
      </Carte>
      <Carte
        titre={t(
          "Ajouter un livrable, un item, un KPI type…",
          "Add a deliverable, an item, a KPI type…",
        )}
      >
        <FormulaireElement versionId={versionId} briques={briques} />
      </Carte>
      <Carte titre={t("Ajouter une rubrique à ancrages", "Add an anchored rubric")}>
        <FormulaireRubrique versionId={versionId} briques={briques} />
      </Carte>
      <Carte titre={t("Ajouter un cas type", "Add a test case")}>
        <FormulaireCasType versionId={versionId} facteurs={facteurs} regles={regles} />
      </Carte>
    </div>
  );
}
