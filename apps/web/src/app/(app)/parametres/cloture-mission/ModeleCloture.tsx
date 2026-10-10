"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../components/ui/CaseACocher";
import { api } from "../../../../lib/api";
import {
  chargeModele,
  modeleModifie,
  type ItemModeleCloture,
  type ReglageItem,
} from "../../../../lib/cloture";

/** Paramétrage du modèle de check-list de clôture du cabinet (activer, rendre bloquant). */
export function ModeleCloture({ items }: { items: ItemModeleCloture[] }) {
  const f = useFormulaire<never>();
  const [reglages, setReglages] = useState<ReglageItem[]>(
    items.map((i) => ({ controle: i.controle, actif: i.actif, bloquant: i.bloquant })),
  );

  function changer(controle: string, champ: "actif" | "bloquant", valeur: boolean) {
    setReglages((liste) =>
      liste.map((r) => {
        if (r.controle !== controle) return r;
        const suivant = { ...r, [champ]: valeur };
        // Un item désactivé ne bloque jamais.
        return suivant.actif ? suivant : { ...suivant, bloquant: false };
      }),
    );
  }

  async function enregistrer(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      { ok: true, charge: chargeModele(reglages) },
      (c) => api.put("/api/cloture/modele", c),
      { succes: "Modèle de check-list enregistré." },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={enregistrer}>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Enregistrement impossible"
      />
      <ul className="mp-liste-lignes" aria-label="Items du modèle de clôture">
        {items.map((item) => {
          const r = reglages.find((x) => x.controle === item.controle);
          if (!r) return null;
          return (
            <li key={item.controle} className="mp-liste-lignes__ligne">
              <span className="mp-liste-lignes__texte">
                <strong>{item.libelle}</strong>
                <span className="mp-texte-doux">{item.description}</span>
              </span>
              <div className="mp-pile">
                <CaseACocher
                  libelle="Actif"
                  checked={r.actif}
                  onChange={(e) => changer(item.controle, "actif", e.target.checked)}
                />
                <CaseACocher
                  libelle="Bloquant"
                  checked={r.bloquant}
                  disabled={!r.actif}
                  onChange={(e) => changer(item.controle, "bloquant", e.target.checked)}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mp-barre-actions">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement="Enregistrement…"
          disabled={!modeleModifie(items, reglages)}
        >
          Enregistrer le modèle
        </Bouton>
      </div>
    </form>
  );
}
