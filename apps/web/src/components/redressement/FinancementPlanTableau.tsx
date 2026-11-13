import type { RedFinancementVue, RedPeriodeFinancementVue } from "@missionpilot/shared";
import { formaterDate, formaterMontantMineur, type Devise } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import {
  formaterCouverture,
  libelleStatutFinancement,
  textesFinancement,
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
export async function FinancementPlanTableau({
  vue,
  devise,
}: {
  vue: RedFinancementVue;
  devise: Devise;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const tx = textesFinancement(langue);
  const { plan, version } = vue;
  if (version === null || plan === null) {
    return (
      <EtatVide titre={t("Aucun plan de financement.", "No financing plan.")} icone="info">
        <p>{tx.financementAbsent}</p>
      </EtatVide>
    );
  }
  const m = (v: number) => formaterMontantMineur(v, devise, langue);
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
      entete: t("Période", "Period"),
      rendu: (p) => (
        <>
          <strong>
            {t("Période", "Period")} {p.periode}
          </strong>
          <span className="mp-texte-doux mp-texte-petit mp-fin-raison">
            {formaterDate(p.debut, "UTC", langue)} {t("au", "to")}{" "}
            {formaterDate(p.fin, "UTC", langue)}
          </span>
        </>
      ),
    },
    montant("emplois", t("Emplois", "Uses"), (p) => m(p.emplois)),
    montant("ressources", t("Ressources", "Resources"), (p) => m(p.ressources)),
    montant("solde", t("Solde", "Balance"), (p) => m(p.solde)),
    montant("couverture", t("Couverture", "Coverage"), (p) =>
      formaterCouverture(p.couverture_pb, langue),
    ),
    montant("cumul", t("Solde cumulé", "Cumulative balance"), (p) => m(p.solde_cumule)),
    {
      cle: "statut",
      entete: t("Statut", "Status"),
      rendu: (p) => (
        <BadgeStatut tonalite={tonaliteStatutFinancement(p.statut)}>
          {libelleStatutFinancement(p.statut, langue)}
        </BadgeStatut>
      ),
    },
  ];
  const typePeriode =
    version.type_periode === "annee" ? t("année(s)", "year(s)") : t("semestre(s)", "half-year(s)");
  return (
    <div className="mp-fin-bloc">
      <p className="mp-texte-doux">
        {t(
          `Version ${version.version} : ${version.nombre_periodes} ${typePeriode} à partir du ${formaterDate(version.date_debut)}.`,
          `Version ${version.version}: ${version.nombre_periodes} ${typePeriode} starting ${formaterDate(version.date_debut, "UTC", langue)}.`,
        )}
      </p>
      <Tableau
        legende={t("Plan de financement par période", "Financing plan by period")}
        colonnes={colonnes}
        lignes={plan.periodes}
        cleLigne={(p) => String(p.periode)}
      />
      <dl className="mp-liste-def">
        <div>
          <dt>{t("Total des emplois", "Total uses")}</dt>
          <dd className="mp-red-valeur">{m(plan.totaux.emplois)}</dd>
        </div>
        <div>
          <dt>{t("Total des ressources", "Total resources")}</dt>
          <dd className="mp-red-valeur">{m(plan.totaux.ressources)}</dd>
        </div>
        <div>
          <dt>{t("Solde total", "Total balance")}</dt>
          <dd className="mp-red-valeur">{m(plan.totaux.solde)}</dd>
        </div>
        <div>
          <dt>{t("Couverture totale", "Total coverage")}</dt>
          <dd className="mp-red-valeur">{formaterCouverture(plan.couverture_totale_pb, langue)}</dd>
        </div>
      </dl>
      <p aria-live="polite">
        {plan.equilibre ? (
          <BadgeStatut tonalite="succes">
            {t(
              "Équilibre : les ressources couvrent les emplois sur toutes les périodes.",
              "Balanced: resources cover uses over all periods.",
            )}
          </BadgeStatut>
        ) : (
          <BadgeStatut tonalite="attention">
            {t(
              `Insuffisance de financement, période(s) ${plan.periodes_insuffisance.join(", ")} ; manque maximal cumulé : ${m(plan.insuffisance_maximale_cumulee)}.`,
              `Financing shortfall, period(s) ${plan.periodes_insuffisance.join(", ")}; maximum cumulative gap: ${m(plan.insuffisance_maximale_cumulee)}.`,
            )}
          </BadgeStatut>
        )}
      </p>
      <p className="mp-texte-doux mp-texte-petit">{tx.excedent}</p>
    </div>
  );
}
