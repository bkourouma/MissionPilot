"use client";

import { useState, type FormEvent } from "react";
import type { RedSecteur } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { libelleSecteur } from "../../lib/redressement";
import {
  cheminActivationChecklist,
  MENTION_CHECKLIST_A_VALIDER,
  messageDiagnostic,
} from "../../lib/redressement-diagnostic";
import { corpsActivation } from "../../lib/redressement-diagnostic-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Select } from "../ui/Select";

export interface OptionActivation {
  /** « depart:<code> » ou « modele:<id> ». */
  valeur: string;
  intitule: string;
  secteur: RedSecteur;
}

/**
 * Activation d'une check-list dans le dossier : contenu de départ (provisoire, à valider par un
 * expert) ou version publiée d'un modèle du cabinet. L'instantané est figé à l'activation.
 */
export function ChecklistActivation({
  dossierId,
  departs,
  modeles,
}: {
  dossierId: string;
  departs: OptionActivation[];
  modeles: OptionActivation[];
}) {
  const f = useFormulaire<"choix">();
  const [choix, setChoix] = useState("");
  const libelle = (o: OptionActivation) => `${o.intitule} (${libelleSecteur(o.secteur)})`;

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const c = corpsActivation(choix);
    await f.envoyer(
      c.ok
        ? { ok: true as const, charge: c.charge }
        : { ok: false as const, erreurs: { choix: c.erreur } },
      (charge) => api.post(cheminActivationChecklist(dossierId), charge),
      {
        succes: "Check-list activée.",
        messageSpecifique: messageDiagnostic,
        apres: () => setChoix(""),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Activer une check-list"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Activation impossible"
      />
      <Select
        libelle="Check-list à activer"
        invite="Choisir une check-list…"
        value={choix}
        onChange={(e) => setChoix(e.target.value)}
        erreur={f.erreurs.choix}
        aide={choix.startsWith("depart:") ? MENTION_CHECKLIST_A_VALIDER : undefined}
        options={[
          ...departs.map((o) => ({ valeur: o.valeur, libelle: `Départ : ${libelle(o)}` })),
          ...modeles.map((o) => ({
            valeur: o.valeur,
            libelle: `Modèle du cabinet : ${libelle(o)}`,
          })),
        ]}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="primaire"
          chargement={f.enCours}
          texteChargement="Activation…"
        >
          Activer une check-list
        </Bouton>
      </div>
    </form>
  );
}
