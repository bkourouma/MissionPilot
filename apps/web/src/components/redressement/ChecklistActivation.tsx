"use client";

import { useState, type FormEvent } from "react";
import type { RedSecteur } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { libelleSecteur } from "../../lib/redressement";
import {
  cheminActivationChecklist,
  MENTION_CHECKLIST_A_VALIDER,
  MENTION_CHECKLIST_A_VALIDER_EN,
  messageDiagnostic,
} from "../../lib/redressement-diagnostic";
import { corpsActivation } from "../../lib/redressement-diagnostic-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"choix">();
  const [choix, setChoix] = useState("");
  const libelle = (o: OptionActivation) => `${o.intitule} (${libelleSecteur(o.secteur, langue)})`;

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const c = corpsActivation(choix, langue);
    await f.envoyer(
      c.ok
        ? { ok: true as const, charge: c.charge }
        : { ok: false as const, erreurs: { choix: c.erreur } },
      (charge) => api.post(cheminActivationChecklist(dossierId), charge),
      {
        succes: t("Check-list activée.", "Checklist activated."),
        messageSpecifique: (e) => messageDiagnostic(e, langue),
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
      aria-label={t("Activer une check-list", "Activate a checklist")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Activation impossible", "Activation not possible")}
      />
      <Select
        libelle={t("Check-list à activer", "Checklist to activate")}
        invite={t("Choisir une check-list…", "Choose a checklist…")}
        value={choix}
        onChange={(e) => setChoix(e.target.value)}
        erreur={f.erreurs.choix}
        aide={
          choix.startsWith("depart:")
            ? t(MENTION_CHECKLIST_A_VALIDER, MENTION_CHECKLIST_A_VALIDER_EN)
            : undefined
        }
        options={[
          ...departs.map((o) => ({
            valeur: o.valeur,
            libelle: `${t("Départ", "Starter")}${t(" : ", ": ")}${libelle(o)}`,
          })),
          ...modeles.map((o) => ({
            valeur: o.valeur,
            libelle: `${t("Modèle du cabinet", "Firm template")}${t(" : ", ": ")}${libelle(o)}`,
          })),
        ]}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="primaire"
          chargement={f.enCours}
          texteChargement={t("Activation…", "Activating…")}
        >
          {t("Activer une check-list", "Activate a checklist")}
        </Bouton>
      </div>
    </form>
  );
}
