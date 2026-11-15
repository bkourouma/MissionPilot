import Link from "next/link";
import {
  creerTraduire,
  RED_DOMAINES,
  RED_COLONNES_KANBAN,
  type RedDossierVue,
} from "@missionpilot/shared";
import { formaterDate, formaterMontantMineur, formaterNombre } from "../../lib/format";
import { obtenirLangue } from "../../lib/i18n/serveur";
import {
  hrefRedressement,
  LIBELLE_BESOIN_FINANCEMENT,
  LIBELLE_BESOIN_FINANCEMENT_EN,
  libelleDomaine,
  libellePremiereTension,
  libelleScore,
  libelleSourceSeuils,
  libelleStatutAction,
  TEXTE_PLAN_MODIFIE,
  TEXTE_PLAN_MODIFIE_EN,
} from "../../lib/redressement";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { NiveauAlerte, Voyant } from "./Voyant";

/**
 * Les cinq cartes de la synthèse d'un dossier de redressement : urgence, alerte précoce,
 * trésorerie, créanciers, plan. Tous les chiffres sont ceux de l'API (moteurs) : cette page les
 * formate et n'en recalcule aucun.
 */
export async function CartesSynthese({
  missionId,
  dossier,
}: {
  missionId: string;
  dossier: RedDossierVue;
}) {
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  const { devise } = dossier;
  const tres = dossier.tresorerie;
  return (
    <div className="mp-red-cartes">
      <Carte titre={t("Urgence", "Urgency")}>
        <div className="mp-red-carte-corps">
          {dossier.urgence ? (
            <>
              <p>
                <Voyant voyant={dossier.urgence.voyant} />
              </p>
              <ul
                className="mp-red-liste-voyants"
                aria-label={t("Voyants par domaine", "Indicators by domain")}
              >
                {RED_DOMAINES.map((d) => (
                  <li key={d}>
                    <span>{libelleDomaine(d, langue)}</span>
                    <Voyant voyant={dossier.urgence?.voyants_par_domaine[d] ?? "non_evalue"} />
                  </li>
                ))}
              </ul>
              <p className="mp-texte-doux mp-texte-petit">
                {t("Évaluation du", "Assessment of")}{" "}
                {formaterDate(dossier.urgence.cree_le, "UTC", langue)}
              </p>
            </>
          ) : (
            <p className="mp-texte-doux">
              {t(
                "Aucune évaluation d'urgence pour ce dossier.",
                "No urgency assessment for this file.",
              )}
            </p>
          )}
          <Link href={hrefRedressement(missionId, "urgence")}>
            {t("Questionnaire d'urgence", "Urgency questionnaire")}
          </Link>
        </div>
      </Carte>

      <Carte titre={t("Alerte précoce", "Early warning")}>
        <div className="mp-red-carte-corps">
          {dossier.alerte ? (
            <>
              <p className="mp-red-chiffre">
                {libelleScore(dossier.alerte.score, dossier.alerte.niveau, langue)}
              </p>
              <p>
                <NiveauAlerte niveau={dossier.alerte.niveau} />{" "}
                <BadgeStatut tonalite="neutre" sansIcone>
                  {t("Indicatif", "Indicative")}
                </BadgeStatut>
              </p>
              <p className="mp-texte-doux mp-texte-petit">
                {libelleSourceSeuils(
                  dossier.alerte.seuils_source,
                  null,
                  dossier.alerte.seuils_version,
                  langue,
                )}{" "}
                · {t("calculé le", "computed on")}{" "}
                {formaterDate(dossier.alerte.cree_le, "UTC", langue)}
              </p>
            </>
          ) : (
            <p className="mp-texte-doux">
              {t("Aucun score d'alerte précoce calculé.", "No early-warning score computed.")}
            </p>
          )}
          <Link href={hrefRedressement(missionId, "alerte")}>
            {t("Score d'alerte précoce", "Early-warning score")}
          </Link>
        </div>
      </Carte>

      <Carte titre={t("Trésorerie à 13 semaines", "13-week cash forecast")}>
        <div className="mp-red-carte-corps">
          <p className="mp-red-chiffre">{libellePremiereTension(tres, langue)}</p>
          {tres ? (
            <dl className="mp-liste-def">
              <div>
                <dt>{t("Solde minimum prévu", "Lowest projected balance")}</dt>
                <dd>
                  {t("semaine", "week")} {tres.solde_minimum.semaine} :{" "}
                  <span className="mp-red-valeur">
                    {formaterMontantMineur(tres.solde_minimum.montant, devise, langue)}
                  </span>
                </dd>
              </div>
              <div>
                <dt>{t(LIBELLE_BESOIN_FINANCEMENT, LIBELLE_BESOIN_FINANCEMENT_EN)}</dt>
                <dd className="mp-red-valeur">
                  {formaterMontantMineur(tres.besoin_financement, devise, langue)}
                </dd>
              </div>
            </dl>
          ) : null}
          <Link href={hrefRedressement(missionId, "tresorerie")}>{t("Trésorerie", "Cash")}</Link>
        </div>
      </Carte>

      <Carte titre={t("Créanciers", "Creditors")}>
        <div className="mp-red-carte-corps">
          <p className="mp-red-chiffre">
            {dossier.creanciers.nombre} {t("créancier", "creditor")}
            {dossier.creanciers.nombre > 1 ? "s" : ""}
          </p>
          <dl className="mp-liste-def">
            <div>
              <dt>{t("Encours total", "Total outstanding")}</dt>
              <dd className="mp-red-valeur">
                {formaterMontantMineur(dossier.creanciers.encours_total, devise, langue)}
              </dd>
            </div>
            <div>
              <dt>{t("Dont échu", "Of which overdue")}</dt>
              <dd className="mp-red-valeur">
                {formaterMontantMineur(dossier.creanciers.echu_total, devise, langue)}
              </dd>
            </div>
          </dl>
          <Link href={hrefRedressement(missionId, "creanciers")}>
            {t("Registre des créanciers", "Creditor register")}
          </Link>
        </div>
      </Carte>

      <Carte titre={t("Plan de redressement", "Turnaround plan")}>
        <div className="mp-red-carte-corps">
          <ul
            className="mp-red-liste-voyants"
            aria-label={t("Actions par statut", "Actions by status")}
          >
            {RED_COLONNES_KANBAN.map((s) => (
              <li key={s}>
                <span>{libelleStatutAction(s, langue)}</span>
                <span className="mp-red-valeur">
                  {formaterNombre(dossier.plan.actions_par_statut[s] ?? 0, 0, langue)}
                </span>
              </li>
            ))}
          </ul>
          <p>
            {dossier.plan.en_retard > 0 ? (
              <BadgeStatut tonalite="danger">
                {dossier.plan.en_retard} action{dossier.plan.en_retard > 1 ? "s" : ""}{" "}
                {t("en retard", "overdue")}
              </BadgeStatut>
            ) : (
              <span className="mp-texte-doux">
                {t("Aucune action en retard.", "No overdue action.")}
              </span>
            )}
          </p>
          <p className="mp-texte-doux mp-texte-petit">
            {dossier.plan.version_courante !== null
              ? `${t("Version courante du plan :", "Current plan version:")} ${dossier.plan.version_courante}`
              : t("Aucune version du plan créée.", "No plan version created.")}
          </p>
          {dossier.plan.modifie_depuis_validation ? (
            <p>
              <BadgeStatut tonalite="attention">
                {t(TEXTE_PLAN_MODIFIE, TEXTE_PLAN_MODIFIE_EN)}
              </BadgeStatut>
            </p>
          ) : null}
          <Link href={hrefRedressement(missionId, "plan")}>
            {t("Plan et kanban", "Plan and kanban")}
          </Link>
        </div>
      </Carte>
    </div>
  );
}
