"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { messageMethodes, type Facteur } from "../../lib/methodes";
import {
  construireModificationFacteur,
  saisieModificationFacteur,
  type ChampModificationFacteur,
  type SaisieModificationFacteur,
} from "../../lib/methodes-facteurs";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { ZoneTexte } from "../ui/ZoneTexte";

/**
 * Modification d'un facteur de contexte PROPRE AU CABINET (STD-04, STD-11), toujours additive :
 * libellé et description se corrigent, des valeurs s'ajoutent à la liste sans qu'aucune ne soit
 * retirée, les bornes d'un nombre s'élargissent sans se resserrer. Ainsi les règles, cas types et
 * missions qui s'y réfèrent restent valides. Le code, le type et le porteur sont figés.
 */
export function FormulaireModificationFacteur({ facteur }: { facteur: Facteur }) {
  const f = useFormulaire<ChampModificationFacteur>();
  const [s, setS] = useState<SaisieModificationFacteur>(saisieModificationFacteur(facteur));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      construireModificationFacteur(facteur, s),
      (c) => api.patch(`/api/standard/facteurs/${facteur.id}`, c),
      { succes: "Facteur modifié.", messageSpecifique: messageMethodes },
    );
    if (ok) setS((x) => ({ ...x, nouvelles: "" }));
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <Champ
        libelle="Libellé"
        required
        value={s.libelle}
        maxLength={200}
        onChange={(e) => setS({ ...s, libelle: e.target.value })}
        erreur={f.erreurs.libelle}
      />
      <ZoneTexte
        libelle="Description"
        rows={2}
        maxLength={2000}
        value={s.description}
        onChange={(e) => setS({ ...s, description: e.target.value })}
        erreur={f.erreurs.description}
      />
      {facteur.valeurs ? (
        <div className="mp-groupe">
          <p className="mp-champ__libelle">Valeurs existantes</p>
          <ul className="mp-liste-simple">
            {facteur.valeurs.map((v) => (
              <li key={v.code}>
                {v.libelle} <span className="mp-methode__code">({v.code})</span>
              </li>
            ))}
          </ul>
          <p className="mp-texte-doux mp-texte-petit">
            Une valeur existante ne se retire pas : des règles, des cas types ou des missions
            peuvent s&apos;y référer.
          </p>
          <ZoneTexte
            libelle="Valeurs à ajouter"
            rows={3}
            value={s.nouvelles}
            onChange={(e) => setS({ ...s, nouvelles: e.target.value })}
            erreur={f.erreurs.nouvelles}
            aide="Une par ligne : « code : libellé », ex. « bio : Certifiée bio »."
          />
        </div>
      ) : null}
      {facteur.type === "nombre" ? (
        <div className="mp-grille-champs">
          <Champ
            libelle="Minimum"
            inputMode="decimal"
            value={s.min}
            onChange={(e) => setS({ ...s, min: e.target.value })}
            erreur={f.erreurs.min}
            aide={
              facteur.min === null
                ? "Pas de borne minimale."
                : "Peut baisser ou être vidé, jamais augmenter."
            }
          />
          <Champ
            libelle="Maximum"
            inputMode="decimal"
            value={s.max}
            onChange={(e) => setS({ ...s, max: e.target.value })}
            erreur={f.erreurs.max}
            aide={
              facteur.max === null
                ? "Pas de borne maximale."
                : "Peut augmenter ou être vidé, jamais baisser."
            }
          />
        </div>
      ) : null}
      <p className="mp-texte-doux mp-texte-petit">
        Le code, le type et le porteur du facteur ne changent pas.
      </p>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="succes"
          chargement={f.enCours}
          texteChargement="Enregistrement…"
        >
          Enregistrer le facteur
        </Bouton>
      </div>
    </form>
  );
}
