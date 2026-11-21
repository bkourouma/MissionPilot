import type { Metadata } from "next";
import type { Langue, Traduire } from "@missionpilot/shared";
import {
  BadgeAttente,
  DecisionDeclaration,
  FormulaireCompetence,
  FormulaireDeclaration,
} from "../../../../components/connaissances/FormulairesConnaissances";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { Tableau } from "../../../../components/ui/Tableau";
import { chargerServeur, type Chargement } from "../../../../lib/api-serveur";
import {
  droitsConnaissances,
  libelleNiveauCompetence,
  type CelluleCompetence,
  type Competence,
  type MatriceCompetences,
} from "../../../../lib/capitalisation";
import { formaterDate } from "../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Compétences", "Skills") };
}

/**
 * Compétences (CAP-06) : ses niveaux et ses preuves d'usage ; pour les responsables, la
 * matrice de l'équipe, la validation des niveaux déclarés et le référentiel. Un niveau n'est
 * jamais posé par le calcul : il est déclaré puis validé par une autre personne habilitée.
 */
export default async function PageCompetences() {
  const { utilisateur } = await exigerPermission("temps.saisir");
  const droits = droitsConnaissances(utilisateur.roles);
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const moi = await chargerServeur<{
    collaborateur_id: string | null;
    competences: { id: string; code: string; libelle: string }[];
    cellules: CelluleCompetence[];
  }>("/api/capitalisation/competences/moi");
  const matrice = droits.matrice
    ? await chargerServeur<MatriceCompetences>("/api/capitalisation/competences/matrice")
    : null;
  const referentiel = droits.gererCompetences
    ? await chargerServeur<{ elements: Competence[] }>("/api/capitalisation/competences")
    : null;

  return (
    <div className="mp-page mp-connaissances">
      <EnteteDePage
        titre={t("Compétences", "Skills")}
        soustitre={t(
          "Niveaux déclarés puis validés par un responsable, et preuves d'usage relevées sur les missions et les revues.",
          "Levels declared then approved by a manager, and evidence of use gathered from engagements and reviews.",
        )}
      />
      <Carte titre={t("Mes compétences", "My skills")}>
        {!moi.ok ? (
          <EtatErreur
            titre={t(
              "Vos compétences n'ont pas pu être chargées.",
              "Your skills could not be loaded.",
            )}
            message={moi.message}
            hrefReessayer="/connaissances/competences"
          />
        ) : moi.donnees.collaborateur_id === null ? (
          <EtatVide
            titre={t(
              "Votre compte n'est rattaché à aucune fiche collaborateur.",
              "Your account is not linked to any staff record.",
            )}
          />
        ) : moi.donnees.competences.length === 0 ? (
          <EtatVide
            titre={t("Le référentiel des compétences est vide.", "The skills framework is empty.")}
          />
        ) : (
          <>
            <Tableau
              legende={t("Mes niveaux et preuves d'usage", "My levels and evidence of use")}
              cleLigne={(l) => l.competence_id}
              lignes={moi.donnees.cellules}
              colonnes={[
                {
                  cle: "competence",
                  entete: t("Compétence", "Skill"),
                  rendu: (l) =>
                    moi.donnees.competences.find((c) => c.id === l.competence_id)?.libelle ?? "—",
                },
                {
                  cle: "niveau",
                  entete: t("Niveau validé", "Approved level"),
                  rendu: (l) => libelleNiveauCompetence(l.niveau_valide, langue),
                },
                {
                  cle: "attente",
                  entete: t("En attente", "Pending"),
                  rendu: (l) =>
                    l.niveau_en_attente ? (
                      <BadgeAttente
                        libelle={libelleNiveauCompetence(l.niveau_en_attente, langue)}
                      />
                    ) : (
                      "—"
                    ),
                },
                {
                  cle: "preuves",
                  entete: t("Preuves d'usage", "Evidence of use"),
                  alignement: "droite",
                  rendu: (l) => `${l.preuves ?? 0} · ${l.jours ?? "—"}`,
                },
                {
                  cle: "derniere",
                  entete: t("Dernier usage", "Last use"),
                  rendu: (l) => formaterDate(l.derniere_preuve, "UTC", langue),
                },
              ]}
            />
            <FormulaireDeclaration competences={moi.donnees.competences} />
          </>
        )}
      </Carte>
      {matrice ? (
        <Matrice r={matrice} valider={droits.gererCompetences} t={t} langue={langue} />
      ) : null}
      {referentiel ? (
        <Carte titre={t("Référentiel des compétences", "Skills framework")}>
          {!referentiel.ok ? (
            <EtatErreur
              titre={t(
                "Le référentiel n'a pas pu être chargé.",
                "The framework could not be loaded.",
              )}
              message={referentiel.message}
              hrefReessayer="/connaissances/competences"
            />
          ) : referentiel.donnees.elements.length === 0 ? (
            <EtatVide titre={t("Le référentiel est vide.", "The framework is empty.")} icone="plus">
              <p>
                {t(
                  "Ajoutez une première compétence avec le formulaire ci-dessous.",
                  "Add a first skill with the form below.",
                )}
              </p>
            </EtatVide>
          ) : (
            <ul className="mp-liste-lignes">
              {referentiel.donnees.elements.map((c) => (
                <li key={c.id} className="mp-liste-lignes__ligne">
                  <span>
                    <strong>{c.libelle}</strong>{" "}
                    <span className="mp-texte-doux mp-texte-petit">
                      {c.code}
                      {c.briques.length > 0
                        ? t(
                            ` · briques : ${c.briques.join(", ")}`,
                            ` · building blocks: ${c.briques.join(", ")}`,
                          )
                        : ""}
                    </span>
                  </span>
                  <BadgeStatut tonalite={c.active ? "succes" : "neutre"}>
                    {c.active ? t("Active", "Active") : t("Désactivée", "Disabled")}
                  </BadgeStatut>
                </li>
              ))}
            </ul>
          )}
          <FormulaireCompetence />
        </Carte>
      ) : null}
    </div>
  );
}

function Matrice({
  r,
  valider,
  t,
  langue,
}: {
  r: Chargement<MatriceCompetences>;
  valider: boolean;
  t: Traduire;
  langue: Langue;
}) {
  if (!r.ok) {
    return (
      <EtatErreur
        titre={t("La matrice n'a pas pu être chargée.", "The matrix could not be loaded.")}
        message={r.message}
        hrefReessayer="/connaissances/competences"
      />
    );
  }
  const { competences, lignes } = r.donnees;
  const enAttente = lignes.flatMap((l) =>
    l.cellules
      .filter((c) => c.declaration_en_attente_id && c.niveau_en_attente)
      .map((c) => ({ collaborateur: l.collaborateur.nom, cellule: c })),
  );
  return (
    <>
      <Carte titre={t("Matrice de l'équipe", "Team matrix")} className="mp-connaissances__matrice">
        <Tableau
          legende={t(
            "Niveaux validés par collaborateur et compétence",
            "Approved levels per staff member and skill",
          )}
          cleLigne={(l) => l.collaborateur.id}
          lignes={lignes}
          messageVide={t("Aucun collaborateur actif.", "No active staff member.")}
          colonnes={[
            {
              cle: "nom",
              entete: t("Collaborateur", "Staff member"),
              rendu: (l) => l.collaborateur.nom,
            },
            ...competences.map((k, i) => ({
              cle: k.id,
              entete: k.libelle,
              rendu: (l: MatriceCompetences["lignes"][number]) => {
                const c = l.cellules[i] as CelluleCompetence;
                const preuves =
                  c.preuves === undefined
                    ? ""
                    : t(` (${c.preuves} preuves)`, ` (${c.preuves} pieces of evidence)`);
                return `${libelleNiveauCompetence(c.niveau_valide, langue)}${c.a_revoir ? t(" · à revoir", " · to review") : ""}${preuves}`;
              },
            })),
          ]}
        />
      </Carte>
      {valider && enAttente.length > 0 ? (
        <Carte titre={t("Niveaux à valider", "Levels to approve")}>
          <ul className="mp-connaissances__resultats">
            {enAttente.map((e) => (
              <li key={e.cellule.declaration_en_attente_id} className="mp-connaissances__resultat">
                <strong>
                  {e.collaborateur} ·{" "}
                  {competences.find((k) => k.id === e.cellule.competence_id)?.libelle}
                </strong>
                <DecisionDeclaration
                  declarationId={e.cellule.declaration_en_attente_id as string}
                  niveau={e.cellule.niveau_en_attente as number}
                />
              </li>
            ))}
          </ul>
        </Carte>
      ) : null}
    </>
  );
}
