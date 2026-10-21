import type { Metadata } from "next";
import "../../../../../../components/redressement/cloture.css";
import { ClotureAvancement } from "../../../../../../components/redressement/ClotureAvancement";
import { ClotureControles } from "../../../../../../components/redressement/ClotureControles";
import { ClotureEntete } from "../../../../../../components/redressement/ClotureEntete";
import { ClotureEvolutions } from "../../../../../../components/redressement/ClotureEvolutions";
import { ClotureRapportGeneration } from "../../../../../../components/redressement/ClotureRapportGeneration";
import { ClotureRapportsListe } from "../../../../../../components/redressement/ClotureRapportsListe";
import { ClotureRatios } from "../../../../../../components/redressement/ClotureRatios";
import { ClotureRenotation } from "../../../../../../components/redressement/ClotureRenotation";
import { ClotureValidation } from "../../../../../../components/redressement/ClotureValidation";
import { ClotureVersions } from "../../../../../../components/redressement/ClotureVersions";
import { BoutonActionRed } from "../../../../../../components/redressement/BoutonActionRed";
import { EtatContexteRed } from "../../../../../../components/redressement/EtatsContexte";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../components/ui/EtatListe";
import { hrefRedressement, raisonSansEcriture } from "../../../../../../lib/redressement";
import {
  cheminClotures,
  TEXTE_CLOTURE_AUCUN,
  TEXTE_CLOTURE_INTRO,
  TEXTE_CLOTURE_LECTURE_SEULE,
  TEXTE_CLOTURE_RAPPORT_CLOTUREE,
  TEXTE_CLOTURE_RAPPORT_NON_VALIDE,
  TEXTE_CLOTURE_VALIDE,
} from "../../../../../../lib/redressement-cloture";
import { choisirVersion } from "../../../../../../lib/redressement-cloture-saisie";
import {
  chargerClotureDetail,
  chargerCloturesDossier,
  chargerRapportsCloture,
} from "../../../../../../lib/redressement-cloture-serveur";
import { chargerContexteRed } from "../../../../../../lib/redressement-serveur";

export const metadata: Metadata = { title: "Bilan de clôture du redressement" };

/**
 * Bilan de clôture (RED-08) : versions, bilan courant (ratios, alerte, urgence, trésorerie, plan,
 * créanciers, covenants, check-lists, causes validées, re-notation), contrôles de complétude,
 * validation par le directeur de la mission et rapports. Tout est calculé par le serveur ;
 * l'API reste seule juge des droits, de la séparation des tâches et de l'état du dossier.
 */
export default async function PageCloture({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { version } = await searchParams;
  const ctx = await chargerContexteRed(id);
  if (ctx.etat !== "ok") {
    return (
      <EtatContexteRed
        contexte={ctx}
        missionId={id}
        hrefReessayer={hrefRedressement(id, "cloture")}
      />
    );
  }
  const { mission, dossier, droits, session } = ctx;
  const roles = session.utilisateur.roles;
  const liste = await chargerCloturesDossier(dossier.id);
  const retour = hrefRedressement(id, "cloture");
  if (!liste.ok) {
    return (
      <div className="mp-red">
        <EtatErreur
          titre="Les bilans de clôture n'ont pas pu être chargés."
          message={liste.message}
          hrefReessayer={retour}
        />
      </div>
    );
  }
  const versions = liste.donnees.elements;
  const choisie = choisirVersion(versions, version);
  const detail = choisie ? await chargerClotureDetail(choisie.id) : null;
  const rapports =
    choisie && choisie.statut === "valide" ? await chargerRapportsCloture(choisie.id) : null;
  const bilan = detail && detail.ok ? detail.donnees : null;

  const etablir = droits.ecrire ? (
    <BoutonActionRed
      libelle="Établir un bilan de clôture"
      chemin={cheminClotures(dossier.id)}
      succes="Bilan de clôture établi depuis l'état courant du dossier."
      titreErreur="Établissement impossible"
      texteChargement="Établissement…"
      variante="primaire"
    />
  ) : (
    <p className="mp-texte-doux">
      {dossier.statut === "clos" || mission.statut === "cloturee"
        ? raisonSansEcriture(mission, dossier, roles)
        : TEXTE_CLOTURE_LECTURE_SEULE}
    </p>
  );

  return (
    <div className="mp-red">
      <section className="mp-red-section" aria-labelledby="titre-cloture">
        <h2 id="titre-cloture" className="mp-red-section__titre">
          Bilan de clôture
        </h2>
        <Alerte tonalite="info" annonce="aucune">
          <p>{TEXTE_CLOTURE_INTRO}</p>
        </Alerte>
        {versions.length > 0 ? (
          <ClotureVersions missionId={id} versions={versions} courante={choisie?.version ?? 0} />
        ) : null}
        {etablir}
      </section>

      {versions.length === 0 ? (
        <EtatVide titre="Aucun bilan de clôture." icone="info">
          <p>{TEXTE_CLOTURE_AUCUN}</p>
        </EtatVide>
      ) : detail && !detail.ok ? (
        <EtatErreur
          titre="Le bilan n'a pas pu être chargé."
          message={detail.message}
          hrefReessayer={retour}
        />
      ) : bilan ? (
        <>
          <ClotureEntete bilan={bilan} />
          <ClotureControles contenu={bilan.contenu} />
          <ClotureRatios contenu={bilan.contenu} />
          <ClotureEvolutions contenu={bilan.contenu} />
          <ClotureAvancement contenu={bilan.contenu} />
          <ClotureRenotation contenu={bilan.contenu} />

          <section className="mp-red-section" aria-labelledby="titre-validation">
            <h2 id="titre-validation" className="mp-red-section__titre">
              Validation
            </h2>
            {bilan.statut === "valide" ? (
              <Alerte tonalite="succes" annonce="aucune">
                <p>{TEXTE_CLOTURE_VALIDE}</p>
              </Alerte>
            ) : droits.valider ? (
              <Carte titre="Valider le bilan" niveauTitre={3}>
                {bilan.peut_valider ? null : (
                  <p className="mp-texte-doux">
                    Le serveur indique que ce bilan ne peut pas être validé en l&apos;état par vous
                    : contrôles bloquants, rôle ou séparation des tâches. La validation reste
                    possible à tenter, son refus sera expliqué.
                  </p>
                )}
                <ClotureValidation
                  clotureId={bilan.id}
                  dossierId={dossier.id}
                  peutEtablir={droits.ecrire}
                />
              </Carte>
            ) : (
              <p className="mp-texte-doux">
                La validation est réservée au directeur de la mission.
              </p>
            )}
          </section>

          <section className="mp-red-section" aria-labelledby="titre-rapports-cloture">
            <h2 id="titre-rapports-cloture" className="mp-red-section__titre">
              Rapports de clôture
            </h2>
            <Carte titre="Générer le rapport" niveauTitre={3}>
              <ClotureRapportGeneration
                clotureId={bilan.id}
                desactiveParce={
                  bilan.statut !== "valide"
                    ? TEXTE_CLOTURE_RAPPORT_NON_VALIDE
                    : mission.statut === "cloturee"
                      ? TEXTE_CLOTURE_RAPPORT_CLOTUREE
                      : undefined
                }
              />
            </Carte>
            {rapports && !rapports.ok ? (
              <EtatErreur
                titre="Les rapports n'ont pas pu être chargés."
                message={rapports.message}
                hrefReessayer={retour}
              />
            ) : rapports ? (
              <ClotureRapportsListe rapports={rapports.donnees.elements} />
            ) : (
              <p className="mp-texte-doux">Aucun rapport : le bilan n&apos;est pas validé.</p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
