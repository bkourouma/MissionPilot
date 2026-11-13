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
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import { hrefRedressement, raisonSansEcriture } from "../../../../../../lib/redressement";
import { validationCauses } from "../../../../../../lib/redressement-droits";
import {
  BANDEAU_CAUSES_IA,
  BANDEAU_CAUSES_IA_EN,
  TEXTE_CAUSES_AUCUNE,
  TEXTE_CAUSES_AUCUNE_EN,
} from "../../../../../../lib/redressement-diagnostic";
import { chargerContexteRed } from "../../../../../../lib/redressement-serveur";
import {
  chargerCausesDossier,
  chargerChecklistsDossier,
  chargerModelesChecklists,
  chargerReferentielChecklists,
} from "../../../../../../lib/redressement-diagnostic-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Diagnostic du dossier", "File diagnostic") };
}

/**
 * Diagnostic (RED-03, RED-04) : check-lists métier du dossier (complétude et conformité du
 * moteur, saisie des réponses) et cartographie des causes racines proposée par l'IA, à valider
 * par un consultant. L'API reste seule juge des droits et de la séparation des tâches.
 */
export default async function PageDiagnostic({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
  const etatValidation = (v: Parameters<typeof validationCauses>[0]) =>
    validationCauses(v, droits.ecrire, roles, session.utilisateur.id, langue);
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
          {t("Check-lists du dossier", "File checklists")}
        </h2>
        {!checklists.ok ? (
          <EtatErreur
            titre={t(
              "Les check-lists n'ont pas pu être chargées.",
              "The checklists could not be loaded.",
            )}
            message={checklists.message}
            hrefReessayer={hrefRedressement(id, "diagnostic")}
          />
        ) : (
          <>
            {checklists.echecs > 0 ? (
              <Alerte tonalite="attention" annonce="aucune">
                <p>
                  {t(
                    `${checklists.echecs} check-list(s) n'ont pas pu être chargées : actualisez la page.`,
                    `${checklists.echecs} checklist(s) could not be loaded: refresh the page.`,
                  )}
                </p>
              </Alerte>
            ) : null}
            {checklists.checklists.length === 0 ? (
              <EtatVide
                titre={t("Aucune check-list activée.", "No checklist activated.")}
                icone="taches"
              >
                <p>
                  {t(
                    "Activez une check-list de départ ou un modèle publié du cabinet pour structurer le diagnostic.",
                    "Activate a starter checklist or a published firm template to structure the diagnostic.",
                  )}
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
          <Carte titre={t("Activer une check-list", "Activate a checklist")} niveauTitre={3}>
            {departs.length + modelesPublies.length === 0 ? (
              <p className="mp-texte-doux">
                {t(
                  "Aucune check-list disponible à l'activation.",
                  "No checklist available for activation.",
                )}
              </p>
            ) : (
              <ChecklistActivation
                dossierId={dossier.id}
                departs={departs}
                modeles={modelesPublies}
              />
            )}
          </Carte>
        ) : (
          <p className="mp-texte-doux">{raisonSansEcriture(mission, dossier, roles, langue)}</p>
        )}
      </section>

      <section className="mp-red-section" aria-labelledby="titre-causes">
        <h2 id="titre-causes" className="mp-red-section__titre">
          {t("Causes racines", "Root causes")}
        </h2>
        <Alerte tonalite="info" annonce="aucune">
          <p>{t(BANDEAU_CAUSES_IA, BANDEAU_CAUSES_IA_EN)}</p>
        </Alerte>
        {droits.ecrire ? (
          <Carte titre={t("Demander une proposition", "Request a proposal")} niveauTitre={3}>
            <CausesGeneration
              dossierId={dossier.id}
              desactiveParce={
                peutIa
                  ? undefined
                  : t(
                      "Votre rôle ne permet pas de lancer une proposition de l'IA.",
                      "Your role does not allow you to request an AI proposal.",
                    )
              }
            />
          </Carte>
        ) : null}
        {!causes.ok ? (
          <EtatErreur
            titre={t(
              "Les causes racines n'ont pas pu être chargées.",
              "The root causes could not be loaded.",
            )}
            message={causes.message}
            hrefReessayer={hrefRedressement(id, "diagnostic")}
          />
        ) : causes.donnees.elements.length === 0 ? (
          <EtatVide titre={t("Aucune cartographie.", "No mapping.")} icone="info">
            <p>{t(TEXTE_CAUSES_AUCUNE, TEXTE_CAUSES_AUCUNE_EN)}</p>
          </EtatVide>
        ) : (
          causes.donnees.elements.map((v, i) => (
            <Carte
              key={v.id}
              titre={t(`Cartographie, version ${v.version}`, `Mapping, version ${v.version}`)}
              niveauTitre={3}
            >
              {i === 0 ? (
                <CausesCartographie
                  key={`${v.id}-${v.modifie_le}-${v.statut}`}
                  version={v}
                  peutEcrire={droits.ecrire}
                  peutValider={etatValidation(v).proposee}
                  raisonValidation={etatValidation(v).raison}
                />
              ) : (
                <details className="mp-diag-details">
                  <summary>{t("Afficher cette version", "Show this version")}</summary>
                  <CausesCartographie
                    key={`${v.id}-${v.modifie_le}-${v.statut}`}
                    version={v}
                    peutEcrire={droits.ecrire}
                    peutValider={etatValidation(v).proposee}
                    raisonValidation={etatValidation(v).raison}
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
