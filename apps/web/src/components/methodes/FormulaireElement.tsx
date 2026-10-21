"use client";

import { useState, type FormEvent } from "react";
import {
  TYPE_ELEMENT_LIBELLES,
  TYPES_ELEMENT_METHODE,
  type TypeElementMethode,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import { codeDepuisLibelle, messageMethodes, type ElementVersion } from "../../lib/methodes";
import {
  saisieDepuisElement,
  saisieElementVide,
  validerElementCreation,
  validerElementModification,
  type ChampElement,
  type SaisieElement,
} from "../../lib/methodes-editeur";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

/**
 * Élément du brouillon (livrable, item, KPI type, initiative type, risque type, gabarit…) :
 * ajout, ou modification en place si `element` est fourni (le code et le type ne changent pas).
 */
export function FormulaireElement({
  versionId,
  briques,
  element,
}: {
  versionId: string;
  briques: { id: string; libelle: string }[];
  element?: ElementVersion;
}) {
  const f = useFormulaire<ChampElement>();
  const [s, setS] = useState<SaisieElement>(
    element ? saisieDepuisElement(element) : saisieElementVide(),
  );
  const maj = <K extends keyof SaisieElement>(k: K, v: SaisieElement[K]) =>
    setS((x) => ({ ...x, [k]: v }));
  const base = `/api/methodes/versions/${versionId}/elements`;

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (element) {
      await f.envoyer(validerElementModification(s), (c) => api.patch(`${base}/${element.id}`, c), {
        succes: "Élément modifié.",
        messageSpecifique: messageMethodes,
      });
      return;
    }
    const ok = await f.envoyer(validerElementCreation(s), (c) => api.post(base, c), {
      succes: "Élément ajouté.",
      messageSpecifique: messageMethodes,
    });
    if (ok) setS((x) => ({ ...saisieElementVide(), type: x.type, brique_id: x.brique_id }));
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Select
          libelle="Type"
          value={s.type}
          disabled={Boolean(element)}
          aide={element ? "Le type ne change pas." : undefined}
          onChange={(e) => maj("type", e.target.value as TypeElementMethode)}
          options={TYPES_ELEMENT_METHODE.map((t) => ({
            valeur: t,
            libelle: TYPE_ELEMENT_LIBELLES[t],
          }))}
        />
        <Champ
          libelle="Libellé"
          required
          value={s.libelle}
          maxLength={200}
          onChange={(e) => {
            maj("libelle", e.target.value);
            if (!element) maj("code", codeDepuisLibelle(e.target.value));
          }}
          erreur={f.erreurs.libelle}
        />
        <Champ
          libelle="Code"
          required
          value={s.code}
          maxLength={120}
          spellCheck={false}
          readOnly={Boolean(element)}
          aide={element ? "Le code ne change pas." : undefined}
          onChange={(e) => maj("code", e.target.value)}
          erreur={f.erreurs.code}
        />
        <Select
          libelle="Brique"
          value={s.brique_id}
          onChange={(e) => maj("brique_id", e.target.value)}
          invite="Aucune"
          options={briques.map((b) => ({ valeur: b.id, libelle: b.libelle }))}
        />
      </div>
      <ZoneTexte
        libelle="Description"
        rows={2}
        maxLength={2000}
        value={s.description}
        onChange={(e) => maj("description", e.target.value)}
        erreur={f.erreurs.description}
      />
      <CaseACocher
        libelle="Actif par défaut"
        checked={s.actif_par_defaut}
        onChange={(e) => maj("actif_par_defaut", e.target.checked)}
      />
      {s.type === "item" ? (
        <CaseACocher
          libelle="Item essentiel"
          aide="Conservé par le questionnaire réduit."
          checked={s.essentiel}
          onChange={(e) => maj("essentiel", e.target.checked)}
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone={element ? "succes" : "plus"}
          chargement={f.enCours}
          texteChargement={element ? "Enregistrement…" : "Ajout…"}
        >
          {element ? "Enregistrer l'élément" : "Ajouter l'élément"}
        </Bouton>
      </div>
    </form>
  );
}
