import type { ReactNode } from "react";
import type { BriqueVersion, EtapeVersion, Facteur, VersionDetail } from "../../lib/methodes";
import { libelleTypeElement } from "../../lib/methodes-apercu";
import { saisieDepuisRegle } from "../../lib/methodes-editeur";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { BoutonAction } from "./BoutonAction";
import { FormulaireBrique } from "./FormulaireBrique";
import { FormulaireCasType } from "./FormulaireCasType";
import { FormulaireElement } from "./FormulaireElement";
import { FormulaireEtape } from "./FormulaireEtape";
import { FormulaireRegle } from "./FormulaireRegle";
import { FormulaireRubrique } from "./FormulaireRubrique";

/*
 * Sections d'une version et modification en place (STD-11). Composants serveur : ils ne passent
 * aux formulaires clients que des données sérialisables (jamais de fonction).
 */

const idsBriques = (v: VersionDetail) => v.briques.map((b) => ({ id: b.id, libelle: b.libelle }));

/** Formulaire de modification replié sous un titre : l'écran reste lisible. */
function Repliable({ libelle, children }: { libelle: string; children: ReactNode }) {
  return (
    <details className="mp-details">
      <summary>{libelle}</summary>
      {children}
    </details>
  );
}

async function Suppression({
  v,
  collection,
  id,
  libelle,
  question,
}: {
  v: VersionDetail;
  collection: string;
  id: string;
  libelle: string;
  question: string;
}) {
  const t = await obtenirT();
  return (
    <BoutonAction
      libelle={libelle}
      chemin={`/api/methodes/versions/${v.version.id}/${collection}/${id}`}
      methode="DELETE"
      variante="discret"
      icone="corbeille"
      confirmation={{ question, libelleConfirmation: t("Oui, supprimer", "Yes, delete") }}
    />
  );
}

export async function ModifierEtape({ v, etape }: { v: VersionDetail; etape: EtapeVersion }) {
  const t = await obtenirT();
  return (
    <Repliable libelle={t("Modifier l'étape", "Edit the step")}>
      <FormulaireEtape versionId={v.version.id} etape={etape} />
    </Repliable>
  );
}

export async function ModifierBrique({ v, brique }: { v: VersionDetail; brique: BriqueVersion }) {
  const t = await obtenirT();
  return (
    <Repliable libelle={t("Modifier la brique", "Edit the building block")}>
      <FormulaireBrique versionId={v.version.id} etapes={v.etapes} brique={brique} />
    </Repliable>
  );
}

export async function ModifierRegle({
  v,
  regle,
  facteurs,
}: {
  v: VersionDetail;
  regle: VersionDetail["regles"][number];
  facteurs: Facteur[];
}) {
  const t = await obtenirT();
  const saisie = saisieDepuisRegle(regle.regle);
  return (
    <Repliable libelle={t("Modifier la règle", "Edit the rule")}>
      {saisie ? (
        <FormulaireRegle
          versionId={v.version.id}
          facteurs={facteurs}
          briques={v.briques.map((b) => ({ code: b.code, libelle: b.libelle }))}
          modification={{ id: regle.id, active: regle.regle.active !== false, saisie }}
        />
      ) : (
        <p>
          {t(
            "Cette règle utilise des conditions que l'éditeur ne sait pas rouvrir (négation, conditions imbriquées ou test d'une brique). Supprimez-la puis recréez-la.",
            "This rule uses conditions the editor cannot reopen (negation, nested conditions or a building block test). Delete it and create it again.",
          )}
        </p>
      )}
    </Repliable>
  );
}

/** Livrables, items, KPI, initiatives, risques, gabarits. */
export async function SectionElements({ v, editable }: { v: VersionDetail; editable: boolean }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <section className="mp-methode__etape" aria-labelledby="titre-elements">
      <h3 id="titre-elements" className="mp-section__titre">
        {t(
          `Livrables, items, KPI, initiatives, risques, gabarits (${v.elements.length})`,
          `Deliverables, items, KPIs, initiatives, risks, templates (${v.elements.length})`,
        )}
      </h3>
      <ul className="mp-liste-simple">
        {v.elements.map((e) => (
          <li key={e.id} className="mp-methode__regle">
            <span>
              {libelleTypeElement(e.type, langue)} — {e.libelle}{" "}
              <span className="mp-methode__code">({e.code})</span>
              {e.essentiel ? t(" · essentiel", " · essential") : ""}
              {e.actif_par_defaut ? "" : t(" · inactif par défaut", " · inactive by default")}
              {e.brique_code ? ` · ${t("brique", "building block")} ${e.brique_code}` : ""}
            </span>
            {editable ? (
              <>
                <Repliable libelle={t("Modifier l'élément", "Edit the element")}>
                  <FormulaireElement versionId={v.version.id} briques={idsBriques(v)} element={e} />
                </Repliable>
                <Suppression
                  v={v}
                  collection="elements"
                  id={e.id}
                  libelle={t("Supprimer l'élément", "Delete the element")}
                  question={t(
                    `Supprimer l'élément « ${e.libelle} » du brouillon ?`,
                    `Delete the element "${e.libelle}" from the draft?`,
                  )}
                />
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Rubriques à ancrages : cinq niveaux, exemples par contexte. */
export async function SectionRubriques({ v, editable }: { v: VersionDetail; editable: boolean }) {
  if (v.rubriques.length === 0) return null;
  const t = await obtenirT();
  return (
    <section className="mp-methode__etape" aria-labelledby="titre-rubriques">
      <h3 id="titre-rubriques" className="mp-section__titre">
        {t(
          `Rubriques à ancrages (${v.rubriques.length})`,
          `Anchored rubrics (${v.rubriques.length})`,
        )}
      </h3>
      {v.rubriques.map((r) => (
        <div key={r.id} className="mp-methode__regle">
          <details className="mp-details">
            <summary>
              {r.libelle} <span className="mp-methode__code">({r.code})</span>
              {r.brique_code
                ? ` · ${t("brique", "building block")} ${r.brique_code}`
                : t(" · aucune brique", " · no building block")}
            </summary>
            <ol className="mp-liste-simple">
              {r.ancrages.map((a) => (
                <li key={a.niveau}>
                  <strong>{t(`Niveau ${a.niveau} :`, `Level ${a.niveau}:`)}</strong> {a.description}
                  {a.exemples.map((x) => (
                    <span key={x.contexte} className="mp-texte-doux">
                      {" "}
                      — {x.contexte} : {x.texte}
                    </span>
                  ))}
                </li>
              ))}
            </ol>
          </details>
          {editable ? (
            <>
              <Repliable libelle={t("Modifier la rubrique", "Edit the rubric")}>
                <FormulaireRubrique versionId={v.version.id} briques={idsBriques(v)} rubrique={r} />
              </Repliable>
              <Suppression
                v={v}
                collection="rubriques"
                id={r.id}
                libelle={t("Supprimer la rubrique", "Delete the rubric")}
                question={t(
                  `Supprimer la rubrique « ${r.libelle} » du brouillon ?`,
                  `Delete the rubric "${r.libelle}" from the draft?`,
                )}
              />
            </>
          ) : null}
        </div>
      ))}
    </section>
  );
}

/** Cas types : contextes types qui vérifient que les règles font ce qu'on attend. */
export async function SectionCasTypes({
  v,
  editable,
  facteurs,
}: {
  v: VersionDetail;
  editable: boolean;
  facteurs: Facteur[];
}) {
  if (v.cas_types.length === 0) return null;
  const t = await obtenirT();
  const regles = v.regles.map((r) => ({ code: r.code, libelle: r.regle.libelle ?? r.code }));
  return (
    <section className="mp-methode__etape" aria-labelledby="titre-cas-types">
      <h3 id="titre-cas-types" className="mp-section__titre">
        {t(`Cas types (${v.cas_types.length})`, `Test cases (${v.cas_types.length})`)}
      </h3>
      <ul className="mp-liste-simple">
        {v.cas_types.map((c) => (
          <li key={c.id} className="mp-methode__regle">
            <strong>
              {c.libelle ?? c.code} <span className="mp-methode__code">({c.code})</span>
            </strong>
            <span className="mp-texte-doux">
              {(c.cas.attendu.regles_declenchees ?? []).length > 0
                ? t(
                    `Règles attendues : ${(c.cas.attendu.regles_declenchees ?? []).join(", ")}.`,
                    `Expected rules: ${(c.cas.attendu.regles_declenchees ?? []).join(", ")}.`,
                  )
                : t("Aucune règle précisée.", "No rule specified.")}
              {c.cas.attendu.conflits_non_resolus !== undefined
                ? t(
                    ` Conflits non résolus attendus : ${c.cas.attendu.conflits_non_resolus}.`,
                    ` Expected unresolved conflicts: ${c.cas.attendu.conflits_non_resolus}.`,
                  )
                : ""}
            </span>
            {editable ? (
              <>
                <Repliable libelle={t("Modifier le cas type", "Edit the test case")}>
                  <FormulaireCasType
                    versionId={v.version.id}
                    facteurs={facteurs}
                    regles={regles}
                    casType={c}
                  />
                </Repliable>
                <Suppression
                  v={v}
                  collection="cas-types"
                  id={c.id}
                  libelle={t("Supprimer le cas type", "Delete the test case")}
                  question={t(
                    `Supprimer le cas type « ${c.libelle ?? c.code} » ?`,
                    `Delete the test case "${c.libelle ?? c.code}"?`,
                  )}
                />
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
