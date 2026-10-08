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
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { formaterDate } from "../../../../../lib/format";
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

export const metadata: Metadata = { title: "Méthode de la mission" };

const EVENEMENTS = {
  liaison: "Liaison",
  contexte: "Contexte modifié",
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
  const [mission, r, f, d] = await Promise.all([
    chargerMission(id),
    chargerServeur<MethodeMission>(`/api/missions/${id}/methode`),
    chargerServeur<{ elements: Facteur[] }>("/api/standard/facteurs"),
    chargerServeur<{ elements: Derogation[] }>(`/api/missions/${id}/derogations`),
  ]);
  if ((!r.ok && r.statut === 404) || (!mission.ok && mission.statut === 404)) notFound();
  const titre = mission.ok ? mission.donnees.intitule : "Mission";
  if (!r.ok || !f.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre={titre} retour={{ href: "/methodes/missions", libelle: "Missions" }} />
        <EtatErreur
          titre="La méthode de la mission n'a pas pu être chargée."
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
        retour={{ href: "/methodes/missions", libelle: "Missions" }}
        soustitre={
          m.version
            ? `${m.version.methode_libelle} — version ${m.version.version} (${libelleOrigine(m.version.origine)})`
            : "Aucune méthode liée"
        }
        actions={<Link href={`/missions/${id}`}>Fiche de la mission</Link>}
      />

      {!m.liaison ? (
        lier ? (
          <Carte titre="Lier une méthode">
            {contexteDossier && Object.keys(contexteDossier.contexte).length > 0 ? (
              <p className="mp-texte-doux">
                Contexte pré-rempli depuis le dossier du client (
                {texteSourcesDossier(contexteDossier)}) : relisez-le et complétez-le avant de lier
                la méthode.
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
                    libelle: `${x.libelle} — version ${x.derniere_publiee!.version} (${libelleOrigine(x.origine)})`,
                  }))}
              />
            ) : (
              <p>Le catalogue des méthodes n&apos;a pas pu être chargé.</p>
            )}
          </Carte>
        ) : (
          <EtatVide titre="Aucune méthode liée à cette mission." icone="livre">
            <p>Le chef ou le directeur de la mission la lie à une version publiée.</p>
          </EtatVide>
        )
      ) : (
        <>
          {m.mise_a_jour ? (
            <Carte titre={`Version ${m.mise_a_jour.version} disponible`}>
              <div className="mp-pile">
                <p>
                  La mission reste figée sur la version {m.version?.version} tant que vous ne la
                  migrez pas.
                  {m.mise_a_jour.notes_version ? ` ${m.mise_a_jour.notes_version}` : ""}
                </p>
                {lier ? <MigrationMethode missionId={id} versionId={m.mise_a_jour.id} /> : null}
              </div>
            </Carte>
          ) : null}

          <section aria-labelledby="titre-methode" className="mp-pile">
            <h2 id="titre-methode" className="mp-section__titre">
              Méthode effective
            </h2>
            {m.version ? (
              <Link href={hrefVersion(m.version.id)}>Voir la version de référence</Link>
            ) : null}
            {m.recommandations_candidates && m.recommandations_candidates.length > 0 ? (
              <p>Recommandations candidates : {m.recommandations_candidates.join(", ")}.</p>
            ) : null}
            <VueMethodeEffective etapes={m.etapes ?? []} />
          </section>

          {m.modulation ? (
            <Carte titre="Journal d'application des règles">
              <JournalModulation r={m.modulation} />
            </Carte>
          ) : null}

          {lier ? (
            <Carte titre="Contexte de la mission">
              <ContexteMission missionId={id} facteurs={facteurs} contexte={m.liaison.contexte} />
            </Carte>
          ) : null}

          <Carte titre="Historique">
            <ul className="mp-liste-simple">
              {(m.historique ?? []).map((h) => (
                <li key={h.id}>
                  {formaterDate(h.cree_le)} —{" "}
                  {EVENEMENTS[h.evenement as keyof typeof EVENEMENTS] ?? h.evenement} (version{" "}
                  {h.version}){h.cree_par_nom ? ` par ${h.cree_par_nom}` : ""}
                  {h.motif ? ` : ${h.motif}` : ""}
                </li>
              ))}
            </ul>
          </Carte>

          <section aria-labelledby="titre-derogations" className="mp-pile">
            <h2 id="titre-derogations" className="mp-section__titre">
              Dérogations
            </h2>
            {!d.ok ? (
              <p>{d.message}</p>
            ) : d.donnees.elements.length === 0 ? (
              <p>
                Aucune dérogation : la méthode s&apos;applique telle que modulée par le contexte.
              </p>
            ) : (
              <ul className="mp-liste-cartes">
                {d.donnees.elements.map((x) => (
                  <li key={x.id}>
                    <Carte titre={`${libelleNature(x.nature)} — ${x.brique_code}`} niveauTitre={3}>
                      <div className="mp-pile">
                        <div className="mp-badges">
                          <BadgeStatut tonalite={STATUT_DEROGATION[x.statut].tonalite}>
                            {STATUT_DEROGATION[x.statut].libelle}
                          </BadgeStatut>
                          <BadgeStatut tonalite="neutre">{x.classe_risque}</BadgeStatut>
                        </div>
                        <p>Motif : {x.motif}</p>
                        {x.description ? <p>Adaptation : {x.description}</p> : null}
                        <p className="mp-texte-doux mp-texte-petit">
                          Demandée le {formaterDate(x.cree_le)}
                          {x.demandeur_nom ? ` par ${x.demandeur_nom}` : ""}
                        </p>
                        <ul className="mp-liste-simple">
                          {(x.validations ?? []).map((v) => (
                            <li key={v.etape}>
                              {libelleEtapeGarde(v.etape)} :{" "}
                              {v.decision === "approuve" ? "approuvée" : "refusée"}
                              {v.acteur_nom ? ` par ${v.acteur_nom}` : ""}
                              {v.commentaire ? ` — ${v.commentaire}` : ""}
                            </li>
                          ))}
                        </ul>
                        {x.statut === "demandee" && x.garde?.prochaine_etape ? (
                          <>
                            <p>Prochaine étape : {libelleEtapeGarde(x.garde.prochaine_etape)}.</p>
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
              <Carte titre="Demander une dérogation">
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
