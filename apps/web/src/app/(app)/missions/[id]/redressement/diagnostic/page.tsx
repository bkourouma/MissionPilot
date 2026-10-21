import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import "../../../../../../components/redressement/diagnostic.css";
import { CausesCartographie } from "../../../../../../components/redressement/CausesCartographie";
import { CausesGeneration } from "../../../../../../components/redressement/CausesGeneration";
import { ChecklistActivation } from "../../../../../../components/redressement/ChecklistActivation";
import { ChecklistCarte } from "../../../../../../components/redressement/ChecklistCarte";
import { EtatContexteRed } from "../../../../../../components/redressement/EtatsContexte";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../components/ui/EtatListe";
import { hrefRedressement, raisonSansEcriture } from "../../../../../../lib/redressement";
import {
  BANDEAU_CAUSES_IA,
  TEXTE_CAUSES_AUCUNE,
} from "../../../../../../lib/redressement-diagnostic";
import { chargerContexteRed } from "../../../../../../lib/redressement-serveur";
import {
  chargerCausesDossier,
  chargerChecklistsDossier,
  chargerModelesChecklists,
  chargerReferentielChecklists,
} from "../../../../../../lib/redressement-diagnostic-serveur";

export const metadata: Metadata = { title: "Diagnostic du dossier" };

/**
 * Diagnostic (RED-03, RED-04) : check-lists métier du dossier (complétude et conformité du
 * moteur, saisie des réponses) et cartographie des causes racines proposée par l'IA, à valider
 * par un consultant. L'API reste seule juge des droits et de la séparation des tâches.
 */
export default async function PageDiagnostic({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await chargerContexteRed(id);
  if (ctx.etat !== "ok") {
    return (
      <EtatContexteRed
        contexte={ctx}
        missionId={id}
        hrefReessayer={hrefRedressement(id, "diagnostic")}
      />
    );
  }
  const { mission, dossier, droits, session } = ctx;
  const roles = session.utilisateur.roles;
  const peutIa = aPermission(roles, "ia.utiliser");
  const [checklists, causes, referentiel, modeles] = await Promise.all([
    chargerChecklistsDossier(dossier.id),
    chargerCausesDossier(dossier.id),
    droits.ecrire ? chargerReferentielChecklists() : Promise.resolve(null),
    droits.ecrire ? chargerModelesChecklists() : Promise.resolve(null),
  ]);
  const departs =
    referentiel && referentiel.ok
      ? referentiel.donnees.departs.map((d) => ({
          valeur: `depart:${d.code}`,
          intitule: d.intitule,
          secteur: d.secteur,
        }))
      : [];
  const modelesPublies =
    modeles && modeles.ok
      ? modeles.donnees.modeles
          .filter((m) => m.en_vigueur !== null)
          .map((m) => ({ valeur: `modele:${m.id}`, intitule: m.intitule, secteur: m.secteur }))
      : [];

  return (
    <div className="mp-red">
      <section className="mp-red-section" aria-labelledby="titre-checklists">
        <h2 id="titre-checklists" className="mp-red-section__titre">
          Check-lists du dossier
        </h2>
        {!checklists.ok ? (
          <EtatErreur
            titre="Les check-lists n'ont pas pu être chargées."
            message={checklists.message}
            hrefReessayer={hrefRedressement(id, "diagnostic")}
          />
        ) : (
          <>
            {checklists.echecs > 0 ? (
              <Alerte tonalite="attention" annonce="aucune">
                <p>
                  {checklists.echecs} check-list(s) n&apos;ont pas pu être chargées : actualisez la
                  page.
                </p>
              </Alerte>
            ) : null}
            {checklists.checklists.length === 0 ? (
              <EtatVide titre="Aucune check-list activée." icone="taches">
                <p>
                  Activez une check-list de départ ou un modèle publié du cabinet pour structurer le
                  diagnostic.
                </p>
              </EtatVide>
            ) : (
              <div className="mp-diag-liste">
                {checklists.checklists.map((c) => (
                  <ChecklistCarte key={c.id} checklist={c} peutEcrire={droits.ecrire} />
                ))}
              </div>
            )}
          </>
        )}
        {droits.ecrire ? (
          <Carte titre="Activer une check-list" niveauTitre={3}>
            {departs.length + modelesPublies.length === 0 ? (
              <p className="mp-texte-doux">Aucune check-list disponible à l&apos;activation.</p>
            ) : (
              <ChecklistActivation
                dossierId={dossier.id}
                departs={departs}
                modeles={modelesPublies}
              />
            )}
          </Carte>
        ) : (
          <p className="mp-texte-doux">{raisonSansEcriture(mission, dossier, roles)}</p>
        )}
      </section>

      <section className="mp-red-section" aria-labelledby="titre-causes">
        <h2 id="titre-causes" className="mp-red-section__titre">
          Causes racines
        </h2>
        <Alerte tonalite="info" annonce="aucune">
          <p>{BANDEAU_CAUSES_IA}</p>
        </Alerte>
        {droits.ecrire ? (
          <Carte titre="Demander une proposition" niveauTitre={3}>
            <CausesGeneration
              dossierId={dossier.id}
              desactiveParce={
                peutIa ? undefined : "Votre rôle ne permet pas de lancer une proposition de l'IA."
              }
            />
          </Carte>
        ) : null}
        {!causes.ok ? (
          <EtatErreur
            titre="Les causes racines n'ont pas pu être chargées."
            message={causes.message}
            hrefReessayer={hrefRedressement(id, "diagnostic")}
          />
        ) : causes.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucune cartographie." icone="info">
            <p>{TEXTE_CAUSES_AUCUNE}</p>
          </EtatVide>
        ) : (
          causes.donnees.elements.map((v, i) => (
            <Carte key={v.id} titre={`Cartographie, version ${v.version}`} niveauTitre={3}>
              {i === 0 ? (
                <CausesCartographie
                  key={`${v.id}-${v.modifie_le}-${v.statut}`}
                  version={v}
                  peutEcrire={droits.ecrire}
                  peutValider={droits.valider}
                />
              ) : (
                <details className="mp-diag-details">
                  <summary>Afficher cette version</summary>
                  <CausesCartographie
                    key={`${v.id}-${v.modifie_le}-${v.statut}`}
                    version={v}
                    peutEcrire={droits.ecrire}
                    peutValider={droits.valider}
                  />
                </details>
              )}
            </Carte>
          ))
        )}
      </section>
    </div>
  );
}
