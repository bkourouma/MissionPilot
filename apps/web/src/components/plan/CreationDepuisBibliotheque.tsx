"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import type { Devise } from "../../lib/format";
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
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
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
  const router = useRouter();
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
    const v = validerDepuisBibliotheque(type, s, devisePlan);
    const validation: Resultat<Record<string, unknown>, keyof SaisieDepuisBibliotheque> = v.corps
      ? { ok: true, charge: v.corps }
      : { ok: false, erreurs: v.erreurs };
    const ok = await f.envoyer(
      validation,
      (corps) => api.post(cheminDepuisBibliotheque(planId), corps),
      {
        succes: "Initiative ajoutée au plan (brouillon à valider).",
        messageSpecifique: messageBibliotheque,
      },
    );
    if (ok) {
      setOuvert(false);
      setS(SAISIE_DEPUIS_BIBLIOTHEQUE_VIDE);
      router.refresh();
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
            Ajouter au plan
          </Bouton>
        </div>
        {parents.length === 0 ? (
          <p className="mp-texte-doux mp-texte-petit">
            Rédigez d&apos;abord un axe ou un objectif dans l&apos;onglet « Contenus ».
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
      aria-label={`Ajouter « ${type.titre} » au plan`}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Ajout refusé"
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Rattacher à"
          required
          invite="Choisir un axe ou un objectif"
          options={[...parents]}
          {...champ("parent_id")}
        />
        <Champ libelle="Début" type="date" required {...champ("debut")} />
        <Champ
          libelle="Échéance"
          type="date"
          aide="Vide : début + durée type, calculée par le moteur."
          {...champ("echeance")}
        />
        <Champ
          libelle={`Budget (${devisePlan})`}
          inputMode="decimal"
          aide={type.devise === devisePlan ? "Vide : coût type." : undefined}
          {...champ("budget")}
        />
        <Champ
          libelle="Titre"
          maxLength={200}
          aide="Vide : titre de l'initiative type."
          {...champ("titre")}
        />
        <Select
          libelle="Responsable"
          options={optionsResponsables(personnes, null)}
          {...champ("responsable_id")}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Ajout…">
          Ajouter
        </Bouton>
        <Bouton variante="secondaire" disabled={f.enCours} onClick={() => setOuvert(false)}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
