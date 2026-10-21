import type { RedFinancementVue, RedPeriodeFinancementVue } from "@missionpilot/shared";
import { formaterDate, formaterMontantMineur, type Devise } from "../../lib/format";
import {
  formaterCouverture,
  libelleStatutFinancement,
  TEXTE_EXCEDENT,
  TEXTE_FINANCEMENT_ABSENT,
  tonaliteStatutFinancement,
} from "../../lib/redressement-financement";
import { BadgeStatut } from "../ui/BadgeStatut";
import { EtatVide } from "../ui/EtatListe";
import { Tableau, type ColonneTableau } from "../ui/Tableau";

/**
 * Plan de financement de la version courante : emplois, ressources, solde, couverture et statut
 * par période, puis totaux. Une période est en insuffisance seulement quand ses ressources sont
 * inférieures à ses emplois : un excédent est un équilibre. Tous les chiffres sont ceux de l'API
 * (moteur de financement).
 */
export function FinancementPlanTableau({
  vue,
  devise,
}: {
  vue: RedFinancementVue;
  devise: Devise;
}) {
  const { plan, version } = vue;
  if (version === null || plan === null) {
    return (
      <EtatVide titre="Aucun plan de financement." icone="info">
        <p>{TEXTE_FINANCEMENT_ABSENT}</p>
      </EtatVide>
    );
  }
  const m = (v: number) => formaterMontantMineur(v, devise);
  const montant = (
    cle: string,
    entete: string,
    valeur: (p: RedPeriodeFinancementVue) => string,
  ): ColonneTableau<RedPeriodeFinancementVue> => ({
    cle,
    entete,
    alignement: "droite",
    rendu: (p) => <span className="mp-red-valeur">{valeur(p)}</span>,
  });
  const colonnes: ColonneTableau<RedPeriodeFinancementVue>[] = [
    {
      cle: "periode",
      entete: "Période",
      rendu: (p) => (
        <>
          <strong>Période {p.periode}</strong>
          <span className="mp-texte-doux mp-texte-petit mp-fin-raison">
            {formaterDate(p.debut)} au {formaterDate(p.fin)}
          </span>
        </>
      ),
    },
    montant("emplois", "Emplois", (p) => m(p.emplois)),
    montant("ressources", "Ressources", (p) => m(p.ressources)),
    montant("solde", "Solde", (p) => m(p.solde)),
    montant("couverture", "Couverture", (p) => formaterCouverture(p.couverture_pb)),
    montant("cumul", "Solde cumulé", (p) => m(p.solde_cumule)),
    {
      cle: "statut",
      entete: "Statut",
      rendu: (p) => (
        <BadgeStatut tonalite={tonaliteStatutFinancement(p.statut)}>
          {libelleStatutFinancement(p.statut)}
        </BadgeStatut>
      ),
    },
  ];
  return (
    <div className="mp-fin-bloc">
      <p className="mp-texte-doux">
        Version {version.version} : {version.nombre_periodes}{" "}
        {version.type_periode === "annee" ? "année(s)" : "semestre(s)"} à partir du{" "}
        {formaterDate(version.date_debut)}.
      </p>
      <Tableau
        legende="Plan de financement par période"
        colonnes={colonnes}
        lignes={plan.periodes}
        cleLigne={(p) => String(p.periode)}
      />
      <dl className="mp-liste-def">
        <div>
          <dt>Total des emplois</dt>
          <dd className="mp-red-valeur">{m(plan.totaux.emplois)}</dd>
        </div>
        <div>
          <dt>Total des ressources</dt>
          <dd className="mp-red-valeur">{m(plan.totaux.ressources)}</dd>
        </div>
        <div>
          <dt>Solde total</dt>
          <dd className="mp-red-valeur">{m(plan.totaux.solde)}</dd>
        </div>
        <div>
          <dt>Couverture totale</dt>
          <dd className="mp-red-valeur">{formaterCouverture(plan.couverture_totale_pb)}</dd>
        </div>
      </dl>
      <p aria-live="polite">
        {plan.equilibre ? (
          <BadgeStatut tonalite="succes">
            Équilibre : les ressources couvrent les emplois sur toutes les périodes.
          </BadgeStatut>
        ) : (
          <BadgeStatut tonalite="attention">
            Insuffisance de financement, période(s) {plan.periodes_insuffisance.join(", ")} ; manque
            maximal cumulé : {m(plan.insuffisance_maximale_cumulee)}.
          </BadgeStatut>
        )}
      </p>
      <p className="mp-texte-doux mp-texte-petit">{TEXTE_EXCEDENT}</p>
    </div>
  );
}
