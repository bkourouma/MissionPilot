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
        validerRubriqueModification(s),
        (c) => api.patch(`${base}/${rubrique.id}`, c),
        { succes: "Rubrique modifiée.", messageSpecifique: messageMethodes },
      );
      return;
    }
    const ok = await f.envoyer(validerRubriqueCreation(s), (c) => api.post(base, c), {
      succes: "Rubrique ajoutée.",
      messageSpecifique: messageMethodes,
    });
    if (ok) setS(saisieRubriqueVide());
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle="Libellé de la rubrique"
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
          libelle="Code"
          required
          value={s.code}
          maxLength={120}
          spellCheck={false}
          autoComplete="off"
          readOnly={Boolean(rubrique)}
          aide={rubrique ? "Le code ne change pas." : undefined}
          onChange={(e) => setS({ ...s, code: e.target.value })}
          erreur={f.erreurs.code}
        />
        <Champ
          libelle="Dimension (facultatif)"
          value={s.dimension}
          maxLength={120}
          spellCheck={false}
          onChange={(e) => setS({ ...s, dimension: e.target.value })}
          erreur={f.erreurs.dimension}
          aide="Code de la dimension évaluée, ex. gouvernance."
        />
        <Select
          libelle="Brique (facultatif)"
          value={s.brique_id}
          onChange={(e) => setS({ ...s, brique_id: e.target.value })}
          invite="Aucune brique"
          options={briques.map((b) => ({ valeur: b.id, libelle: b.libelle }))}
          aide="Une rubrique rattachée à aucune brique n'est jamais utilisée."
        />
      </div>

      {f.erreurs.ancrages ? <p className="mp-champ__erreur">{f.erreurs.ancrages}</p> : null}
      {NIVEAUX_ANCRAGE.map((niveau, i) => {
        const a = s.ancrages[i]!;
        return (
          <fieldset key={niveau} className="mp-groupe">
            <legend className="mp-champ__libelle">Niveau {niveau} sur 5</legend>
            <ZoneTexte
              libelle={`Comportement observable au niveau ${niveau}`}
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
                    libelle={`Contexte de l'exemple ${k + 1}`}
                    value={x.contexte}
                    maxLength={120}
                    onChange={(e) => majExemple(i, k, { contexte: e.target.value })}
                    aide="Ex. PME agricole, grand groupe."
                  />
                  <ZoneTexte
                    libelle="Exemple"
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
                  Retirer l&apos;exemple
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
                Ajouter un exemple au niveau {niveau}
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
          texteChargement={rubrique ? "Enregistrement…" : "Ajout…"}
        >
          {rubrique ? "Enregistrer la rubrique" : "Ajouter la rubrique"}
        </Bouton>
      </div>
    </form>
  );
}
