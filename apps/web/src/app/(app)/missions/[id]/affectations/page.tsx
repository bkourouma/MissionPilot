import Link from "next/link";
import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import type { PageListe } from "../../../../../lib/clients";
import { TYPE_LIBELLES, type Collaborateur } from "../../../../../lib/collaborateurs";
import { tachesDansLOrdre, type Decoupage, type Planning } from "../../../../../lib/decoupage";
import { formaterDate, formaterJours } from "../../../../../lib/format";
import { droitsMission } from "../../../../../lib/missions";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { peutGererAffectations, type Affectation } from "../../../../../lib/planification";
import { chargerGradesActifs } from "../../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../../lib/session";
import {
  ActionsAffectation,
  FormulaireAffectation,
  Replanification,
  type TacheChoix,
} from "./Affectations";

export const metadata: Metadata = { title: "Affectations de la mission" };

const CURSEUR = /^[A-Za-z0-9_=-]{1,500}$/;

export default async function PageAffectations({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("mission.lire");
  const roles = utilisateur.roles;
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const brut = (await searchParams).curseur;
  const curseur = typeof brut === "string" && CURSEUR.test(brut) ? brut : "";
  const gerer = peutGererAffectations(m, roles, utilisateur.id);
  const replanifier = droitsMission(m, roles, utilisateur.id).planifier;
  const [liste, decoupage, planning, collaborateurs, grades] = await Promise.all([
    chargerServeur<{ elements: Affectation[]; curseur_suivant: string | null }>(
      `/api/missions/${m.id}/affectations?limite=200${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ""}`,
    ),
    chargerServeur<Decoupage>(`/api/missions/${m.id}/decoupage`),
    chargerServeur<Planning>(`/api/missions/${m.id}/planning`),
    gerer && aPermission(roles, "collaborateurs.lire")
      ? chargerServeur<PageListe<Collaborateur>>("/api/collaborateurs?actif=true&limite=200")
      : Promise.resolve(null),
    gerer ? chargerGradesActifs(roles) : Promise.resolve([]),
  ]);

  const situees = decoupage.ok ? tachesDansLOrdre(decoupage.donnees) : [];
  const fenetres = new Map((planning.ok ? planning.donnees.taches : []).map((t) => [t.id, t]));
  const taches: TacheChoix[] = situees.map((t) => ({
    valeur: t.id,
    libelle: t.chemin,
    debut: fenetres.get(t.id)?.debut,
    fin: fenetres.get(t.id)?.fin,
  }));
  const optionsCollaborateurs = collaborateurs?.ok
    ? collaborateurs.donnees.elements.map((c) => ({
        valeur: c.id,
        libelle: [c.nom, c.grade_libelle, c.type !== "interne" ? TYPE_LIBELLES[c.type] : null]
          .filter(Boolean)
          .join(" · "),
      }))
    : [];
  const optionsGrades = grades.map((g) => ({ valeur: g.id, libelle: g.libelle }));
  const phases = decoupage.ok
    ? decoupage.donnees.phases.map((p) => ({ valeur: p.id, libelle: p.libelle }))
    : [];
  const bornes = { min: m.date_debut ?? undefined, max: m.date_fin ?? undefined };
  const affectations = liste.ok ? liste.donnees.elements : [];
  const parTache = situees
    .map((t) => ({ tache: t, affectations: affectations.filter((a) => a.tache_id === t.id) }))
    .filter((g) => g.affectations.length > 0);

  return (
    <div className="mp-pile mp-pile--large">
      {gerer && !m.date_debut ? (
        <Alerte tonalite="attention" titre="Mission sans date de début" annonce="aucune">
          <p>
            Renseignez la date de début de la mission (onglet Fiche) avant d&apos;y affecter
            quelqu&apos;un.
          </p>
        </Alerte>
      ) : null}

      {gerer && m.date_debut ? (
        <Carte titre="Nouvelle affectation">
          {taches.length === 0 ? (
            <p className="mp-texte-doux">
              Ajoutez d&apos;abord des tâches dans l&apos;onglet{" "}
              <Link href={`/missions/${m.id}/decoupage`}>Découpage</Link>.
            </p>
          ) : (
            <FormulaireAffectation
              missionId={m.id}
              taches={taches}
              collaborateurs={optionsCollaborateurs}
              grades={optionsGrades}
              bornes={bornes}
            />
          )}
        </Carte>
      ) : null}

      <section aria-labelledby="titre-affectations" className="mp-pile">
        <h2 id="titre-affectations" className="mp-section__titre">
          Affectations par tâche
        </h2>
        {!liste.ok ? (
          <EtatErreur
            titre="Les affectations n'ont pas pu être chargées."
            message={liste.message}
            hrefReessayer={`/missions/${m.id}/affectations`}
          />
        ) : parTache.length === 0 ? (
          <EtatVide titre="Aucune affectation sur cette mission." icone="personnes">
            <p>
              Une affectation attribue des jours d&apos;une tâche à une personne, ou à un profil à
              pourvoir (grade et compétence) en attendant de choisir la personne.
            </p>
          </EtatVide>
        ) : (
          <ul className="mp-liste-cartes">
            {parTache.map(({ tache, affectations: aff }) => (
              <li key={tache.id}>
                <Carte niveauTitre={3} titre={<span className="mp-coupure">{tache.chemin}</span>}>
                  <ul className="mp-liste-lignes">
                    {aff.map((a) => (
                      <li key={a.id} className="mp-liste-lignes__ligne mp-affectation">
                        <span className="mp-liste-lignes__texte">
                          <strong>
                            {a.a_pourvoir
                              ? `Profil à pourvoir : ${a.grade_libelle ?? "grade"}${a.competence ? ` (${a.competence})` : ""}`
                              : (a.collaborateur_nom ?? "Collaborateur")}
                          </strong>
                          <span className="mp-texte-doux">
                            {[
                              `${formaterJours(a.jours_alloues)} du ${formaterDate(a.date_debut)} au ${formaterDate(a.date_fin)}`,
                              !a.a_pourvoir && a.grade_libelle ? a.grade_libelle : null,
                              a.collaborateur_type && a.collaborateur_type !== "interne"
                                ? TYPE_LIBELLES[a.collaborateur_type]
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          {a.a_pourvoir ? (
                            <BadgeStatut tonalite="attention">À pourvoir</BadgeStatut>
                          ) : null}
                        </span>
                        {gerer ? (
                          <ActionsAffectation
                            missionId={m.id}
                            affectation={a}
                            taches={taches}
                            collaborateurs={optionsCollaborateurs}
                            bornes={bornes}
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </Carte>
              </li>
            ))}
          </ul>
        )}
        {liste.ok ? (
          <PaginationCurseur
            libelle="Pages des affectations"
            hrefSuivante={
              liste.donnees.curseur_suivant
                ? `/missions/${m.id}/affectations?curseur=${encodeURIComponent(liste.donnees.curseur_suivant)}`
                : null
            }
            hrefDebut={curseur ? `/missions/${m.id}/affectations` : null}
          />
        ) : null}
      </section>

      {replanifier && phases.length > 0 ? (
        <Carte titre="Re-planifier une phase">
          <div className="mp-pile">
            <p className="mp-texte-doux">
              Décaler une phase recale ses tâches, les tâches qui en dépendent et leurs
              affectations, puis prévient chaque personne concernée. Prévisualisez d&apos;abord :
              rien n&apos;est modifié avant « Appliquer ».
            </p>
            <Replanification missionId={m.id} phases={phases} />
          </div>
        </Carte>
      ) : null}
    </div>
  );
}
