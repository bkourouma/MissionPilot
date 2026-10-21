"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  codeDepuisLibelle,
  messageMethodes,
  type CasTypeVersion,
  type Facteur,
} from "../../lib/methodes";
import {
  construireCasType,
  saisieCasTypeVide,
  saisieDepuisCasType,
  type ChampCasType,
  type SaisieCasType,
} from "../../lib/methodes-cas-types";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { GroupeCases } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { ChampsContexte } from "./ChampsContexte";

/**
 * Cas type d'un jeu de règles (STD-05, STD-11) : un contexte de mission type, les règles qui
 * doivent s'y déclencher et, si l'on veut, le nombre de conflits non résolus attendu. Le contrôle
 * de cohérence rejoue chaque cas type avant publication. Avec `casType`, modification en place
 * (le code ne change pas ; les effets attendus qu'il ne montre pas sont conservés).
 */
export function FormulaireCasType({
  versionId,
  facteurs,
  regles,
  casType,
}: {
  versionId: string;
  facteurs: Facteur[];
  regles: { code: string; libelle: string }[];
  casType?: CasTypeVersion;
}) {
  const f = useFormulaire<ChampCasType>();
  const [s, setS] = useState<SaisieCasType>(
    casType ? saisieDepuisCasType(casType) : saisieCasTypeVide(),
  );
  const base = `/api/methodes/versions/${versionId}/cas-types`;
  const prefixe = `cas-${casType?.id ?? "nouveau"}`;

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const validation = construireCasType(
      s,
      facteurs,
      regles.map((r) => r.code),
      casType?.cas,
    );
    if (casType) {
      await f.envoyer(validation, (c) => api.put(`${base}/${casType.id}`, c), {
        succes: "Cas type modifié : vérifiez la cohérence avant publication.",
        messageSpecifique: messageMethodes,
      });
      return;
    }
    const ok = await f.envoyer(validation, (c) => api.post(base, c), {
      succes: "Cas type ajouté : vérifiez la cohérence avant publication.",
      messageSpecifique: messageMethodes,
    });
    if (ok) setS(saisieCasTypeVide());
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle="Libellé du cas type"
          required
          value={s.libelle}
          maxLength={200}
          onChange={(e) =>
            setS((x) => ({
              ...x,
              libelle: e.target.value,
              code: casType ? x.code : codeDepuisLibelle(e.target.value),
            }))
          }
          erreur={f.erreurs.libelle}
          aide="Ex. PME agricole familiale de moins de 20 salariés."
        />
        <Champ
          libelle="Code"
          required
          value={s.code}
          maxLength={120}
          spellCheck={false}
          autoComplete="off"
          readOnly={Boolean(casType)}
          aide={casType ? "Le code ne change pas." : undefined}
          onChange={(e) => setS({ ...s, code: e.target.value })}
          erreur={f.erreurs.code}
        />
      </div>

      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">Contexte de la mission type</legend>
        <ChampsContexte
          prefixe={prefixe}
          facteurs={facteurs}
          valeur={s.contexte}
          onChange={(contexte) => setS({ ...s, contexte })}
          erreurs={f.erreurs}
        />
      </fieldset>

      {regles.length > 0 ? (
        <GroupeCases
          nom={`${prefixe}-regles`}
          legende="Règles qui doivent se déclencher dans ce contexte"
          aide="Le contrôle de cohérence échoue si l'une d'elles ne se déclenche pas."
          options={regles.map((r) => ({ valeur: r.code, libelle: r.libelle }))}
          valeurs={s.regles}
          onChange={(regles) => setS({ ...s, regles })}
          erreur={f.erreurs.regles}
        />
      ) : (
        <p className="mp-texte-doux">
          Cette version n&apos;a pas encore de règle de contexte : ajoutez-en une pour attendre son
          déclenchement.
        </p>
      )}

      <Champ
        libelle="Conflits non résolus attendus (facultatif)"
        inputMode="numeric"
        value={s.conflits}
        onChange={(e) => setS({ ...s, conflits: e.target.value })}
        erreur={f.erreurs.conflits}
        aide="Nombre de conflits entre règles que ce contexte doit laisser sans arbitrage ; 0 pour exiger qu'il n'y en ait aucun. Vide : non vérifié."
      />
      {casType && (casType.cas.attendu.presents?.length || casType.cas.attendu.absents?.length) ? (
        <p className="mp-texte-doux mp-texte-petit">
          Les effets attendus déjà enregistrés pour ce cas type sont conservés tels quels.
        </p>
      ) : null}

      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone={casType ? "succes" : "plus"}
          chargement={f.enCours}
          texteChargement={casType ? "Enregistrement…" : "Ajout…"}
        >
          {casType ? "Enregistrer le cas type" : "Ajouter le cas type"}
        </Bouton>
      </div>
    </form>
  );
}
