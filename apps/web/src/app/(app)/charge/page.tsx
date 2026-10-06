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
import { chargerToutesLesPages } from "../../../lib/pagination";
import { OPTIONS_TYPES, TYPE_LIBELLES } from "../../../lib/collaborateurs";
import { formaterJours, formaterNombre, formaterPourcentage } from "../../../lib/format";
import type { Mission } from "../../../lib/missions";
import {
  DUREES_PLAN,
  ETAT_CHARGE,
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

export const metadata: Metadata = { title: "Plan de charge" };

function Cellule({ c, nom }: { c: CelluleCharge; nom: string }) {
  const etat = ETAT_CHARGE[c.etat];
  const description = `${nom}, semaine du ${libelleDateCourte(c.semaine)} : ${formaterJours(c.jours_affectes)} affectés pour ${formaterJours(c.capacite)} de capacité, ${c.taux_occupation === null ? "taux non calculable" : `taux d'occupation ${formaterPourcentage(c.taux_occupation, 0)}`}, ${etat.libelle.toLowerCase()}.`;
  return (
    <td className={`mp-charge__cellule mp-charge__cellule--${c.etat}`}>
      <span className="mp-visuellement-cache">{description}</span>
      <span aria-hidden="true" className="mp-charge__contenu">
        <span className="mp-charge__taux">
          <Icone nom={etat.icone} taille={14} />
          {c.taux_occupation === null ? "—" : formaterPourcentage(c.taux_occupation, 0)}
        </span>
        <span className="mp-charge__detail">
          {`${formaterNombre(c.jours_affectes)} / ${formaterNombre(c.capacite)} j`}
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
  const f = lireFiltresPlan(await searchParams);
  const lundi = lundiDe(aujourdhuiIso());
  const requete = requetePlan(f, lundi);
  const [plan, surcharges, grades, missions] = await Promise.all([
    chargerServeur<PlanDeCharge>(`/api/plan-de-charge?${requete}`),
    chargerServeur<Surcharges>(`/api/plan-de-charge/surcharges?${requete}`),
    chargerGradesActifs(utilisateur.roles),
    chargerToutesLesPages<Mission>(chargerServeur, "/api/missions?statut=en_cours"),
  ]);
  const debut = f.debut || lundi;
  const filtre = Boolean(f.equipe || f.grade_id || f.type);
  const optionsMissions = missions.ok
    ? missions.donnees.elements.map((m) => ({ valeur: m.id, libelle: m.intitule }))
    : [];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Plan de charge"
        soustitre="Jours affectés face à la capacité de chaque collaborateur (calendrier du cabinet, temps partiel, congés validés), semaine par semaine."
      />

      <form
        method="get"
        action="/charge"
        className="mp-filtres"
        aria-label="Filtrer le plan de charge"
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Champ
            libelle="À partir de la semaine du"
            type="date"
            name="debut"
            defaultValue={debut}
          />
          <Select
            libelle="Durée"
            name="semaines"
            defaultValue={String(f.semaines)}
            options={DUREES_PLAN.map((n) => ({ valeur: String(n), libelle: `${n} semaines` }))}
          />
          <Select
            libelle="Équipe d'une mission en cours"
            name="equipe"
            invite="Tout le cabinet"
            options={optionsMissions}
            defaultValue={f.equipe}
          />
          {grades.length > 0 ? (
            <Select
              libelle="Grade"
              name="grade_id"
              invite="Tous les grades"
              options={grades.map((g) => ({ valeur: g.id, libelle: g.libelle }))}
              defaultValue={f.grade_id}
            />
          ) : null}
          <Select
            libelle="Type"
            name="type"
            invite="Tous les types"
            options={OPTIONS_TYPES}
            defaultValue={f.type}
          />
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("primaire")}>
            <Icone nom="entonnoir" />
            <span>Afficher</span>
          </button>
          {filtre || f.debut || f.semaines !== 12 ? (
            <Link href="/charge" className={classesBouton("discret")}>
              Réinitialiser
            </Link>
          ) : null}
        </div>
      </form>

      <nav className="mp-navigation-annee" aria-label="Changer de période">
        <Link
          className="mp-pagination__lien"
          href={hrefPlan(f, { debut: ajouterJoursIso(debut, -7 * f.semaines) })}
        >
          <Icone nom="chevronGauche" taille={18} />
          <span>Période précédente</span>
        </Link>
        <Link
          className="mp-pagination__lien"
          href={hrefPlan(f, { debut: ajouterJoursIso(debut, 7 * f.semaines) })}
        >
          <span>Période suivante</span>
          <Icone nom="chevronDroit" taille={18} />
        </Link>
      </nav>

      <Legende />

      {!plan.ok ? (
        <EtatErreur
          titre="Le plan de charge n'a pas pu être calculé."
          message={plan.message}
          hrefReessayer={hrefPlan(f)}
        />
      ) : plan.donnees.elements.length === 0 ? (
        <EtatVide
          titre={
            filtre
              ? "Aucun collaborateur ne correspond à ces filtres."
              : "Aucun collaborateur actif."
          }
          icone="personnes"
        />
      ) : (
        <>
          <GrillePlan plan={plan.donnees} />
          <ListePlan plan={plan.donnees} />
          <PaginationCurseur
            libelle="Pages de collaborateurs"
            hrefSuivante={
              plan.donnees.curseur_suivant
                ? hrefPlan(f, { curseur: plan.donnees.curseur_suivant })
                : null
            }
            hrefDebut={f.curseur ? hrefPlan(f) : null}
          />
        </>
      )}

      <Carte titre="Surcharges de la période">
        {!surcharges.ok ? (
          <EtatErreur
            titre="Les surcharges n'ont pas pu être calculées."
            message={surcharges.message}
            hrefReessayer={hrefPlan(f)}
          />
        ) : surcharges.donnees.elements.length === 0 ? (
          <p className="mp-texte-doux">Aucune surcharge pour les collaborateurs affichés.</p>
        ) : (
          <ul className="mp-liste-lignes">
            {surcharges.donnees.elements.map((s) => (
              <li key={`${s.collaborateur_id}-${s.semaine}`} className="mp-liste-lignes__ligne">
                <span className="mp-liste-lignes__texte">
                  <strong>{s.collaborateur_nom}</strong>
                  <span className="mp-texte-doux">{`Semaine du ${libelleDateCourte(s.semaine)}`}</span>
                </span>
                <BadgeStatut tonalite="danger">
                  {`${formaterJours(s.jours_affectes)} pour ${formaterJours(s.capacite)}`}
                </BadgeStatut>
              </li>
            ))}
          </ul>
        )}
      </Carte>
    </div>
  );
}

function Legende() {
  return (
    <ul className="mp-charge__legende" aria-label="Légende des états de charge">
      {(Object.keys(ETAT_CHARGE) as (keyof typeof ETAT_CHARGE)[]).map((e) => (
        <li key={e} className={`mp-charge__cellule mp-charge__cellule--${e}`}>
          <Icone nom={ETAT_CHARGE[e].icone} taille={14} />
          <span>{ETAT_CHARGE[e].libelle}</span>
        </li>
      ))}
    </ul>
  );
}

/** Grand écran : tableau collaborateurs × semaines, première colonne figée, défilement maîtrisé. */
function GrillePlan({ plan }: { plan: PlanDeCharge }) {
  return (
    <div
      className="mp-charge mp-charge--grille"
      role="region"
      aria-label="Plan de charge, tableau"
      tabIndex={0}
    >
      <table className="mp-charge__table">
        <caption className="mp-visuellement-cache">
          {`Plan de charge du ${libelleDateCourte(plan.debut)} au ${libelleDateCourte(plan.fin)} : taux d'occupation, jours affectés et capacité par semaine`}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="mp-charge__nom">
              Collaborateur
            </th>
            {plan.semaines.map((s) => (
              <th key={s} scope="col">
                <span className="mp-visuellement-cache">Semaine du </span>
                {libelleDateCourte(s)}
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
                    TYPE_LIBELLES[l.collaborateur.type],
                    l.collaborateur.capacite_pct !== 100
                      ? `${l.collaborateur.capacite_pct} %`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </th>
              {l.cellules.map((c) => (
                <Cellule key={c.semaine} c={c} nom={l.collaborateur.nom} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Téléphone : une fiche par collaborateur, une ligne par semaine (aucun défilement horizontal). */
function ListePlan({ plan }: { plan: PlanDeCharge }) {
  return (
    <ul
      className="mp-charge mp-charge--liste mp-liste-cartes"
      aria-label="Plan de charge, par collaborateur"
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
                  {[l.collaborateur.grade_libelle, TYPE_LIBELLES[l.collaborateur.type]]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {surcharges > 0 ? (
                  <BadgeStatut tonalite="danger">{`${surcharges} semaine(s) en surcharge`}</BadgeStatut>
                ) : null}
              </summary>
              <ul className="mp-liste-lignes">
                {l.cellules.map((c) => {
                  const etat = ETAT_CHARGE[c.etat];
                  return (
                    <li key={c.semaine} className="mp-liste-lignes__ligne">
                      <span className="mp-liste-lignes__texte">
                        <strong>{`Semaine du ${libelleDateCourte(c.semaine)}`}</strong>
                        <span className="mp-texte-doux">
                          {`${formaterJours(c.jours_affectes)} sur ${formaterJours(c.capacite)}${c.taux_occupation === null ? "" : ` · ${formaterPourcentage(c.taux_occupation, 0)}`}`}
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
