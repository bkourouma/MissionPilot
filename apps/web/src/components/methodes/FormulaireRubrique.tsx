"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { codeDepuisLibelle, messageMethodes, type RubriqueVersion } from "../../lib/methodes";
import {
  EXEMPLES_ANCRAGE_MAX,
  NIVEAUX_ANCRAGE,
  saisieDepuisRubrique,
  saisieRubriqueVide,
  validerRubriqueCreation,
  validerRubriqueModification,
  type ChampRubrique,
  type SaisieAncrage,
  type SaisieRubrique,
} from "../../lib/methodes-rubriques";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

/**
 * Rubrique à ancrages (STD-09) : une dimension évaluée sur cinq niveaux, chacun décrit par un
 * comportement observable et illustré d'exemples par contexte. Avec `rubrique`, modification en
 * place (le code ne change pas).
 */
export function FormulaireRubrique({
  versionId,
  briques,
  rubrique,
}: {
  versionId: string;
  briques: { id: string; libelle: string }[];
  rubrique?: RubriqueVersion;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampRubrique>();
  const [s, setS] = useState<SaisieRubrique>(
    rubrique ? saisieDepuisRubrique(rubrique) : saisieRubriqueVide(),
  );
  const base = `/api/methodes/versions/${versionId}/rubriques`;

  const majAncrage = (i: number, a: Partial<SaisieAncrage>) =>
    setS((x) => ({
      ...x,
      ancrages: x.ancrages.map((y, j) => (j === i ? { ...y, ...a } : y)),
    }));
  const majExemple = (i: number, k: number, e: Partial<{ contexte: string; texte: string }>) =>
    majAncrage(i, {
      exemples: s.ancrages[i]!.exemples.map((x, j) => (j === k ? { ...x, ...e } : x)),
    });

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (rubrique) {
      await f.envoyer(
        validerRubriqueModification(s, langue),
        (c) => api.patch(`${base}/${rubrique.id}`, c),
        {
          succes: t("Rubrique modifiée.", "Rubric updated."),
          messageSpecifique: (e) => messageMethodes(e, langue),
        },
      );
      return;
    }
    const ok = await f.envoyer(validerRubriqueCreation(s, langue), (c) => api.post(base, c), {
      succes: t("Rubrique ajoutée.", "Rubric added."),
      messageSpecifique: (e) => messageMethodes(e, langue),
    });
    if (ok) setS(saisieRubriqueVide());
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Libellé de la rubrique", "Rubric label")}
          required
          value={s.libelle}
          maxLength={200}
          onChange={(e) =>
            setS((x) => ({
              ...x,
              libelle: e.target.value,
              code: rubrique ? x.code : codeDepuisLibelle(e.target.value),
            }))
          }
          erreur={f.erreurs.libelle}
        />
        <Champ
          libelle={t("Code", "Code")}
          required
          value={s.code}
          maxLength={120}
          spellCheck={false}
          autoComplete="off"
          readOnly={Boolean(rubrique)}
          aide={rubrique ? t("Le code ne change pas.", "The code does not change.") : undefined}
          onChange={(e) => setS({ ...s, code: e.target.value })}
          erreur={f.erreurs.code}
        />
        <Champ
          libelle={t("Dimension (facultatif)", "Dimension (optional)")}
          value={s.dimension}
          maxLength={120}
          spellCheck={false}
          onChange={(e) => setS({ ...s, dimension: e.target.value })}
          erreur={f.erreurs.dimension}
          aide={t(
            "Code de la dimension évaluée, ex. gouvernance.",
            "Code of the dimension being rated, e.g. gouvernance.",
          )}
        />
        <Select
          libelle={t("Brique (facultatif)", "Building block (optional)")}
          value={s.brique_id}
          onChange={(e) => setS({ ...s, brique_id: e.target.value })}
          invite={t("Aucune brique", "No building block")}
          options={briques.map((b) => ({ valeur: b.id, libelle: b.libelle }))}
          aide={t(
            "Une rubrique rattachée à aucune brique n'est jamais utilisée.",
            "A rubric attached to no building block is never used.",
          )}
        />
      </div>

      {f.erreurs.ancrages ? <p className="mp-champ__erreur">{f.erreurs.ancrages}</p> : null}
      {NIVEAUX_ANCRAGE.map((niveau, i) => {
        const a = s.ancrages[i]!;
        return (
          <fieldset key={niveau} className="mp-groupe">
            <legend className="mp-champ__libelle">
              {t(`Niveau ${niveau} sur 5`, `Level ${niveau} of 5`)}
            </legend>
            <ZoneTexte
              libelle={t(
                `Comportement observable au niveau ${niveau}`,
                `Observable behavior at level ${niveau}`,
              )}
              required
              rows={2}
              maxLength={1000}
              value={a.description}
              onChange={(e) => majAncrage(i, { description: e.target.value })}
              erreur={f.erreurs[`niveau${niveau}` as ChampRubrique]}
            />
            {a.exemples.map((x, k) => (
              <div key={k} className="mp-sous-formulaire">
                <div className="mp-grille-champs mp-grille-champs--serree">
                  <Champ
                    libelle={t(`Contexte de l'exemple ${k + 1}`, `Context of example ${k + 1}`)}
                    value={x.contexte}
                    maxLength={120}
                    onChange={(e) => majExemple(i, k, { contexte: e.target.value })}
                    aide={t(
                      "Ex. PME agricole, grand groupe.",
                      "E.g. agricultural SME, large group.",
                    )}
                  />
                  <ZoneTexte
                    libelle={t("Exemple", "Example")}
                    rows={2}
                    maxLength={1000}
                    value={x.texte}
                    onChange={(e) => majExemple(i, k, { texte: e.target.value })}
                  />
                </div>
                <Bouton
                  type="button"
                  variante="discret"
                  icone="corbeille"
                  onClick={() => majAncrage(i, { exemples: a.exemples.filter((_, j) => j !== k) })}
                >
                  {t("Retirer l'exemple", "Remove the example")}
                </Bouton>
              </div>
            ))}
            {a.exemples.length < EXEMPLES_ANCRAGE_MAX ? (
              <Bouton
                type="button"
                variante="secondaire"
                icone="plus"
                onClick={() =>
                  majAncrage(i, { exemples: [...a.exemples, { contexte: "", texte: "" }] })
                }
              >
                {t(`Ajouter un exemple au niveau ${niveau}`, `Add an example at level ${niveau}`)}
              </Bouton>
            ) : null}
          </fieldset>
        );
      })}

      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone={rubrique ? "succes" : "plus"}
          chargement={f.enCours}
          texteChargement={rubrique ? t("Enregistrement…", "Saving…") : t("Ajout…", "Adding…")}
        >
          {rubrique
            ? t("Enregistrer la rubrique", "Save the rubric")
            : t("Ajouter la rubrique", "Add the rubric")}
        </Bouton>
      </div>
    </form>
  );
}
