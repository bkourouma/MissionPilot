"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { cheminPorteur, messageCascade } from "../../lib/plan-cascade";
import { optionsResponsables, type PersonnePlan } from "../../lib/plan-elements";
import type { Resultat } from "../../lib/saisie";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Select } from "../ui/Select";

export interface FormulairePorteurProps {
  planId: string;
  elementId: string;
  titre: string;
  porteurId: string | null;
  personnes: readonly PersonnePlan[];
}

/**
 * Porteur de la vision, d'un axe ou d'un objectif (PLA-12) : nouvelle version de la
 * désignation, « Non désigné » la retire. L'API refuse un porteur inconnu ou du portail.
 */
export function FormulairePorteur({
  planId,
  elementId,
  titre,
  porteurId,
  personnes,
}: FormulairePorteurProps) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"porteur_id">();
  const [valeur, setValeur] = useState(porteurId ?? "");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const validation: Resultat<{ porteur_id: string | null }, "porteur_id"> =
      valeur === (porteurId ?? "")
        ? {
            ok: false,
            erreurs: { porteur_id: t("Choisissez un autre porteur.", "Choose a different owner.") },
          }
        : { ok: true, charge: { porteur_id: valeur || null } };
    await f.envoyer(validation, (charge) => api.put(cheminPorteur(planId, elementId), charge), {
      succes: t("Porteur enregistré.", "Owner saved."),
      messageSpecifique: (e) => messageCascade(e, langue),
    });
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t(`Porteur de « ${titre} »`, `Owner of \u201c${titre}\u201d`)}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Désignation refusée", "Assignment refused")}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Porteur", "Owner")}
          options={optionsResponsables(personnes, porteurId, langue)}
          value={valeur}
          onChange={(e) => setValeur(e.target.value)}
          erreur={f.erreurs.porteur_id}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Désigner", "Assign")}
        </Bouton>
      </div>
    </form>
  );
}
