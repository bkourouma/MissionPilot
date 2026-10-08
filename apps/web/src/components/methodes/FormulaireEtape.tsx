"use client";

import { useState, type FormEvent } from "react";
import { codeReferentielSchema } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { codeDepuisLibelle, messageMethodes } from "../../lib/methodes";
import type { Resultat } from "../../lib/saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";

type ChampEtape = "code" | "libelle";

/** Ajout d'une étape au brouillon (STD-11). */
export function FormulaireEtape({ versionId }: { versionId: string }) {
  const f = useFormulaire<ChampEtape>();
  const [libelle, setLibelle] = useState("");
  const [code, setCode] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const erreurs: Partial<Record<ChampEtape, string>> = {};
    if (!libelle.trim()) erreurs.libelle = "Libellé obligatoire.";
    if (!codeReferentielSchema.safeParse(code).success) erreurs.code = "Code invalide.";
    const validation: Resultat<{ code: string; libelle: string }, ChampEtape> =
      Object.keys(erreurs).length > 0
        ? { ok: false, erreurs }
        : { ok: true, charge: { code, libelle: libelle.trim() } };
    const ok = await f.envoyer(
      validation,
      (charge) => api.post(`/api/methodes/versions/${versionId}/etapes`, charge),
      { succes: "Étape ajoutée.", messageSpecifique: messageMethodes },
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
        <Champ
          libelle="Libellé de l'étape"
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
          autoComplete="off"
          onChange={(e) => setCode(e.target.value)}
          erreur={f.erreurs.code}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" icone="plus" chargement={f.enCours} texteChargement="Ajout…">
          Ajouter l&apos;étape
        </Bouton>
      </div>
    </form>
  );
}
