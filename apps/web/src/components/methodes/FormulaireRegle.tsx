"use client";

import { useState, type FormEvent } from "react";
import { CLASSES_RISQUE, type ComparateurModulation } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  COMPARATEUR_LIBELLES,
  COMPARATEURS_PAR_TYPE,
  construireRegle,
  EFFET_LIBELLES,
  messageMethodes,
  saisieRegleVide,
  TYPES_EFFET_EDITEUR,
  type ChampRegle,
  type Facteur,
  type SaisieComparaison,
  type SaisieEffet,
  type SaisieRegle,
  type TypeEffetEditeur,
} from "../../lib/methodes";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";

const EFFETS_SUR_BRIQUE: readonly TypeEffetEditeur[] = ["activer_brique", "retirer_brique"];
const EFFETS_A_CHOIX: readonly TypeEffetEditeur[] = ["gabarit", "formulation", "benchmark"];
const EFFETS_NUMERIQUES: readonly TypeEffetEditeur[] = ["ponderation", "seuil"];

/**
 * Éditeur de règle de modulation SANS CODE (STD-05, STD-11) : conditions sur les facteurs de
 * contexte (toutes ou au moins une), effets typés ; la règle est construite et validée par
 * `construireRegle`, puis contrôlée par le moteur avant publication.
 */
export function FormulaireRegle({
  versionId,
  facteurs,
  briques,
}: {
  versionId: string;
  facteurs: Facteur[];
  briques: { code: string; libelle: string }[];
}) {
  const f = useFormulaire<ChampRegle>();
  const [s, setS] = useState<SaisieRegle>(saisieRegleVide());

  const majComparaison = (i: number, c: Partial<SaisieComparaison>) =>
    setS((x) => ({
      ...x,
      comparaisons: x.comparaisons.map((y, j) => (j === i ? { ...y, ...c } : y)),
    }));
  const majEffet = (i: number, e: Partial<SaisieEffet>) =>
    setS((x) => ({ ...x, effets: x.effets.map((y, j) => (j === i ? { ...y, ...e } : y)) }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      construireRegle(s, facteurs),
      (regle) => api.post(`/api/methodes/versions/${versionId}/regles`, regle),
      {
        succes: "Règle ajoutée : vérifiez la cohérence avant publication.",
        messageSpecifique: messageMethodes,
      },
    );
    if (ok) setS(saisieRegleVide());
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle="Code de la règle"
          required
          value={s.code}
          maxLength={120}
          spellCheck={false}
          onChange={(e) => setS({ ...s, code: e.target.value })}
          erreur={f.erreurs.code}
        />
        <Champ
          libelle="Libellé"
          value={s.libelle}
          maxLength={200}
          onChange={(e) => setS({ ...s, libelle: e.target.value })}
        />
        <Champ
          libelle="Priorité"
          inputMode="numeric"
          value={s.priorite}
          onChange={(e) => setS({ ...s, priorite: e.target.value })}
          erreur={f.erreurs.priorite}
          aide="De 0 à 1 000 : la plus haute l'emporte en cas de conflit."
        />
      </div>

      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">Si le contexte vérifie…</legend>
        {s.comparaisons.length > 1 ? (
          <Select
            libelle="Combinaison"
            value={s.combinaison}
            onChange={(e) =>
              setS({ ...s, combinaison: e.target.value as SaisieRegle["combinaison"] })
            }
            options={[
              { valeur: "tous", libelle: "Toutes les conditions" },
              { valeur: "au_moins_un", libelle: "Au moins une condition" },
            ]}
          />
        ) : null}
        {s.comparaisons.map((c, i) => {
          const facteur = facteurs.find((x) => x.code === c.facteur);
          const comparateurs = facteur ? COMPARATEURS_PAR_TYPE[facteur.type] : [];
          return (
            <div key={i} className="mp-sous-formulaire">
              <div className="mp-grille-champs mp-grille-champs--serree">
                <Select
                  libelle={`Facteur ${i + 1}`}
                  value={c.facteur}
                  onChange={(e) =>
                    majComparaison(i, { facteur: e.target.value, comparateur: "", valeur: "" })
                  }
                  invite="Choisir…"
                  options={facteurs.map((x) => ({ valeur: x.code, libelle: x.libelle }))}
                />
                <Select
                  libelle="Comparaison"
                  value={c.comparateur}
                  onChange={(e) =>
                    majComparaison(i, { comparateur: e.target.value as ComparateurModulation })
                  }
                  invite="Choisir…"
                  options={comparateurs.map((x) => ({
                    valeur: x,
                    libelle: COMPARATEUR_LIBELLES[x],
                  }))}
                />
                {facteur?.type === "booleen" ? (
                  <Select
                    libelle="Valeur"
                    value={c.valeur}
                    onChange={(e) => majComparaison(i, { valeur: e.target.value })}
                    invite="Choisir…"
                    options={[
                      { valeur: "oui", libelle: "Oui" },
                      { valeur: "non", libelle: "Non" },
                    ]}
                  />
                ) : facteur?.valeurs &&
                  c.comparateur !== "dans" &&
                  facteur.type === "enumeration" ? (
                  <Select
                    libelle="Valeur"
                    value={c.valeur}
                    onChange={(e) => majComparaison(i, { valeur: e.target.value })}
                    invite="Choisir…"
                    options={facteur.valeurs.map((v) => ({ valeur: v.code, libelle: v.libelle }))}
                  />
                ) : (
                  <Champ
                    libelle="Valeur"
                    value={c.valeur}
                    onChange={(e) => majComparaison(i, { valeur: e.target.value })}
                    aide={
                      facteur?.valeurs
                        ? `Codes séparés par des virgules : ${facteur.valeurs.map((v) => v.code).join(", ")}`
                        : undefined
                    }
                  />
                )}
              </div>
              {s.comparaisons.length > 1 ? (
                <Bouton
                  type="button"
                  variante="discret"
                  icone="corbeille"
                  onClick={() =>
                    setS({ ...s, comparaisons: s.comparaisons.filter((_, j) => j !== i) })
                  }
                >
                  Retirer la condition
                </Bouton>
              ) : null}
            </div>
          );
        })}
        {f.erreurs.comparaisons ? (
          <p className="mp-champ__erreur">{f.erreurs.comparaisons}</p>
        ) : null}
        <Bouton
          type="button"
          variante="secondaire"
          icone="plus"
          onClick={() =>
            setS({
              ...s,
              comparaisons: [...s.comparaisons, { facteur: "", comparateur: "", valeur: "" }],
            })
          }
        >
          Ajouter une condition
        </Bouton>
      </fieldset>

      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">…alors ajuster</legend>
        {s.effets.map((ef, i) => (
          <div key={i} className="mp-sous-formulaire">
            <div className="mp-grille-champs mp-grille-champs--serree">
              <Select
                libelle={`Effet ${i + 1}`}
                value={ef.type}
                onChange={(e) =>
                  majEffet(i, { type: e.target.value as TypeEffetEditeur, code: "", valeur: "" })
                }
                options={TYPES_EFFET_EDITEUR.map((t) => ({
                  valeur: t,
                  libelle: EFFET_LIBELLES[t],
                }))}
              />
              {EFFETS_SUR_BRIQUE.includes(ef.type) ? (
                <Select
                  libelle="Brique"
                  value={ef.code}
                  onChange={(e) => majEffet(i, { code: e.target.value })}
                  invite="Choisir…"
                  options={briques.map((b) => ({ valeur: b.code, libelle: b.libelle }))}
                />
              ) : (
                <Champ
                  libelle="Cible (code)"
                  value={ef.code}
                  spellCheck={false}
                  onChange={(e) => majEffet(i, { code: e.target.value })}
                />
              )}
              {ef.type === "relever_classe_risque" ? (
                <Select
                  libelle="Classe"
                  value={ef.valeur}
                  onChange={(e) => majEffet(i, { valeur: e.target.value })}
                  invite="Choisir…"
                  options={CLASSES_RISQUE.map((c) => ({ valeur: c, libelle: c }))}
                />
              ) : EFFETS_A_CHOIX.includes(ef.type) || EFFETS_NUMERIQUES.includes(ef.type) ? (
                <Champ
                  libelle={EFFETS_NUMERIQUES.includes(ef.type) ? "Valeur" : "Choix (code)"}
                  inputMode={EFFETS_NUMERIQUES.includes(ef.type) ? "decimal" : undefined}
                  value={ef.valeur}
                  onChange={(e) => majEffet(i, { valeur: e.target.value })}
                />
              ) : null}
            </div>
            {s.effets.length > 1 ? (
              <Bouton
                type="button"
                variante="discret"
                icone="corbeille"
                onClick={() => setS({ ...s, effets: s.effets.filter((_, j) => j !== i) })}
              >
                Retirer l&apos;effet
              </Bouton>
            ) : null}
          </div>
        ))}
        {f.erreurs.effets ? <p className="mp-champ__erreur">{f.erreurs.effets}</p> : null}
        <Bouton
          type="button"
          variante="secondaire"
          icone="plus"
          onClick={() =>
            setS({ ...s, effets: [...s.effets, { type: "activer_brique", code: "", valeur: "" }] })
          }
        >
          Ajouter un effet
        </Bouton>
      </fieldset>

      <div className="mp-actions-formulaire">
        <Bouton type="submit" icone="plus" chargement={f.enCours} texteChargement="Ajout…">
          Ajouter la règle
        </Bouton>
      </div>
    </form>
  );
}
