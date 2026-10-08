import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../lib/api-serveur";
import {
  formaterDate,
  formaterDateHeure,
  formaterJours,
  formaterMontantMineur,
} from "../../../../../lib/format";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { optionsPersonnes } from "../../../../../lib/personnes";
import type { Opportunite } from "../../../../../lib/pipeline";
import {
  actionsStatutProposition,
  arbreProposition,
  droitsMontants,
  peutCreerMission,
  propositionModifiable,
  propositionVisible,
  STATUT_PROPOSITION,
  type Proposition,
  type PropositionDetaillee,
} from "../../../../../lib/propositions";
import { chargerGradesActifs, chargerPersonnes } from "../../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../../lib/session";
import { CarteCommentaires } from "../../../../../components/collaboration/CarteCommentaires";
import { ActionsProposition } from "./ActionsProposition";
import { ArbreProposition } from "./ArbreProposition";
import { CreationMission } from "./CreationMission";
import { EquipeEtTaux } from "./EquipeEtTaux";

export const metadata: Metadata = { title: "Proposition" };

export default async function PageProposition({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("pipeline.gerer");
  const roles = utilisateur.roles;
  const r = await chargerServeur<PropositionDetaillee>(`/api/propositions/${id}`);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Proposition" retour={{ href: "/pipeline", libelle: "Pipeline" }} />
        <EtatErreur
          titre="La proposition n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={`/pipeline/propositions/${id}`}
        />
      </div>
    );
  }
  const droits = droitsMontants(roles);
  // Rien de financier au-delà des droits ne part vers les composants client.
  const p = propositionVisible(r.donnees, droits);
  const [opp, versions, grades, personnes] = await Promise.all([
    chargerServeur<Opportunite>(`/api/opportunites/${p.opportunite_id}`),
    chargerServeur<{ elements: Proposition[] }>(
      `/api/opportunites/${p.opportunite_id}/propositions`,
    ),
    chargerGradesActifs(roles),
    peutCreerMission(p.statut, roles) ? chargerPersonnes(roles) : Promise.resolve([]),
  ]);
  const opportuniteOuverte = opp.ok && opp.donnees.statut === "ouverte";
  const statut = STATUT_PROPOSITION[p.statut];
  const modifiable = propositionModifiable(p.statut);
  const libelleGrade = (code: string) => grades.find((g) => g.code === code)?.libelle ?? code;
  const gradesCourts = [
    ...grades.map((g) => ({ code: g.code, libelle: g.libelle })),
    // Grades chiffrés mais archivés : restent affichés et modifiables.
    ...p.chiffrage.par_grade
      .filter((l) => !grades.some((g) => g.code === l.grade_code))
      .map((l) => ({ code: l.grade_code, libelle: l.grade_code })),
  ];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={`${p.intitule} — version ${p.numero}`}
        retour={{ href: `/pipeline/${p.opportunite_id}`, libelle: "Opportunité" }}
        soustitre={opp.ok ? opp.donnees.client_raison_sociale : undefined}
        badges={<BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>}
      />

      <ActionsProposition
        propositionId={p.id}
        actions={actionsStatutProposition(p.statut, roles)}
        nouvelleVersion={opportuniteOuverte}
        tauxManquants={p.chiffrage.taux_manquants.map(libelleGrade)}
        statut={p.statut}
      />

      {peutCreerMission(p.statut, roles) ? (
        <CreationMission
          propositionId={p.id}
          intitule={p.intitule}
          personnes={optionsPersonnes(personnes)}
          voitToutes={aPermission(roles, "mission.lire_toutes")}
        />
      ) : null}

      <Carte titre="Chiffrage">
        <div className="mp-pile">
          <ul className="mp-totaux">
            <li className="mp-totaux__element">
              <span className="mp-totaux__libelle">Jours vendus</span>
              <span className="mp-totaux__valeur">{formaterJours(p.chiffrage.jours_total)}</span>
            </li>
            {p.chiffrage.honoraires_total !== undefined ? (
              <li className="mp-totaux__element">
                <span className="mp-totaux__libelle">Honoraires</span>
                <span className="mp-totaux__valeur">
                  {formaterMontantMineur(p.chiffrage.honoraires_total, p.devise)}
                </span>
                <span className="mp-texte-doux">calculés par le moteur (jours × taux)</span>
              </li>
            ) : null}
          </ul>
          {p.chiffrage.taux_manquants.length > 0 ? (
            <Alerte tonalite="attention" titre="Taux de vente manquant" annonce="aucune">
              <p>
                {`Grades chiffrés sans taux : ${p.chiffrage.taux_manquants.map(libelleGrade).join(", ")}. `}
                La proposition ne peut pas être validée tant qu&apos;un taux manque.
              </p>
            </Alerte>
          ) : null}
          <Tableau
            legende="Jours par grade"
            lignes={p.chiffrage.par_grade}
            cleLigne={(l) => l.grade_code}
            messageVide="Aucun jour chiffré pour l'instant."
            colonnes={[
              { cle: "grade", entete: "Grade", rendu: (l) => libelleGrade(l.grade_code) },
              {
                cle: "jours",
                entete: "Jours",
                alignement: "droite",
                rendu: (l) => formaterJours(l.jours),
              },
              ...(droits.unitaires
                ? [
                    {
                      cle: "taux",
                      entete: "Taux journalier",
                      alignement: "droite" as const,
                      rendu: (l: (typeof p.chiffrage.par_grade)[number]) =>
                        l.taux_journalier == null
                          ? "À renseigner"
                          : formaterMontantMineur(l.taux_journalier, p.devise),
                    },
                    {
                      cle: "montant",
                      entete: "Honoraires",
                      alignement: "droite" as const,
                      rendu: (l: (typeof p.chiffrage.par_grade)[number]) =>
                        formaterMontantMineur(l.montant, p.devise),
                    },
                  ]
                : []),
            ]}
          />
          {!droits.unitaires ? (
            <p className="mp-texte-doux">
              Les taux journaliers par grade sont réservés aux associés et aux gestionnaires.
            </p>
          ) : null}
        </div>
      </Carte>

      <EquipeEtTaux
        propositionId={p.id}
        devise={p.devise}
        modifiable={modifiable}
        grades={gradesCourts}
        equipe={p.equipe}
        taux={droits.unitaires ? (p.taux ?? {}) : null}
      />

      <section aria-labelledby="titre-decoupage" className="mp-pile">
        <h2 id="titre-decoupage" className="mp-section__titre">
          Découpage et jours par grade
        </h2>
        {modifiable ? null : (
          <p className="mp-texte-doux">
            Cette version n&apos;est plus modifiable : créez une nouvelle version pour
            l&apos;ajuster.
          </p>
        )}
        <ArbreProposition
          propositionId={p.id}
          arbre={arbreProposition(p.elements)}
          grades={gradesCourts}
          modifiable={modifiable}
        />
      </section>

      <Carte titre="Informations">
        <dl className="mp-liste-def">
          <div>
            <dt>Devise</dt>
            <dd>{p.devise}</dd>
          </div>
          <div>
            <dt>Date de référence des taux</dt>
            <dd>{formaterDate(p.date_reference)}</dd>
          </div>
          <div>
            <dt>Créée le</dt>
            <dd>{formaterDateHeure(p.cree_le)}</dd>
          </div>
          {p.validee_le ? (
            <div>
              <dt>Validée le</dt>
              <dd>{formaterDateHeure(p.validee_le)}</dd>
            </div>
          ) : null}
          {p.envoyee_le ? (
            <div>
              <dt>Envoyée le</dt>
              <dd>{formaterDateHeure(p.envoyee_le)}</dd>
            </div>
          ) : null}
          {p.repondue_le ? (
            <div>
              <dt>Réponse du client le</dt>
              <dd>{formaterDateHeure(p.repondue_le)}</dd>
            </div>
          ) : null}
        </dl>
      </Carte>

      {versions.ok && versions.donnees.elements.length > 1 ? (
        <Carte titre="Toutes les versions">
          <ul className="mp-liste-lignes">
            {versions.donnees.elements.map((v) => (
              <li key={v.id} className="mp-liste-lignes__ligne">
                <span className="mp-liste-lignes__texte">
                  {v.id === p.id ? (
                    <strong aria-current="page">{`Version ${v.numero} (affichée)`}</strong>
                  ) : (
                    <Link href={`/pipeline/propositions/${v.id}`} className="mp-lien-ligne">
                      {`Version ${v.numero}`}
                    </Link>
                  )}
                  <span className="mp-texte-doux">{formaterDateHeure(v.cree_le)}</span>
                </span>
                <BadgeStatut tonalite={STATUT_PROPOSITION[v.statut].tonalite}>
                  {STATUT_PROPOSITION[v.statut].libelle}
                </BadgeStatut>
              </li>
            ))}
          </ul>
        </Carte>
      ) : null}
      <CarteCommentaires
        entiteType="proposition"
        entiteId={p.id}
        utilisateur={utilisateur}
        nomElement={`la proposition ${p.intitule}, version ${p.numero}`}
      />
    </div>
  );
}
