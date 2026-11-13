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
  libelleDevise,
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
  statutProposition,
  type Proposition,
  type PropositionDetaillee,
} from "../../../../../lib/propositions";
import { chargerGradesActifs, chargerPersonnes } from "../../../../../lib/referentiels-serveur";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../lib/session";
import { CarteCommentaires } from "../../../../../components/collaboration/CarteCommentaires";
import { ActionsProposition } from "./ActionsProposition";
import { ArbreProposition } from "./ArbreProposition";
import { CreationMission } from "./CreationMission";
import { EquipeEtTaux } from "./EquipeEtTaux";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Proposition", "Proposal") };
}

export default async function PageProposition({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("pipeline.gerer");
  const roles = utilisateur.roles;
  const r = await chargerServeur<PropositionDetaillee>(`/api/propositions/${id}`);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre={t("Proposition", "Proposal")}
          retour={{ href: "/pipeline", libelle: t("Pipeline", "Pipeline") }}
        />
        <EtatErreur
          titre={t("La proposition n'a pas pu être chargée.", "The proposal could not be loaded.")}
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
  const statut = statutProposition(p.statut, langue);
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
        titre={`${p.intitule} — ${t("version", "version")} ${p.numero}`}
        retour={{ href: `/pipeline/${p.opportunite_id}`, libelle: t("Opportunité", "Opportunity") }}
        soustitre={opp.ok ? opp.donnees.client_raison_sociale : undefined}
        badges={<BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>}
      />

      <ActionsProposition
        propositionId={p.id}
        actions={actionsStatutProposition(p.statut, roles, langue)}
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

      <Carte titre={t("Chiffrage", "Pricing")}>
        <div className="mp-pile">
          <ul className="mp-totaux">
            <li className="mp-totaux__element">
              <span className="mp-totaux__libelle">{t("Jours vendus", "Days sold")}</span>
              <span className="mp-totaux__valeur">
                {formaterJours(p.chiffrage.jours_total, langue)}
              </span>
            </li>
            {p.chiffrage.honoraires_total !== undefined ? (
              <li className="mp-totaux__element">
                <span className="mp-totaux__libelle">{t("Honoraires", "Fees")}</span>
                <span className="mp-totaux__valeur">
                  {formaterMontantMineur(p.chiffrage.honoraires_total, p.devise, langue)}
                </span>
                <span className="mp-texte-doux">
                  {t(
                    "calculés par le moteur (jours × taux)",
                    "computed by the engine (days × rate)",
                  )}
                </span>
              </li>
            ) : null}
          </ul>
          {p.chiffrage.taux_manquants.length > 0 ? (
            <Alerte
              tonalite="attention"
              titre={t("Taux de vente manquant", "Selling rate missing")}
              annonce="aucune"
            >
              <p>
                {t(
                  `Grades chiffrés sans taux : ${p.chiffrage.taux_manquants.map(libelleGrade).join(", ")}. La proposition ne peut pas être validée tant qu'un taux manque.`,
                  `Priced grades without a rate: ${p.chiffrage.taux_manquants.map(libelleGrade).join(", ")}. The proposal cannot be approved while a rate is missing.`,
                )}
              </p>
            </Alerte>
          ) : null}
          <Tableau
            legende={t("Jours par grade", "Days per grade")}
            lignes={p.chiffrage.par_grade}
            cleLigne={(l) => l.grade_code}
            messageVide={t("Aucun jour chiffré pour l'instant.", "No priced days yet.")}
            colonnes={[
              {
                cle: "grade",
                entete: t("Grade", "Grade"),
                rendu: (l) => libelleGrade(l.grade_code),
              },
              {
                cle: "jours",
                entete: t("Jours", "Days"),
                alignement: "droite",
                rendu: (l) => formaterJours(l.jours, langue),
              },
              ...(droits.unitaires
                ? [
                    {
                      cle: "taux",
                      entete: t("Taux journalier", "Daily rate"),
                      alignement: "droite" as const,
                      rendu: (l: (typeof p.chiffrage.par_grade)[number]) =>
                        l.taux_journalier == null
                          ? t("À renseigner", "To be entered")
                          : formaterMontantMineur(l.taux_journalier, p.devise, langue),
                    },
                    {
                      cle: "montant",
                      entete: t("Honoraires", "Fees"),
                      alignement: "droite" as const,
                      rendu: (l: (typeof p.chiffrage.par_grade)[number]) =>
                        formaterMontantMineur(l.montant, p.devise, langue),
                    },
                  ]
                : []),
            ]}
          />
          {!droits.unitaires ? (
            <p className="mp-texte-doux">
              {t(
                "Les taux journaliers par grade sont réservés aux associés et aux gestionnaires.",
                "Daily rates per grade are reserved for partners and managers.",
              )}
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
          {t("Découpage et jours par grade", "Work breakdown and days per grade")}
        </h2>
        {modifiable ? null : (
          <p className="mp-texte-doux">
            {t(
              "Cette version n'est plus modifiable : créez une nouvelle version pour l'ajuster.",
              "This version can no longer be edited: create a new version to adjust it.",
            )}
          </p>
        )}
        <ArbreProposition
          propositionId={p.id}
          arbre={arbreProposition(p.elements)}
          grades={gradesCourts}
          modifiable={modifiable}
        />
      </section>

      <Carte titre={t("Informations", "Information")}>
        <dl className="mp-liste-def">
          <div>
            <dt>{t("Devise", "Currency")}</dt>
            <dd>{libelleDevise(p.devise)}</dd>
          </div>
          <div>
            <dt>{t("Date de référence des taux", "Rate reference date")}</dt>
            <dd>{formaterDate(p.date_reference, "UTC", langue)}</dd>
          </div>
          <div>
            <dt>{t("Créée le", "Created on")}</dt>
            <dd>{formaterDateHeure(p.cree_le, "Africa/Abidjan", langue)}</dd>
          </div>
          {p.validee_le ? (
            <div>
              <dt>{t("Validée le", "Approved on")}</dt>
              <dd>{formaterDateHeure(p.validee_le, "Africa/Abidjan", langue)}</dd>
            </div>
          ) : null}
          {p.envoyee_le ? (
            <div>
              <dt>{t("Envoyée le", "Sent on")}</dt>
              <dd>{formaterDateHeure(p.envoyee_le, "Africa/Abidjan", langue)}</dd>
            </div>
          ) : null}
          {p.repondue_le ? (
            <div>
              <dt>{t("Réponse du client le", "Client response on")}</dt>
              <dd>{formaterDateHeure(p.repondue_le, "Africa/Abidjan", langue)}</dd>
            </div>
          ) : null}
        </dl>
      </Carte>

      {versions.ok && versions.donnees.elements.length > 1 ? (
        <Carte titre={t("Toutes les versions", "All versions")}>
          <ul className="mp-liste-lignes">
            {versions.donnees.elements.map((v) => (
              <li key={v.id} className="mp-liste-lignes__ligne">
                <span className="mp-liste-lignes__texte">
                  {v.id === p.id ? (
                    <strong aria-current="page">
                      {t(`Version ${v.numero} (affichée)`, `Version ${v.numero} (shown)`)}
                    </strong>
                  ) : (
                    <Link href={`/pipeline/propositions/${v.id}`} className="mp-lien-ligne">
                      {`${t("Version", "Version")} ${v.numero}`}
                    </Link>
                  )}
                  <span className="mp-texte-doux">
                    {formaterDateHeure(v.cree_le, "Africa/Abidjan", langue)}
                  </span>
                </span>
                <BadgeStatut tonalite={statutProposition(v.statut, langue).tonalite}>
                  {statutProposition(v.statut, langue).libelle}
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
        nomElement={t(
          `la proposition ${p.intitule}, version ${p.numero}`,
          `the proposal ${p.intitule}, version ${p.numero}`,
        )}
      />
    </div>
  );
}
