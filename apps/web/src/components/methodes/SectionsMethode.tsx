import type { ReactNode } from "react";
import { TYPE_ELEMENT_LIBELLES, type TypeElementMethode } from "@missionpilot/shared";
import type { BriqueVersion, EtapeVersion, Facteur, VersionDetail } from "../../lib/methodes";
import { saisieDepuisRegle } from "../../lib/methodes-editeur";
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

function Suppression({
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
  return (
    <BoutonAction
      libelle={libelle}
      chemin={`/api/methodes/versions/${v.version.id}/${collection}/${id}`}
      methode="DELETE"
      variante="discret"
      icone="corbeille"
      confirmation={{ question, libelleConfirmation: "Oui, supprimer" }}
    />
  );
}

export function ModifierEtape({ v, etape }: { v: VersionDetail; etape: EtapeVersion }) {
  return (
    <Repliable libelle="Modifier l'étape">
      <FormulaireEtape versionId={v.version.id} etape={etape} />
    </Repliable>
  );
}

export function ModifierBrique({ v, brique }: { v: VersionDetail; brique: BriqueVersion }) {
  return (
    <Repliable libelle="Modifier la brique">
      <FormulaireBrique versionId={v.version.id} etapes={v.etapes} brique={brique} />
    </Repliable>
  );
}

export function ModifierRegle({
  v,
  regle,
  facteurs,
}: {
  v: VersionDetail;
  regle: VersionDetail["regles"][number];
  facteurs: Facteur[];
}) {
  const saisie = saisieDepuisRegle(regle.regle);
  return (
    <Repliable libelle="Modifier la règle">
      {saisie ? (
        <FormulaireRegle
          versionId={v.version.id}
          facteurs={facteurs}
          briques={v.briques.map((b) => ({ code: b.code, libelle: b.libelle }))}
          modification={{ id: regle.id, active: regle.regle.active !== false, saisie }}
        />
      ) : (
        <p>
          Cette règle utilise des conditions que l&apos;éditeur ne sait pas rouvrir (négation,
          conditions imbriquées ou test d&apos;une brique). Supprimez-la puis recréez-la.
        </p>
      )}
    </Repliable>
  );
}

/** Livrables, items, KPI, initiatives, risques, gabarits. */
export function SectionElements({ v, editable }: { v: VersionDetail; editable: boolean }) {
  return (
    <section className="mp-methode__etape" aria-labelledby="titre-elements">
      <h3 id="titre-elements" className="mp-section__titre">
        Livrables, items, KPI, initiatives, risques, gabarits ({v.elements.length})
      </h3>
      <ul className="mp-liste-simple">
        {v.elements.map((e) => (
          <li key={e.id} className="mp-methode__regle">
            <span>
              {TYPE_ELEMENT_LIBELLES[e.type as TypeElementMethode] ?? e.type} — {e.libelle}{" "}
              <span className="mp-methode__code">({e.code})</span>
              {e.essentiel ? " · essentiel" : ""}
              {e.actif_par_defaut ? "" : " · inactif par défaut"}
              {e.brique_code ? ` · brique ${e.brique_code}` : ""}
            </span>
            {editable ? (
              <>
                <Repliable libelle="Modifier l'élément">
                  <FormulaireElement versionId={v.version.id} briques={idsBriques(v)} element={e} />
                </Repliable>
                <Suppression
                  v={v}
                  collection="elements"
                  id={e.id}
                  libelle="Supprimer l'élément"
                  question={`Supprimer l'élément « ${e.libelle} » du brouillon ?`}
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
export function SectionRubriques({ v, editable }: { v: VersionDetail; editable: boolean }) {
  if (v.rubriques.length === 0) return null;
  return (
    <section className="mp-methode__etape" aria-labelledby="titre-rubriques">
      <h3 id="titre-rubriques" className="mp-section__titre">
        Rubriques à ancrages ({v.rubriques.length})
      </h3>
      {v.rubriques.map((r) => (
        <div key={r.id} className="mp-methode__regle">
          <details className="mp-details">
            <summary>
              {r.libelle} <span className="mp-methode__code">({r.code})</span>
              {r.brique_code ? ` · brique ${r.brique_code}` : " · aucune brique"}
            </summary>
            <ol className="mp-liste-simple">
              {r.ancrages.map((a) => (
                <li key={a.niveau}>
                  <strong>Niveau {a.niveau} :</strong> {a.description}
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
              <Repliable libelle="Modifier la rubrique">
                <FormulaireRubrique versionId={v.version.id} briques={idsBriques(v)} rubrique={r} />
              </Repliable>
              <Suppression
                v={v}
                collection="rubriques"
                id={r.id}
                libelle="Supprimer la rubrique"
                question={`Supprimer la rubrique « ${r.libelle} » du brouillon ?`}
              />
            </>
          ) : null}
        </div>
      ))}
    </section>
  );
}

/** Cas types : contextes types qui vérifient que les règles font ce qu'on attend. */
export function SectionCasTypes({
  v,
  editable,
  facteurs,
}: {
  v: VersionDetail;
  editable: boolean;
  facteurs: Facteur[];
}) {
  if (v.cas_types.length === 0) return null;
  const regles = v.regles.map((r) => ({ code: r.code, libelle: r.regle.libelle ?? r.code }));
  return (
    <section className="mp-methode__etape" aria-labelledby="titre-cas-types">
      <h3 id="titre-cas-types" className="mp-section__titre">
        Cas types ({v.cas_types.length})
      </h3>
      <ul className="mp-liste-simple">
        {v.cas_types.map((c) => (
          <li key={c.id} className="mp-methode__regle">
            <strong>
              {c.libelle ?? c.code} <span className="mp-methode__code">({c.code})</span>
            </strong>
            <span className="mp-texte-doux">
              {(c.cas.attendu.regles_declenchees ?? []).length > 0
                ? `Règles attendues : ${(c.cas.attendu.regles_declenchees ?? []).join(", ")}.`
                : "Aucune règle précisée."}
              {c.cas.attendu.conflits_non_resolus !== undefined
                ? ` Conflits non résolus attendus : ${c.cas.attendu.conflits_non_resolus}.`
                : ""}
            </span>
            {editable ? (
              <>
                <Repliable libelle="Modifier le cas type">
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
                  libelle="Supprimer le cas type"
                  question={`Supprimer le cas type « ${c.libelle ?? c.code} » ?`}
                />
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
