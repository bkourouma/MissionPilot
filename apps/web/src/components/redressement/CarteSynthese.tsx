import Link from "next/link";
import { RED_DOMAINES, RED_COLONNES_KANBAN, type RedDossierVue } from "@missionpilot/shared";
import { formaterDate, formaterMontantMineur, formaterNombre } from "../../lib/format";
import {
  hrefRedressement,
  LIBELLE_BESOIN_FINANCEMENT,
  libelleDomaine,
  libellePremiereTension,
  libelleScore,
  libelleSourceSeuils,
  libelleStatutAction,
  TEXTE_PLAN_MODIFIE,
} from "../../lib/redressement";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { NiveauAlerte, Voyant } from "./Voyant";

/**
 * Les cinq cartes de la synthèse d'un dossier de redressement : urgence, alerte précoce,
 * trésorerie, créanciers, plan. Tous les chiffres sont ceux de l'API (moteurs) : cette page les
 * formate et n'en recalcule aucun.
 */
export function CartesSynthese({
  missionId,
  dossier,
}: {
  missionId: string;
  dossier: RedDossierVue;
}) {
  const { devise } = dossier;
  const t = dossier.tresorerie;
  return (
    <div className="mp-red-cartes">
      <Carte titre="Urgence">
        <div className="mp-red-carte-corps">
          {dossier.urgence ? (
            <>
              <p>
                <Voyant voyant={dossier.urgence.voyant} />
              </p>
              <ul className="mp-red-liste-voyants" aria-label="Voyants par domaine">
                {RED_DOMAINES.map((d) => (
                  <li key={d}>
                    <span>{libelleDomaine(d)}</span>
                    <Voyant voyant={dossier.urgence?.voyants_par_domaine[d] ?? "non_evalue"} />
                  </li>
                ))}
              </ul>
              <p className="mp-texte-doux mp-texte-petit">
                Évaluation du {formaterDate(dossier.urgence.cree_le)}
              </p>
            </>
          ) : (
            <p className="mp-texte-doux">Aucune évaluation d&apos;urgence pour ce dossier.</p>
          )}
          <Link href={hrefRedressement(missionId, "urgence")}>Questionnaire d&apos;urgence</Link>
        </div>
      </Carte>

      <Carte titre="Alerte précoce">
        <div className="mp-red-carte-corps">
          {dossier.alerte ? (
            <>
              <p className="mp-red-chiffre">
                {libelleScore(dossier.alerte.score, dossier.alerte.niveau)}
              </p>
              <p>
                <NiveauAlerte niveau={dossier.alerte.niveau} />{" "}
                <BadgeStatut tonalite="neutre" sansIcone>
                  Indicatif
                </BadgeStatut>
              </p>
              <p className="mp-texte-doux mp-texte-petit">
                {libelleSourceSeuils(
                  dossier.alerte.seuils_source,
                  null,
                  dossier.alerte.seuils_version,
                )}{" "}
                · calculé le {formaterDate(dossier.alerte.cree_le)}
              </p>
            </>
          ) : (
            <p className="mp-texte-doux">Aucun score d&apos;alerte précoce calculé.</p>
          )}
          <Link href={hrefRedressement(missionId, "alerte")}>Score d&apos;alerte précoce</Link>
        </div>
      </Carte>

      <Carte titre="Trésorerie à 13 semaines">
        <div className="mp-red-carte-corps">
          <p className="mp-red-chiffre">{libellePremiereTension(t)}</p>
          {t ? (
            <dl className="mp-liste-def">
              <div>
                <dt>Solde minimum prévu</dt>
                <dd>
                  semaine {t.solde_minimum.semaine} :{" "}
                  <span className="mp-red-valeur">
                    {formaterMontantMineur(t.solde_minimum.montant, devise)}
                  </span>
                </dd>
              </div>
              <div>
                <dt>{LIBELLE_BESOIN_FINANCEMENT}</dt>
                <dd className="mp-red-valeur">
                  {formaterMontantMineur(t.besoin_financement, devise)}
                </dd>
              </div>
            </dl>
          ) : null}
          <Link href={hrefRedressement(missionId, "tresorerie")}>Trésorerie</Link>
        </div>
      </Carte>

      <Carte titre="Créanciers">
        <div className="mp-red-carte-corps">
          <p className="mp-red-chiffre">
            {dossier.creanciers.nombre} créancier{dossier.creanciers.nombre > 1 ? "s" : ""}
          </p>
          <dl className="mp-liste-def">
            <div>
              <dt>Encours total</dt>
              <dd className="mp-red-valeur">
                {formaterMontantMineur(dossier.creanciers.encours_total, devise)}
              </dd>
            </div>
            <div>
              <dt>Dont échu</dt>
              <dd className="mp-red-valeur">
                {formaterMontantMineur(dossier.creanciers.echu_total, devise)}
              </dd>
            </div>
          </dl>
          <Link href={hrefRedressement(missionId, "creanciers")}>Registre des créanciers</Link>
        </div>
      </Carte>

      <Carte titre="Plan de redressement">
        <div className="mp-red-carte-corps">
          <ul className="mp-red-liste-voyants" aria-label="Actions par statut">
            {RED_COLONNES_KANBAN.map((s) => (
              <li key={s}>
                <span>{libelleStatutAction(s)}</span>
                <span className="mp-red-valeur">
                  {formaterNombre(dossier.plan.actions_par_statut[s] ?? 0, 0)}
                </span>
              </li>
            ))}
          </ul>
          <p>
            {dossier.plan.en_retard > 0 ? (
              <BadgeStatut tonalite="danger">
                {dossier.plan.en_retard} action{dossier.plan.en_retard > 1 ? "s" : ""} en retard
              </BadgeStatut>
            ) : (
              <span className="mp-texte-doux">Aucune action en retard.</span>
            )}
          </p>
          <p className="mp-texte-doux mp-texte-petit">
            {dossier.plan.version_courante !== null
              ? `Version courante du plan : ${dossier.plan.version_courante}`
              : "Aucune version du plan créée."}
          </p>
          {dossier.plan.modifie_depuis_validation ? (
            <p>
              <BadgeStatut tonalite="attention">{TEXTE_PLAN_MODIFIE}</BadgeStatut>
            </p>
          ) : null}
          <Link href={hrefRedressement(missionId, "plan")}>Plan et kanban</Link>
        </div>
      </Carte>
    </div>
  );
}
