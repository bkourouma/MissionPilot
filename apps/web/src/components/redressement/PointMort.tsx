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
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
const STATUTS_EN: Record<RedPointMortVue["statut"], string> = {
  beneficiaire: "Profitable",
  equilibre: "Break-even",
  deficitaire: "Loss-making",
  non_calculable: "Not computable",
  impossible: "Impossible: the contribution margin is zero or negative",
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampPointMort>();
  const [s, setS] = useState<SaisiePointMort>({
    chiffre_affaires: chiffreAffaires !== null ? montantVersTexte(chiffreAffaires, devise) : "",
    charges_variables: chargesVariables !== null ? montantVersTexte(chargesVariables, devise) : "",
    charges_fixes: "",
    periode_jours: "360",
  });
  const [resultat, setResultat] = useState<RedPointMortVue | null>(null);
  const m = (v: number | null) => formaterMontantMineur(v, devise, langue);

  async function calculer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsPointMortDepuisFormulaire(s, devise, langue),
      (charge) => api.post<RedPointMortVue>(cheminPointMort(dossierId), charge),
      {
        messageSpecifique: (e) => messageRedressement(e, langue),
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
        aria-label={t("Point mort", "Break-even point")}
      >
        <RetourFormulaire
          erreur={f.erreurGlobale}
          refAlerte={f.refAlerte}
          titreErreur={t("Calcul impossible", "Could not compute")}
        />
        <p className="mp-texte-doux">{aideMontant(devise, langue)}</p>
        <div className="mp-grille-champs">
          <Champ
            libelle={t("Chiffre d'affaires de la période", "Revenue for the period")}
            required
            inputMode="decimal"
            autoComplete="off"
            value={s.chiffre_affaires}
            onChange={(e) => setS((x) => ({ ...x, chiffre_affaires: e.target.value }))}
            erreur={f.erreurs.chiffre_affaires}
          />
          <Champ
            libelle={t("Charges variables (coût des ventes)", "Variable costs (cost of sales)")}
            required
            inputMode="decimal"
            autoComplete="off"
            value={s.charges_variables}
            onChange={(e) => setS((x) => ({ ...x, charges_variables: e.target.value }))}
            erreur={f.erreurs.charges_variables}
          />
          <Champ
            libelle={t("Charges fixes de la période", "Fixed costs for the period")}
            required
            inputMode="decimal"
            autoComplete="off"
            value={s.charges_fixes}
            onChange={(e) => setS((x) => ({ ...x, charges_fixes: e.target.value }))}
            erreur={f.erreurs.charges_fixes}
            aide={t(
              "À saisir : loyers, salaires, assurances… hors coût des ventes.",
              "To enter: rent, salaries, insurance… excluding cost of sales.",
            )}
          />
          <Champ
            libelle={t("Durée de la période (jours)", "Length of the period (days)")}
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
            texteChargement={t("Calcul…", "Computing…")}
          >
            {t("Calculer le point mort", "Compute the break-even point")}
          </Bouton>
        </div>
      </form>
      {resultat ? (
        <dl className="mp-liste-def" aria-live="polite">
          <div>
            <dt>{t("Statut", "Status")}</dt>
            <dd>{(langue === "en" ? STATUTS_EN : STATUTS)[resultat.statut] ?? resultat.statut}</dd>
          </div>
          <div>
            <dt>{t("Marge sur coûts variables", "Contribution margin")}</dt>
            <dd className="mp-red-valeur">
              {m(resultat.marge_cout_variable)} (
              {formaterPart(resultat.taux_marge_cout_variable_pb, langue)})
            </dd>
          </div>
          <div>
            <dt>{t("Résultat d'exploitation", "Operating income")}</dt>
            <dd className="mp-red-valeur">{m(resultat.resultat_exploitation)}</dd>
          </div>
          <div>
            <dt>{t("Seuil de rentabilité", "Break-even revenue")}</dt>
            <dd className="mp-red-valeur">{m(resultat.seuil_rentabilite)}</dd>
          </div>
          <div>
            <dt>{t("Marge de sécurité", "Margin of safety")}</dt>
            <dd className="mp-red-valeur">
              {m(resultat.marge_securite)}
              {resultat.marge_securite_pb !== null
                ? ` (${formaterPart(resultat.marge_securite_pb, langue)})`
                : ""}
            </dd>
          </div>
          <div>
            <dt>{t("Point mort", "Break-even point")}</dt>
            <dd className="mp-red-valeur">
              {resultat.point_mort_jours !== null
                ? t(
                    `${formaterNombre(resultat.point_mort_jours, 0)} jours sur ${resultat.periode_jours}`,
                    `${formaterNombre(resultat.point_mort_jours, 0, langue)} days out of ${resultat.periode_jours}`,
                  )
                : "—"}
            </dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}
