"use client";

import { useState, type FormEvent } from "react";
import {
  codeReferentielSchema,
  TYPE_ELEMENT_LIBELLES,
  TYPES_ELEMENT_METHODE,
  type TypeElementMethode,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import { codeDepuisLibelle, messageMethodes } from "../../lib/methodes";
import type { Resultat } from "../../lib/saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";

type ChampElement = "code" | "libelle";

/** Ajout d'un élément (livrable, item, KPI type, initiative type, risque type, gabarit…). */
export function FormulaireElement({
  versionId,
  briques,
}: {
  versionId: string;
  briques: { id: string; libelle: string }[];
}) {
  const f = useFormulaire<ChampElement>();
  const [type, setType] = useState<TypeElementMethode>("livrable");
  const [libelle, setLibelle] = useState("");
  const [code, setCode] = useState("");
  const [briqueId, setBriqueId] = useState("");
  const [essentiel, setEssentiel] = useState(false);
  const [actif, setActif] = useState(true);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const erreurs: Partial<Record<ChampElement, string>> = {};
    if (!libelle.trim()) erreurs.libelle = "Libellé obligatoire.";
    if (!codeReferentielSchema.safeParse(code).success) erreurs.code = "Code invalide.";
    const charge = {
      type,
      code,
      libelle: libelle.trim(),
      brique_id: briqueId || null,
      essentiel,
      actif_par_defaut: actif,
    };
    const validation: Resultat<typeof charge, ChampElement> =
      Object.keys(erreurs).length > 0 ? { ok: false, erreurs } : { ok: true, charge };
    const ok = await f.envoyer(
      validation,
      (c) => api.post(`/api/methodes/versions/${versionId}/elements`, c),
      { succes: "Élément ajouté.", messageSpecifique: messageMethodes },
    );
    if (ok) {
      setLibelle("");
      setCode("");
    }
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Select
          libelle="Type"
          value={type}
          onChange={(e) => setType(e.target.value as TypeElementMethode)}
          options={TYPES_ELEMENT_METHODE.map((t) => ({
            valeur: t,
            libelle: TYPE_ELEMENT_LIBELLES[t],
          }))}
        />
        <Champ
          libelle="Libellé"
          required
          value={libelle}
          maxLength={200}
          onChange={(e) => {
            setLibelle(e.target.value);
            setCode(codeDepuisLibelle(e.target.value));
          }}
          erreur={f.erreurs.libelle}
        />
        <Champ
          libelle="Code"
          required
          value={code}
          maxLength={120}
          spellCheck={false}
          onChange={(e) => setCode(e.target.value)}
          erreur={f.erreurs.code}
        />
        <Select
          libelle="Brique"
          value={briqueId}
          onChange={(e) => setBriqueId(e.target.value)}
          invite="Aucune"
          options={briques.map((b) => ({ valeur: b.id, libelle: b.libelle }))}
        />
      </div>
      <CaseACocher
        libelle="Actif par défaut"
        checked={actif}
        onChange={(e) => setActif(e.target.checked)}
      />
      {type === "item" ? (
        <CaseACocher
          libelle="Item essentiel"
          aide="Conservé par le questionnaire réduit."
          checked={essentiel}
          onChange={(e) => setEssentiel(e.target.checked)}
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" icone="plus" chargement={f.enCours} texteChargement="Ajout…">
          Ajouter l&apos;élément
        </Bouton>
      </div>
    </form>
  );
}
