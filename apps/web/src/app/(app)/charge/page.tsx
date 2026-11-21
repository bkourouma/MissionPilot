import Link from "next/link";
import type { Metadata } from "next";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../components/ui/Bouton";
import { Carte } from "../../../components/ui/Carte";
import { Champ } from "../../../components/ui/Champ";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../components/ui/EtatListe";
import { Icone } from "../../../components/ui/Icone";
import { Select } from "../../../components/ui/Select";
import { chargerServeur } from "../../../lib/api-serveur";
import { obtenirLangue } from "../../../lib/i18n/serveur";
import type { Langue } from "@missionpilot/shared";
import { chargerToutesLesPages, LIMITE_PAGE_MAX } from "../../../lib/pagination";
import { libelleTypeCollaborateur, optionsTypes } from "../../../lib/collaborateurs";
import { formaterJours, formaterNombre, formaterPourcentage } from "../../../lib/format";
import type { Mission } from "../../../lib/missions";
import {
  DUREES_PLAN,
  ETAT_CHARGE,
  presentationEtatCharge,
  hrefPlan,
  lireFiltresPlan,
  requetePlan,
  type CelluleCharge,
  type PlanDeCharge,
  type Surcharges,
} from "../../../lib/planification";
import { chargerGradesActifs } from "../../../lib/referentiels-serveur";
import { ajouterJoursIso, aujourdhuiIso, libelleDateCourte, lundiDe } from "../../../lib/semaine";
import { exigerPermission } from "../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const langue = await obtenirLangue();
  return { title: langue === "en" ? "Workload" : "Plan de charge" };
}

function Cellule({ c, nom, langue }: { c: CelluleCharge; nom: string; langue: Langue }) {
  const en = langue === "en";
  const etat = presentationEtatCharge(c.etat, langue);
  const description = en
    ? `${nom}, week of ${libelleDateCourte(c.semaine, langue)}: ${formaterJours(c.jours_affectes, langue)} assigned for ${formaterJours(c.capacite, langue)} of capacity, ${c.taux_occupation === null ? "rate cannot be calculated" : `utilization rate ${formaterPourcentage(c.taux_occupation, 0, langue)}`}, ${etat.libelle.toLowerCase()}.`
    : `${nom}, semaine du ${libelleDateCourte(c.semaine)} : ${formaterJours(c.jours_affectes)} affectés pour ${formaterJours(c.capacite)} de capacité, ${c.taux_occupation === null ? "taux non calculable" : `taux d'occupation ${formaterPourcentage(c.taux_occupation, 0)}`}, ${etat.libelle.toLowerCase()}.`;
  return (
    <td className={`mp-charge__cellule mp-charge__cellule--${c.etat}`}>
      <span className="mp-visuellement-cache">{description}</span>
      <span aria-hidden="true" className="mp-charge__contenu">
        <span className="mp-charge__taux">
          <Icone nom={etat.icone} taille={14} />
          {c.taux_occupation === null ? "—" : formaterPourcentage(c.taux_occupation, 0, langue)}
        </span>
        <span className="mp-charge__detail">
          {`${formaterNombre(c.jours_affectes, 2, langue)} / ${formaterNombre(c.capacite, 2, langue)} ${en ? "d" : "j"}`}
        </span>
        <span className="mp-charge__etat">{etat.court}</span>
      </span>
    </td>
  );
}

export default async function PagePlanDeCharge({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("charge.lire");
  const langue = await obtenirLangue();
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  const f = lireFiltresPlan(await searchParams);
  const lundi = lundiDe(aujourdhuiIso());
  const requete = requetePlan(f, lundi);
  const [plan, surcharges, grades, missions] = await Promise.all([
    chargerServeur<PlanDeCharge>(`/api/plan-de-charge?${requete}`),
    chargerServeur<Surcharges>(`/api/plan-de-charge/surcharges?${requete}`),
    chargerGradesActifs(utilisateur.roles),
    chargerToutesLesPages<Mission>(chargerServeur, "/api/missions?statut=en_cours", {
      limiteMax: LIMITE_PAGE_MAX,
    }),
  ]);
  const debut = f.debut || lundi;
  const filtre = Boolean(f.equipe || f.grade_id || f.type);
  const optionsMissions = missions.ok
    ? missions.donnees.elements.map((m) => ({ valeur: m.id, libelle: m.intitule }))
    : [];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Plan de charge", "Workload")}
        soustitre={t(
          "Jours affectés face à la capacité de chaque collaborateur (calendrier du cabinet, temps partiel, congés validés), semaine par semaine.",
          "Assigned days against each team member's capacity (firm calendar, part-time, approved leave), week by week.",
        )}
      />

      <form
        method="get"
        action="/charge"
        className="mp-filtres"
        aria-label={t("Filtrer le plan de charge", "Filter the workload")}
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Champ
            libelle={t("À partir de la semaine du", "Starting from the week of")}
            type="date"
            name="debut"
            defaultValue={debut}
            aide={t("Premier jour de la période affichée.", "First day of the period shown.")}
          />
          <Select
            libelle={t("Durée", "Duration")}
            name="semaines"
            defaultValue={String(f.semaines)}
            options={DUREES_PLAN.map((n) => ({
              valeur: String(n),
              libelle: t(`${n} semaines`, `${n} weeks`),
            }))}
          />
          <Select
            libelle={t("Équipe d'une mission en cours", "Team of an ongoing engagement")}
            name="equipe"
            invite={t("Tout le cabinet", "Whole firm")}
            aide={t(
              "Limite le plan aux membres de cette mission.",
              "Limits the workload to the members of this engagement.",
            )}
            options={optionsMissions}
            defaultValue={f.equipe}
          />
          {grades.length > 0 ? (
            <Select
              libelle={t("Grade", "Grade")}
              name="grade_id"
              invite={t("Tous les grades", "All grades")}
              options={grades.map((g) => ({ valeur: g.id, libelle: g.libelle }))}
              defaultValue={f.grade_id}
            />
          ) : null}
          <Select
            libelle={t("Type", "Type")}
            name="type"
            invite={t("Tous les types", "All types")}
            options={optionsTypes(langue)}
            defaultValue={f.type}
          />
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("primaire")}>
            <Icone nom="entonnoir" />
            <span>{t("Appliquer les filtres", "Apply filters")}</span>
          </button>
          {filtre || f.debut || f.semaines !== 12 ? (
            <Link href="/charge" className={classesBouton("discret")}>
              {t("Réinitialiser", "Reset")}
            </Link>
          ) : null}
        </div>
      </form>

      <nav
        className="mp-navigation-annee mp-charge__navigation"
        aria-label={t("Changer de période", "Change period")}
      >
        <Link
          className="mp-pagination__lien"
          href={hrefPlan(f, { debut: ajouterJoursIso(debut, -7 * f.semaines) })}
        >
          <Icone nom="chevronGauche" taille={18} />
          <span>{t("Période précédente", "Previous period")}</span>
        </Link>
        {plan.ok ? (
          <p className="mp-charge__periode" aria-live="polite">
            {t(
              `Du ${libelleDateCourte(plan.donnees.debut)} au ${libelleDateCourte(plan.donnees.fin)}`,
              `${libelleDateCourte(plan.donnees.debut, langue)} to ${libelleDateCourte(plan.donnees.fin, langue)}`,
            )}
          </p>
        ) : null}
        <Link
          className="mp-pagination__lien"
          href={hrefPlan(f, { debut: ajouterJoursIso(debut, 7 * f.semaines) })}
        >
          <span>{t("Période suivante", "Next period")}</span>
          <Icone nom="chevronDroit" taille={18} />
        </Link>
      </nav>

      <Legende langue={langue} seuils={plan.ok ? plan.donnees.seuils : null} />

      {!plan.ok ? (
        <EtatErreur
          titre={t(
            "Le plan de charge n'a pas pu être calculé.",
            "The workload could not be calculated.",
          )}
          message={plan.message}
          hrefReessayer={hrefPlan(f)}
        />
      ) : plan.donnees.elements.length === 0 ? (
        <EtatVide
          titre={
            filtre
              ? t(
                  "Aucun collaborateur ne correspond à ces filtres.",
                  "No team member matches these filters.",
                )
              : t("Aucun collaborateur actif.", "No active team members.")
          }
          icone="personnes"
          action={
            filtre ? (
              <Link href="/charge" className={classesBouton("secondaire")}>
                {t("Réinitialiser les filtres", "Reset filters")}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <GrillePlan plan={plan.donnees} langue={langue} />
          <ListePlan plan={plan.donnees} langue={langue} />
          <PaginationCurseur
            libelle={t("Pages de collaborateurs", "Team member pages")}
            hrefSuivante={
              plan.donnees.curseur_suivant
                ? hrefPlan(f, { curseur: plan.donnees.curseur_suivant })
                : null
            }
            hrefDebut={f.curseur ? hrefPlan(f) : null}
          />
        </>
      )}

      <Carte titre={t("Surcharges de la période", "Overloads for the period")}>
        {!surcharges.ok ? (
          <EtatErreur
            titre={t(
              "Les surcharges n'ont pas pu être calculées.",
              "The overloads could not be calculated.",
            )}
            message={surcharges.message}
            hrefReessayer={hrefPlan(f)}
          />
        ) : surcharges.donnees.elements.length === 0 ? (
          <p className="mp-texte-doux">
            {t(
              "Aucune surcharge pour les collaborateurs affichés.",
              "No overload for the team members shown.",
            )}
          </p>
        ) : (
          <ul className="mp-liste-lignes">
            {surcharges.donnees.elements.map((s) => (
              <li key={`${s.collaborateur_id}-${s.semaine}`} className="mp-liste-lignes__ligne">
                <span className="mp-liste-lignes__texte">
                  <strong>{s.collaborateur_nom}</strong>
                  <span className="mp-texte-doux">
                    {t(
                      `Semaine du ${libelleDateCourte(s.semaine)}`,
                      `Week of ${libelleDateCourte(s.semaine, langue)}`,
                    )}
                  </span>
                </span>
                <BadgeStatut tonalite="danger">
                  {t(
                    `${formaterJours(s.jours_affectes)} pour ${formaterJours(s.capacite)}`,
                    `${formaterJours(s.jours_affectes, langue)} for ${formaterJours(s.capacite, langue)}`,
                  )}
                </BadgeStatut>
              </li>
            ))}
          </ul>
        )}
      </Carte>
    </div>
  );
}

/** Légende : chaque état avec son icône, son texte et, quand on les connaît, son seuil de taux. */
function Legende({ langue, seuils }: { langue: Langue; seuils: PlanDeCharge["seuils"] | null }) {
  const en = langue === "en";
  const regle = (e: keyof typeof ETAT_CHARGE): string | null => {
    if (!seuils) return null;
    if (e === "surcharge") {
      return en
        ? `strictly above ${seuils.surcharge_pct} %, or days assigned with no capacity`
        : `au-delà de ${seuils.surcharge_pct} % (strictement), ou jours affectés sur une capacité nulle`;
    }
    if (e === "sous_occupation") {
      return en
        ? `strictly below ${seuils.sous_occupation_pct} %`
        : `sous ${seuils.sous_occupation_pct} % (strictement)`;
    }
    if (e === "indisponible") {
      return en ? "no capacity, nothing assigned" : "aucune capacité, rien d'affecté";
    }
    return en
      ? `${seuils.sous_occupation_pct} % to ${seuils.surcharge_pct} %`
      : `de ${seuils.sous_occupation_pct} % à ${seuils.surcharge_pct} %`;
  };
  return (
    <section className="mp-charge__aide" aria-labelledby="titre-legende-charge">
      <h2 id="titre-legende-charge" className="mp-charge__titre-legende">
        {en ? "How to read the rate" : "Lire le taux d'occupation"}
      </h2>
      <p className="mp-texte-doux mp-texte-petit">
        {en
          ? "Rate = days assigned ÷ capacity of the week. Each cell shows the rate, the days and the status in words."
          : "Taux = jours affectés ÷ capacité de la semaine. Chaque cellule indique le taux, les jours et l'état en toutes lettres."}
      </p>
      <ul className="mp-charge__legende">
        {(Object.keys(ETAT_CHARGE) as (keyof typeof ETAT_CHARGE)[]).map((e) => {
          const r = regle(e);
          return (
            <li key={e} className={`mp-charge__cellule mp-charge__cellule--${e}`}>
              <Icone nom={ETAT_CHARGE[e].icone} taille={14} />
              <span>{presentationEtatCharge(e, langue).libelle}</span>
              {r ? <span className="mp-charge__seuil">{`(${r})`}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Grand écran : tableau collaborateurs × semaines, première colonne figée, défilement maîtrisé. */
function GrillePlan({ plan, langue }: { plan: PlanDeCharge; langue: Langue }) {
  const en = langue === "en";
  return (
    <div
      className="mp-charge mp-charge--grille"
      role="region"
      aria-label={en ? "Workload, table" : "Plan de charge, tableau"}
      tabIndex={0}
    >
      <table className="mp-charge__table">
        <caption className="mp-visuellement-cache">
          {en
            ? `Workload from ${libelleDateCourte(plan.debut, langue)} to ${libelleDateCourte(plan.fin, langue)}: utilization rate, assigned days and capacity per week`
            : `Plan de charge du ${libelleDateCourte(plan.debut)} au ${libelleDateCourte(plan.fin)} : taux d'occupation, jours affectés et capacité par semaine`}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="mp-charge__nom">
              {en ? "Team member" : "Collaborateur"}
            </th>
            {plan.semaines.map((s) => (
              <th key={s} scope="col">
                <span className="mp-visuellement-cache">{en ? "Week of " : "Semaine du "}</span>
                {libelleDateCourte(s, langue)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {plan.elements.map((l) => (
            <tr key={l.collaborateur.id}>
              <th scope="row" className="mp-charge__nom">
                <span className="mp-charge__personne">{l.collaborateur.nom}</span>
                <span className="mp-texte-doux mp-texte-petit">
                  {[
                    l.collaborateur.grade_libelle,
                    libelleTypeCollaborateur(l.collaborateur.type, langue),
                    l.collaborateur.capacite_pct !== 100
                      ? `${l.collaborateur.capacite_pct} %`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </th>
              {l.cellules.map((c) => (
                <Cellule key={c.semaine} c={c} nom={l.collaborateur.nom} langue={langue} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Téléphone : une fiche par collaborateur, une ligne par semaine (aucun défilement horizontal). */
function ListePlan({ plan, langue }: { plan: PlanDeCharge; langue: Langue }) {
  const en = langue === "en";
  return (
    <ul
      className="mp-charge mp-charge--liste mp-liste-cartes"
      aria-label={en ? "Workload, by team member" : "Plan de charge, par collaborateur"}
    >
      {plan.elements.map((l) => {
        const surcharges = l.cellules.filter((c) => c.etat === "surcharge").length;
        return (
          <li key={l.collaborateur.id}>
            <details className="mp-carte mp-charge__fiche">
              <summary className="mp-charge__resume">
                <Icone nom="chevronDroit" taille={18} className="mp-charge__chevron" />
                <span className="mp-charge__personne">{l.collaborateur.nom}</span>
                <span className="mp-texte-doux mp-texte-petit">
                  {[
                    l.collaborateur.grade_libelle,
                    libelleTypeCollaborateur(l.collaborateur.type, langue),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {surcharges > 0 ? (
                  <BadgeStatut tonalite="danger">
                    {en
                      ? `${surcharges} week(s) overloaded`
                      : `${surcharges} semaine(s) en surcharge`}
                  </BadgeStatut>
                ) : null}
              </summary>
              <ul className="mp-liste-lignes">
                {l.cellules.map((c) => {
                  const etat = presentationEtatCharge(c.etat, langue);
                  return (
                    <li key={c.semaine} className="mp-liste-lignes__ligne">
                      <span className="mp-liste-lignes__texte">
                        <strong>
                          {en
                            ? `Week of ${libelleDateCourte(c.semaine, langue)}`
                            : `Semaine du ${libelleDateCourte(c.semaine)}`}
                        </strong>
                        <span className="mp-texte-doux mp-charge__chiffres">
                          {`${formaterJours(c.jours_affectes, langue)} ${en ? "of" : "sur"} ${formaterJours(c.capacite, langue)}${c.taux_occupation === null ? "" : ` · ${formaterPourcentage(c.taux_occupation, 0, langue)}`}`}
                        </span>
                      </span>
                      <BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>
                    </li>
                  );
                })}
              </ul>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
