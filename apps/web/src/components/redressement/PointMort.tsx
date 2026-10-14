"use client";

import { useState, type FormEvent } from "react";
import type { RedPointMortVue } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { formaterNombre, formaterMontantMineur, type Devise } from "../../lib/format";
import { cheminPointMort, formaterPart, messageRedressement } from "../../lib/redressement";
import {
  corpsPointMortDepuisFormulaire,
  montantVersTexte,
  type ChampPointMort,
  type SaisiePointMort,
} from "../../lib/redressement-saisie";
import { aideMontant } from "../../lib/saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";

const STATUTS: Record<RedPointMortVue["statut"], string> = {
  beneficiaire: "Bénéficiaire",
  equilibre: "À l'équilibre",
  deficitaire: "Déficitaire",
  non_calculable: "Non calculable",
  impossible: "Impossible : la marge sur coûts variables est nulle ou négative",
};

/**
 * Point mort (RED-11) : chiffre d'affaires, charges variables et charges fixes de la période
 * (préremplis depuis le dernier état accepté quand il existe : chiffre d'affaires et coût des
 * ventes ; les charges fixes sont à saisir). Calcul pur du moteur : rien n'est enregistré.
 */
export function PointMort({
  dossierId,
  devise,
  chiffreAffaires,
  chargesVariables,
}: {
  dossierId: string;
  devise: Devise;
  chiffreAffaires: number | null;
  chargesVariables: number | null;
}) {
  const f = useFormulaire<ChampPointMort>();
  const [s, setS] = useState<SaisiePointMort>({
    chiffre_affaires: chiffreAffaires !== null ? montantVersTexte(chiffreAffaires, devise) : "",
    charges_variables: chargesVariables !== null ? montantVersTexte(chargesVariables, devise) : "",
    charges_fixes: "",
    periode_jours: "360",
  });
  const [resultat, setResultat] = useState<RedPointMortVue | null>(null);
  const m = (v: number | null) => formaterMontantMineur(v, devise);

  async function calculer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsPointMortDepuisFormulaire(s, devise),
      (charge) => api.post<RedPointMortVue>(cheminPointMort(dossierId), charge),
      {
        messageSpecifique: messageRedressement,
        rafraichir: false,
        apres: (r) => setResultat(r),
      },
    );
  }

  return (
    <div className="mp-red-section">
      <form
        ref={f.refFormulaire}
        className="mp-formulaire"
        noValidate
        onSubmit={calculer}
        aria-label="Point mort"
      >
        <RetourFormulaire
          erreur={f.erreurGlobale}
          refAlerte={f.refAlerte}
          titreErreur="Calcul impossible"
        />
        <p className="mp-texte-doux">{aideMontant(devise)}</p>
        <div className="mp-grille-champs">
          <Champ
            libelle="Chiffre d'affaires de la période"
            required
            inputMode="decimal"
            autoComplete="off"
            value={s.chiffre_affaires}
            onChange={(e) => setS((x) => ({ ...x, chiffre_affaires: e.target.value }))}
            erreur={f.erreurs.chiffre_affaires}
          />
          <Champ
            libelle="Charges variables (coût des ventes)"
            required
            inputMode="decimal"
            autoComplete="off"
            value={s.charges_variables}
            onChange={(e) => setS((x) => ({ ...x, charges_variables: e.target.value }))}
            erreur={f.erreurs.charges_variables}
          />
          <Champ
            libelle="Charges fixes de la période"
            required
            inputMode="decimal"
            autoComplete="off"
            value={s.charges_fixes}
            onChange={(e) => setS((x) => ({ ...x, charges_fixes: e.target.value }))}
            erreur={f.erreurs.charges_fixes}
            aide="À saisir : loyers, salaires, assurances… hors coût des ventes."
          />
          <Champ
            libelle="Durée de la période (jours)"
            inputMode="numeric"
            autoComplete="off"
            value={s.periode_jours}
            onChange={(e) => setS((x) => ({ ...x, periode_jours: e.target.value }))}
            erreur={f.erreurs.periode_jours}
          />
        </div>
        <div className="mp-actions-formulaire">
          <Bouton
            type="submit"
            variante="secondaire"
            chargement={f.enCours}
            texteChargement="Calcul…"
          >
            Calculer le point mort
          </Bouton>
        </div>
      </form>
      {resultat ? (
        <dl className="mp-liste-def" aria-live="polite">
          <div>
            <dt>Statut</dt>
            <dd>{STATUTS[resultat.statut] ?? resultat.statut}</dd>
          </div>
          <div>
            <dt>Marge sur coûts variables</dt>
            <dd className="mp-red-valeur">
              {m(resultat.marge_cout_variable)} (
              {formaterPart(resultat.taux_marge_cout_variable_pb)})
            </dd>
          </div>
          <div>
            <dt>Résultat d&apos;exploitation</dt>
            <dd className="mp-red-valeur">{m(resultat.resultat_exploitation)}</dd>
          </div>
          <div>
            <dt>Seuil de rentabilité</dt>
            <dd className="mp-red-valeur">{m(resultat.seuil_rentabilite)}</dd>
          </div>
          <div>
            <dt>Marge de sécurité</dt>
            <dd className="mp-red-valeur">
              {m(resultat.marge_securite)}
              {resultat.marge_securite_pb !== null
                ? ` (${formaterPart(resultat.marge_securite_pb)})`
                : ""}
            </dd>
          </div>
          <div>
            <dt>Point mort</dt>
            <dd className="mp-red-valeur">
              {resultat.point_mort_jours !== null
                ? `${formaterNombre(resultat.point_mort_jours, 0)} jours sur ${resultat.periode_jours}`
                : "—"}
            </dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}
