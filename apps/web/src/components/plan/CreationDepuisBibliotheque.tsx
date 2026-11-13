"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { libelleDevise, type Devise } from "../../lib/format";
import {
  cheminDepuisBibliotheque,
  messageBibliotheque,
  SAISIE_DEPUIS_BIBLIOTHEQUE_VIDE,
  validerDepuisBibliotheque,
  type InitiativeType,
  type SaisieDepuisBibliotheque,
} from "../../lib/plan-bibliotheque";
import { optionsResponsables, type PersonnePlan } from "../../lib/plan-elements";
import type { Resultat } from "../../lib/saisie";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useRafraichir } from "../formulaires/useRafraichir";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";

export interface CreationDepuisBibliothequeProps {
  planId: string;
  devisePlan: Devise;
  type: Pick<InitiativeType, "id" | "devise" | "titre">;
  /** Axes et objectifs actifs du plan où rattacher l'initiative. */
  parents: readonly { valeur: string; libelle: string }[];
  personnes: readonly PersonnePlan[];
}

/**
 * Création d'une initiative du plan depuis une initiative type (PLA-13) : rattachement, début
 * (obligatoire), échéance et budget facultatifs (l'API reprend le coût type et calcule l'échéance
 * par le moteur), responsable. L'initiative créée est un brouillon à valider comme les autres.
 */
export function CreationDepuisBibliotheque({
  planId,
  devisePlan,
  type,
  parents,
  personnes,
}: CreationDepuisBibliothequeProps) {
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const f = useFormulaire<keyof SaisieDepuisBibliotheque>();
  const [ouvert, setOuvert] = useState(false);
  const [s, setS] = useState<SaisieDepuisBibliotheque>(SAISIE_DEPUIS_BIBLIOTHEQUE_VIDE);
  const champ = (cle: keyof SaisieDepuisBibliotheque) => ({
    value: s[cle],
    onChange: (e: { target: { value: string } }) => setS((x) => ({ ...x, [cle]: e.target.value })),
    erreur: f.erreurs[cle],
  });

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = validerDepuisBibliotheque(type, s, devisePlan, langue);
    const validation: Resultat<Record<string, unknown>, keyof SaisieDepuisBibliotheque> = v.corps
      ? { ok: true, charge: v.corps }
      : { ok: false, erreurs: v.erreurs };
    const ok = await f.envoyer(
      validation,
      (corps) => api.post(cheminDepuisBibliotheque(planId), corps),
      {
        succes: t(
          "Initiative ajoutée au plan (brouillon à valider).",
          "Initiative added to the plan (draft to be approved).",
        ),
        messageSpecifique: (e) => messageBibliotheque(e, langue),
      },
    );
    if (ok) {
      setOuvert(false);
      setS(SAISIE_DEPUIS_BIBLIOTHEQUE_VIDE);
      rafraichir();
    }
  }

  if (!ouvert) {
    return (
      <div className="mp-plan__section">
        <RetourFormulaire erreur={null} succes={f.succes} refAlerte={f.refAlerte} />
        <div className="mp-barre-actions">
          <Bouton
            variante="discret"
            icone="plus"
            disabled={parents.length === 0}
            onClick={() => setOuvert(true)}
          >
            {t("Ajouter au plan", "Add to plan")}
          </Bouton>
        </div>
        {parents.length === 0 ? (
          <p className="mp-texte-doux mp-texte-petit">
            {t(
              "Rédigez d'abord un axe ou un objectif dans l'onglet « Contenus ».",
              "First write an axis or an objective in the \u201cContent\u201d tab.",
            )}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t(
        `Ajouter « ${type.titre} » au plan`,
        `Add \u201c${type.titre}\u201d to the plan`,
      )}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Ajout refusé", "Add refused")}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Rattacher à", "Attach to")}
          required
          invite={t("Choisir un axe ou un objectif", "Choose an axis or an objective")}
          options={[...parents]}
          {...champ("parent_id")}
        />
        <Champ libelle={t("Début", "Start")} type="date" required {...champ("debut")} />
        <Champ
          libelle={t("Échéance", "Due date")}
          type="date"
          aide={t(
            "Vide : début + durée type, calculée par le moteur.",
            "Empty: start + standard duration, computed by the engine.",
          )}
          {...champ("echeance")}
        />
        <Champ
          libelle={`Budget (${libelleDevise(devisePlan)})`}
          inputMode="decimal"
          aide={
            type.devise === devisePlan ? t("Vide : coût type.", "Empty: standard cost.") : undefined
          }
          {...champ("budget")}
        />
        <Champ
          libelle={t("Titre", "Title")}
          maxLength={200}
          aide={t("Vide : titre de l'initiative type.", "Empty: title of the standard initiative.")}
          {...champ("titre")}
        />
        <Select
          libelle={t("Responsable", "Owner")}
          options={optionsResponsables(personnes, null, langue)}
          {...champ("responsable_id")}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement={t("Ajout…", "Adding…")}>
          {t("Ajouter", "Add")}
        </Bouton>
        <Bouton variante="secondaire" disabled={f.enCours} onClick={() => setOuvert(false)}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}
