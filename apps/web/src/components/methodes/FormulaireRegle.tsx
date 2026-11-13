"use client";

import { useState, type FormEvent } from "react";
import { CLASSES_RISQUE, type ComparateurModulation } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  COMPARATEURS_PAR_TYPE,
  construireRegle,
  libelleComparateur,
  libelleEffet,
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
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";

const EFFETS_SUR_BRIQUE: readonly TypeEffetEditeur[] = ["activer_brique", "retirer_brique"];
const EFFETS_A_CHOIX: readonly TypeEffetEditeur[] = ["gabarit", "formulation", "benchmark"];
const EFFETS_NUMERIQUES: readonly TypeEffetEditeur[] = ["ponderation", "seuil"];

/**
 * Éditeur de règle de modulation SANS CODE (STD-05, STD-11) : conditions sur les facteurs de
 * contexte (toutes ou au moins une), effets typés ; la règle est construite et validée par
 * `construireRegle`, puis contrôlée par le moteur avant publication. Avec `modification`, la
 * règle existante est rouverte (son code ne change pas) et remplacée en place.
 */
export function FormulaireRegle({
  versionId,
  facteurs,
  briques,
  modification,
}: {
  versionId: string;
  facteurs: Facteur[];
  briques: { code: string; libelle: string }[];
  modification?: { id: string; active: boolean; saisie: SaisieRegle };
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampRegle>();
  const [s, setS] = useState<SaisieRegle>(modification?.saisie ?? saisieRegleVide());
  const [active, setActive] = useState(modification?.active ?? true);

  const majComparaison = (i: number, c: Partial<SaisieComparaison>) =>
    setS((x) => ({
      ...x,
      comparaisons: x.comparaisons.map((y, j) => (j === i ? { ...y, ...c } : y)),
    }));
  const majEffet = (i: number, e: Partial<SaisieEffet>) =>
    setS((x) => ({ ...x, effets: x.effets.map((y, j) => (j === i ? { ...y, ...e } : y)) }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const base = `/api/methodes/versions/${versionId}/regles`;
    const regle = construireRegle(s, facteurs, langue);
    if (modification) {
      await f.envoyer(
        regle,
        (r) => api.put(`${base}/${modification.id}`, active ? r : { ...r, active: false }),
        {
          succes: t(
            "Règle modifiée : vérifiez la cohérence avant publication.",
            "Rule updated: check consistency before publishing.",
          ),
          messageSpecifique: (e) => messageMethodes(e, langue),
        },
      );
      return;
    }
    const ok = await f.envoyer(regle, (r) => api.post(base, r), {
      succes: t(
        "Règle ajoutée : vérifiez la cohérence avant publication.",
        "Rule added: check consistency before publishing.",
      ),
      messageSpecifique: (e) => messageMethodes(e, langue),
    });
    if (ok) setS(saisieRegleVide());
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Code de la règle", "Rule code")}
          required
          value={s.code}
          maxLength={120}
          spellCheck={false}
          readOnly={Boolean(modification)}
          aide={modification ? t("Le code ne change pas.", "The code does not change.") : undefined}
          onChange={(e) => setS({ ...s, code: e.target.value })}
          erreur={f.erreurs.code}
        />
        <Champ
          libelle={t("Libellé", "Label")}
          value={s.libelle}
          maxLength={200}
          onChange={(e) => setS({ ...s, libelle: e.target.value })}
        />
        <Champ
          libelle={t("Priorité", "Priority")}
          inputMode="numeric"
          value={s.priorite}
          onChange={(e) => setS({ ...s, priorite: e.target.value })}
          erreur={f.erreurs.priorite}
          aide={t(
            "De 0 à 1 000 : la plus haute l'emporte en cas de conflit.",
            "From 0 to 1,000: the highest wins in case of conflict.",
          )}
        />
      </div>

      {modification ? (
        <CaseACocher
          libelle={t("Règle active", "Active rule")}
          aide={t(
            "Décochée : la règle est conservée mais ne se déclenche plus.",
            "Unchecked: the rule is kept but no longer triggers.",
          )}
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
      ) : null}

      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">
          {t("Si le contexte vérifie…", "If the context satisfies…")}
        </legend>
        {s.comparaisons.length > 1 ? (
          <Select
            libelle={t("Combinaison", "Combination")}
            value={s.combinaison}
            onChange={(e) =>
              setS({ ...s, combinaison: e.target.value as SaisieRegle["combinaison"] })
            }
            options={[
              { valeur: "tous", libelle: t("Toutes les conditions", "All conditions") },
              {
                valeur: "au_moins_un",
                libelle: t("Au moins une condition", "At least one condition"),
              },
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
                  libelle={t(`Facteur ${i + 1}`, `Factor ${i + 1}`)}
                  value={c.facteur}
                  onChange={(e) =>
                    majComparaison(i, { facteur: e.target.value, comparateur: "", valeur: "" })
                  }
                  invite={t("Choisir…", "Choose…")}
                  options={facteurs.map((x) => ({ valeur: x.code, libelle: x.libelle }))}
                />
                <Select
                  libelle={t("Comparaison", "Comparison")}
                  value={c.comparateur}
                  onChange={(e) =>
                    majComparaison(i, { comparateur: e.target.value as ComparateurModulation })
                  }
                  invite={t("Choisir…", "Choose…")}
                  options={comparateurs.map((x) => ({
                    valeur: x,
                    libelle: libelleComparateur(x, langue),
                  }))}
                />
                {facteur?.type === "booleen" ? (
                  <Select
                    libelle={t("Valeur", "Value")}
                    value={c.valeur}
                    onChange={(e) => majComparaison(i, { valeur: e.target.value })}
                    invite={t("Choisir…", "Choose…")}
                    options={[
                      { valeur: "oui", libelle: t("Oui", "Yes") },
                      { valeur: "non", libelle: t("Non", "No") },
                    ]}
                  />
                ) : facteur?.valeurs &&
                  c.comparateur !== "dans" &&
                  facteur.type === "enumeration" ? (
                  <Select
                    libelle={t("Valeur", "Value")}
                    value={c.valeur}
                    onChange={(e) => majComparaison(i, { valeur: e.target.value })}
                    invite={t("Choisir…", "Choose…")}
                    options={facteur.valeurs.map((v) => ({ valeur: v.code, libelle: v.libelle }))}
                  />
                ) : (
                  <Champ
                    libelle={t("Valeur", "Value")}
                    value={c.valeur}
                    onChange={(e) => majComparaison(i, { valeur: e.target.value })}
                    aide={
                      facteur?.valeurs
                        ? t(
                            `Codes séparés par des virgules : ${facteur.valeurs.map((v) => v.code).join(", ")}`,
                            `Codes separated by commas: ${facteur.valeurs.map((v) => v.code).join(", ")}`,
                          )
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
                  {t("Retirer la condition", "Remove the condition")}
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
          {t("Ajouter une condition", "Add a condition")}
        </Bouton>
      </fieldset>

      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">{t("…alors ajuster", "…then adjust")}</legend>
        {s.effets.map((ef, i) => (
          <div key={i} className="mp-sous-formulaire">
            <div className="mp-grille-champs mp-grille-champs--serree">
              <Select
                libelle={t(`Effet ${i + 1}`, `Effect ${i + 1}`)}
                value={ef.type}
                onChange={(e) =>
                  majEffet(i, { type: e.target.value as TypeEffetEditeur, code: "", valeur: "" })
                }
                options={TYPES_EFFET_EDITEUR.map((te) => ({
                  valeur: te,
                  libelle: libelleEffet(te, langue),
                }))}
              />
              {EFFETS_SUR_BRIQUE.includes(ef.type) ? (
                <Select
                  libelle={t("Brique", "Building block")}
                  value={ef.code}
                  onChange={(e) => majEffet(i, { code: e.target.value })}
                  invite={t("Choisir…", "Choose…")}
                  options={briques.map((b) => ({ valeur: b.code, libelle: b.libelle }))}
                />
              ) : (
                <Champ
                  libelle={t("Cible (code)", "Target (code)")}
                  value={ef.code}
                  spellCheck={false}
                  onChange={(e) => majEffet(i, { code: e.target.value })}
                />
              )}
              {ef.type === "relever_classe_risque" ? (
                <Select
                  libelle={t("Classe", "Class")}
                  value={ef.valeur}
                  onChange={(e) => majEffet(i, { valeur: e.target.value })}
                  invite={t("Choisir…", "Choose…")}
                  options={CLASSES_RISQUE.map((c) => ({ valeur: c, libelle: c }))}
                />
              ) : EFFETS_A_CHOIX.includes(ef.type) || EFFETS_NUMERIQUES.includes(ef.type) ? (
                <Champ
                  libelle={
                    EFFETS_NUMERIQUES.includes(ef.type)
                      ? t("Valeur", "Value")
                      : t("Choix (code)", "Choice (code)")
                  }
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
                {t("Retirer l'effet", "Remove the effect")}
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
          {t("Ajouter un effet", "Add an effect")}
        </Bouton>
      </fieldset>

      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone={modification ? "succes" : "plus"}
          chargement={f.enCours}
          texteChargement={modification ? t("Enregistrement…", "Saving…") : t("Ajout…", "Adding…")}
        >
          {modification
            ? t("Enregistrer la règle", "Save the rule")
            : t("Ajouter la règle", "Add the rule")}
        </Bouton>
      </div>
    </form>
  );
}
