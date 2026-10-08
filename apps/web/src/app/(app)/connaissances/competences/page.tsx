import type { Metadata } from "next";
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
import { exigerPermission } from "../../../../lib/session";

export const metadata: Metadata = { title: "Compétences" };

/**
 * Compétences (CAP-06) : ses niveaux et ses preuves d'usage ; pour les responsables, la
 * matrice de l'équipe, la validation des niveaux déclarés et le référentiel. Un niveau n'est
 * jamais posé par le calcul : il est déclaré puis validé par une autre personne habilitée.
 */
export default async function PageCompetences() {
  const { utilisateur } = await exigerPermission("temps.saisir");
  const droits = droitsConnaissances(utilisateur.roles);
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
        titre="Compétences"
        soustitre="Niveaux déclarés puis validés par un responsable, et preuves d'usage relevées sur les missions et les revues."
      />
      <Carte titre="Mes compétences">
        {!moi.ok ? (
          <EtatErreur
            titre="Vos compétences n'ont pas pu être chargées."
            message={moi.message}
            hrefReessayer="/connaissances/competences"
          />
        ) : moi.donnees.collaborateur_id === null ? (
          <EtatVide titre="Votre compte n'est rattaché à aucune fiche collaborateur." />
        ) : moi.donnees.competences.length === 0 ? (
          <EtatVide titre="Le référentiel des compétences est vide." />
        ) : (
          <>
            <Tableau
              legende="Mes niveaux et preuves d'usage"
              cleLigne={(l) => l.competence_id}
              lignes={moi.donnees.cellules}
              colonnes={[
                {
                  cle: "competence",
                  entete: "Compétence",
                  rendu: (l) =>
                    moi.donnees.competences.find((c) => c.id === l.competence_id)?.libelle ?? "—",
                },
                {
                  cle: "niveau",
                  entete: "Niveau validé",
                  rendu: (l) => libelleNiveauCompetence(l.niveau_valide),
                },
                {
                  cle: "attente",
                  entete: "En attente",
                  rendu: (l) =>
                    l.niveau_en_attente ? (
                      <BadgeAttente libelle={libelleNiveauCompetence(l.niveau_en_attente)} />
                    ) : (
                      "—"
                    ),
                },
                {
                  cle: "preuves",
                  entete: "Preuves d'usage",
                  alignement: "droite",
                  rendu: (l) => `${l.preuves ?? 0} · ${l.jours ?? "—"}`,
                },
                {
                  cle: "derniere",
                  entete: "Dernier usage",
                  rendu: (l) => formaterDate(l.derniere_preuve),
                },
              ]}
            />
            <FormulaireDeclaration competences={moi.donnees.competences} />
          </>
        )}
      </Carte>
      {matrice ? <Matrice r={matrice} valider={droits.gererCompetences} /> : null}
      {referentiel ? (
        <Carte titre="Référentiel des compétences">
          {!referentiel.ok ? (
            <EtatErreur
              titre="Le référentiel n'a pas pu être chargé."
              message={referentiel.message}
              hrefReessayer="/connaissances/competences"
            />
          ) : (
            <ul className="mp-liste-lignes">
              {referentiel.donnees.elements.map((c) => (
                <li key={c.id} className="mp-liste-lignes__ligne">
                  <span>
                    <strong>{c.libelle}</strong>{" "}
                    <span className="mp-texte-doux mp-texte-petit">
                      {c.code}
                      {c.briques.length > 0 ? ` · briques : ${c.briques.join(", ")}` : ""}
                    </span>
                  </span>
                  <BadgeStatut tonalite={c.active ? "succes" : "neutre"}>
                    {c.active ? "Active" : "Désactivée"}
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

function Matrice({ r, valider }: { r: Chargement<MatriceCompetences>; valider: boolean }) {
  if (!r.ok) {
    return (
      <EtatErreur
        titre="La matrice n'a pas pu être chargée."
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
      <Carte titre="Matrice de l'équipe" className="mp-connaissances__matrice">
        <Tableau
          legende="Niveaux validés par collaborateur et compétence"
          cleLigne={(l) => l.collaborateur.id}
          lignes={lignes}
          messageVide="Aucun collaborateur actif."
          colonnes={[
            { cle: "nom", entete: "Collaborateur", rendu: (l) => l.collaborateur.nom },
            ...competences.map((k, i) => ({
              cle: k.id,
              entete: k.libelle,
              rendu: (l: MatriceCompetences["lignes"][number]) => {
                const c = l.cellules[i] as CelluleCompetence;
                const preuves = c.preuves === undefined ? "" : ` (${c.preuves} preuves)`;
                return `${libelleNiveauCompetence(c.niveau_valide)}${c.a_revoir ? " · à revoir" : ""}${preuves}`;
              },
            })),
          ]}
        />
      </Carte>
      {valider && enAttente.length > 0 ? (
        <Carte titre="Niveaux à valider">
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
