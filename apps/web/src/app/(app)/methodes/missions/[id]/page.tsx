import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  DecisionDerogation,
  FormulaireDerogation,
} from "../../../../../components/methodes/DerogationsFormulaires";
import {
  ContexteMission,
  LiaisonMethode,
  MigrationMethode,
} from "../../../../../components/methodes/MethodeMissionFormulaires";
import { JournalModulation } from "../../../../../components/methodes/ResultatModulation";
import { VueMethodeEffective } from "../../../../../components/methodes/VuesMethode";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { formaterDate } from "../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { aPermission } from "@missionpilot/shared";
import {
  hrefMissionMethode,
  texteSourcesDossier,
  type ContexteDossierPropose,
  hrefVersion,
  libelleEtapeGarde,
  libelleNature,
  libelleOrigine,
  libelleStatutDerogation,
  peutDeroger,
  peutLier,
  STATUT_DEROGATION,
  type Derogation,
  type Facteur,
  type MethodeMission,
  type PageMethodes,
} from "../../../../../lib/methodes";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Méthode de la mission", "Engagement method") };
}

const EVENEMENTS = {
  liaison: "Liaison",
  contexte: "Contexte modifié",
  migration: "Migration",
} as const;
const EVENEMENTS_EN = {
  liaison: "Link",
  contexte: "Context changed",
  migration: "Migration",
} as const;

/**
 * Méthode d'une mission (STD-08) : version figée, méthode effective (contexte et dérogations),
 * journal d'application des règles, historique, migration assistée, dérogations (STD-07).
 * Lecture seule pour l'équipe ; liaison, contexte et migration pour les responsables.
 */
export default async function PageMethodeMission({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("standard.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const [mission, r, f, d] = await Promise.all([
    chargerMission(id),
    chargerServeur<MethodeMission>(`/api/missions/${id}/methode`),
    chargerServeur<{ elements: Facteur[] }>("/api/standard/facteurs"),
    chargerServeur<{ elements: Derogation[] }>(`/api/missions/${id}/derogations`),
  ]);
  if ((!r.ok && r.statut === 404) || (!mission.ok && mission.statut === 404)) notFound();
  const titre = mission.ok ? mission.donnees.intitule : t("Mission", "Engagement");
  if (!r.ok || !f.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre={titre}
          retour={{ href: "/methodes/missions", libelle: t("Missions", "Engagements") }}
        />
        <EtatErreur
          titre={t(
            "La méthode de la mission n'a pas pu être chargée.",
            "The engagement method could not be loaded.",
          )}
          message={!r.ok ? r.message : !f.ok ? f.message : ""}
          hrefReessayer={hrefMissionMethode(id)}
        />
      </div>
    );
  }
  const m = r.donnees;
  const facteurs = f.donnees.elements;
  const lier = peutLier(utilisateur.roles);
  const catalogue =
    !m.liaison && lier ? await chargerServeur<PageMethodes>("/api/methodes?limite=100") : null;
  // Dossier → méthode : contexte proposé depuis le dossier du client, à confirmer en liant.
  const propose =
    !m.liaison && lier && aPermission(utilisateur.roles, "dossier.lire")
      ? await chargerServeur<ContexteDossierPropose>(`/api/missions/${id}/methode/contexte-propose`)
      : null;
  const contexteDossier = propose?.ok ? propose.donnees : null;
  const briques = (m.etapes ?? []).flatMap((e) => e.briques);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={titre}
        retour={{ href: "/methodes/missions", libelle: t("Missions", "Engagements") }}
        soustitre={
          m.version
            ? `${m.version.methode_libelle} — version ${m.version.version} (${libelleOrigine(m.version.origine, langue)})`
            : t("Aucune méthode liée", "No method linked")
        }
        actions={
          <Link href={`/missions/${id}`}>{t("Fiche de la mission", "Engagement record")}</Link>
        }
      />

      {!m.liaison ? (
        lier ? (
          <Carte titre={t("Lier une méthode", "Link a method")}>
            {contexteDossier && Object.keys(contexteDossier.contexte).length > 0 ? (
              <p className="mp-texte-doux">
                {t(
                  `Contexte pré-rempli depuis le dossier du client (${texteSourcesDossier(contexteDossier, langue)}) : relisez-le et complétez-le avant de lier la méthode.`,
                  `Context pre-filled from the client file (${texteSourcesDossier(contexteDossier, langue)}): review and complete it before linking the method.`,
                )}
              </p>
            ) : null}
            {catalogue?.ok ? (
              <LiaisonMethode
                missionId={id}
                facteurs={facteurs}
                contexteInitial={contexteDossier?.contexte ?? null}
                versions={catalogue.donnees.elements
                  .filter((x) => x.derniere_publiee)
                  .map((x) => ({
                    id: x.derniere_publiee!.id,
                    libelle: `${x.libelle} — version ${x.derniere_publiee!.version} (${libelleOrigine(x.origine, langue)})`,
                  }))}
              />
            ) : (
              <Alerte
                tonalite="danger"
                titre={t(
                  "Le catalogue des méthodes n'a pas pu être chargé.",
                  "The method catalog could not be loaded.",
                )}
              >
                <p>
                  <Link href={hrefMissionMethode(id)}>{t("Réessayer", "Try again")}</Link>
                </p>
              </Alerte>
            )}
          </Carte>
        ) : (
          <EtatVide
            titre={t(
              "Aucune méthode liée à cette mission.",
              "No method linked to this engagement.",
            )}
            icone="livre"
          >
            <p>
              {t(
                "Le chef ou le directeur de la mission la lie à une version publiée.",
                "The engagement manager or director links it to a published version.",
              )}
            </p>
          </EtatVide>
        )
      ) : (
        <>
          {m.mise_a_jour ? (
            <Carte
              titre={t(
                `Version ${m.mise_a_jour.version} disponible`,
                `Version ${m.mise_a_jour.version} available`,
              )}
            >
              <div className="mp-pile">
                <p>
                  {t(
                    `La mission reste figée sur la version ${m.version?.version} tant que vous ne la migrez pas.`,
                    `The engagement stays locked to version ${m.version?.version} until you migrate it.`,
                  )}
                  {m.mise_a_jour.notes_version ? ` ${m.mise_a_jour.notes_version}` : ""}
                </p>
                {lier ? <MigrationMethode missionId={id} versionId={m.mise_a_jour.id} /> : null}
              </div>
            </Carte>
          ) : null}

          <section aria-labelledby="titre-methode" className="mp-pile">
            <h2 id="titre-methode" className="mp-section__titre">
              {t("Méthode effective", "Effective method")}
            </h2>
            {m.version ? (
              <Link href={hrefVersion(m.version.id)}>
                {t("Voir la version de référence", "See the reference version")}
              </Link>
            ) : null}
            {m.recommandations_candidates && m.recommandations_candidates.length > 0 ? (
              <p>
                {t("Recommandations candidates : ", "Candidate recommendations: ")}
                {m.recommandations_candidates.join(", ")}.
              </p>
            ) : null}
            <VueMethodeEffective etapes={m.etapes ?? []} />
          </section>

          {m.modulation ? (
            <Carte titre={t("Journal d'application des règles", "Rule application log")}>
              <JournalModulation r={m.modulation} langue={langue} />
            </Carte>
          ) : null}

          {lier ? (
            <Carte titre={t("Contexte de la mission", "Engagement context")}>
              <ContexteMission missionId={id} facteurs={facteurs} contexte={m.liaison.contexte} />
            </Carte>
          ) : null}

          <Carte titre={t("Historique", "History")}>
            {(m.historique ?? []).length === 0 ? (
              <p className="mp-texte-doux">
                {t(
                  "Aucun événement : la liaison, les changements de contexte et les migrations s'inscriront ici.",
                  "No event yet: linking, context changes and migrations will be recorded here.",
                )}
              </p>
            ) : null}
            <ul className="mp-liste-simple">
              {(m.historique ?? []).map((h) => (
                <li key={h.id}>
                  {formaterDate(h.cree_le, undefined, langue)} —{" "}
                  {(langue === "en" ? EVENEMENTS_EN : EVENEMENTS)[
                    h.evenement as keyof typeof EVENEMENTS
                  ] ?? h.evenement}{" "}
                  ({t("version", "version")} {h.version})
                  {h.cree_par_nom ? t(` par ${h.cree_par_nom}`, ` by ${h.cree_par_nom}`) : ""}
                  {h.motif ? ` : ${h.motif}` : ""}
                </li>
              ))}
            </ul>
          </Carte>

          <section aria-labelledby="titre-derogations" className="mp-pile">
            <h2 id="titre-derogations" className="mp-section__titre">
              {t("Dérogations", "Waivers")}
            </h2>
            {!d.ok ? (
              <Alerte
                tonalite="danger"
                titre={t(
                  "Les dérogations n'ont pas pu être chargées.",
                  "The waivers could not be loaded.",
                )}
              >
                <p>{d.message}</p>
                <p>
                  <Link href={hrefMissionMethode(id)}>{t("Réessayer", "Try again")}</Link>
                </p>
              </Alerte>
            ) : d.donnees.elements.length === 0 ? (
              <p>
                {t(
                  "Aucune dérogation : la méthode s'applique telle que modulée par le contexte.",
                  "No waiver: the method applies as modulated by the context.",
                )}
              </p>
            ) : (
              <ul className="mp-liste-cartes">
                {d.donnees.elements.map((x) => (
                  <li key={x.id}>
                    <Carte
                      titre={`${libelleNature(x.nature, langue)} — ${x.brique_code}`}
                      niveauTitre={3}
                    >
                      <div className="mp-pile">
                        <div className="mp-badges">
                          <BadgeStatut tonalite={STATUT_DEROGATION[x.statut].tonalite}>
                            {libelleStatutDerogation(x.statut, langue)}
                          </BadgeStatut>
                          <BadgeStatut tonalite="neutre">{x.classe_risque}</BadgeStatut>
                        </div>
                        <p>
                          {t("Motif : ", "Reason: ")}
                          {x.motif}
                        </p>
                        {x.description ? (
                          <p>
                            {t("Adaptation : ", "Adaptation: ")}
                            {x.description}
                          </p>
                        ) : null}
                        <p className="mp-texte-doux mp-texte-petit">
                          {t("Demandée le ", "Requested on ")}
                          {formaterDate(x.cree_le, undefined, langue)}
                          {x.demandeur_nom
                            ? t(` par ${x.demandeur_nom}`, ` by ${x.demandeur_nom}`)
                            : ""}
                        </p>
                        <ul className="mp-liste-simple">
                          {(x.validations ?? []).map((v) => (
                            <li key={v.etape}>
                              {libelleEtapeGarde(v.etape, langue)}
                              {t(" : ", ": ")}
                              {v.decision === "approuve"
                                ? t("approuvée", "approved")
                                : t("refusée", "refused")}
                              {v.acteur_nom ? t(` par ${v.acteur_nom}`, ` by ${v.acteur_nom}`) : ""}
                              {v.commentaire ? ` — ${v.commentaire}` : ""}
                            </li>
                          ))}
                        </ul>
                        {x.statut === "demandee" && x.garde?.prochaine_etape ? (
                          <>
                            <p>
                              {t("Prochaine étape : ", "Next step: ")}
                              {libelleEtapeGarde(x.garde.prochaine_etape, langue)}.
                            </p>
                            {x.demandeur_id !== utilisateur.id ? (
                              <DecisionDerogation
                                derogationId={x.id}
                                etape={x.garde.prochaine_etape}
                              />
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </Carte>
                  </li>
                ))}
              </ul>
            )}
            {peutDeroger(utilisateur.roles) ? (
              <Carte titre={t("Demander une dérogation", "Request a waiver")}>
                <FormulaireDerogation
                  missionId={id}
                  briques={briques.map((b) => ({
                    code: b.code,
                    libelle: b.libelle,
                    active: b.active,
                    classe_risque: b.classe_risque,
                  }))}
                />
              </Carte>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
