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
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import { hrefRedressement, raisonSansEcriture } from "../../../../../../lib/redressement";
import { cheminClotures, textesCloture } from "../../../../../../lib/redressement-cloture";
import { choisirVersion } from "../../../../../../lib/redressement-cloture-saisie";
import {
  chargerClotureDetail,
  chargerCloturesDossier,
  chargerRapportsCloture,
} from "../../../../../../lib/redressement-cloture-serveur";
import { chargerContexteRed } from "../../../../../../lib/redressement-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Bilan de clôture du redressement", "Turnaround close-out review") };
}

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
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const tx = textesCloture(langue);
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
          titre={t(
            "Les bilans de clôture n'ont pas pu être chargés.",
            "The close-out reviews could not be loaded.",
          )}
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
      libelle={t("Établir un bilan de clôture", "Create a close-out review")}
      chemin={cheminClotures(dossier.id)}
      succes={t(
        "Bilan de clôture établi depuis l'état courant du dossier.",
        "Close-out review created from the current state of the file.",
      )}
      titreErreur={t("Établissement impossible", "Creation not possible")}
      texteChargement={t("Établissement…", "Creating…")}
      variante="primaire"
    />
  ) : (
    <p className="mp-texte-doux">
      {dossier.statut === "clos" || mission.statut === "cloturee"
        ? raisonSansEcriture(mission, dossier, roles, langue)
        : tx.lectureSeule}
    </p>
  );

  return (
    <div className="mp-red">
      <section className="mp-red-section" aria-labelledby="titre-cloture">
        <h2 id="titre-cloture" className="mp-red-section__titre">
          {t("Bilan de clôture", "Close-out review")}
        </h2>
        <Alerte tonalite="info" annonce="aucune">
          <p>{tx.intro}</p>
        </Alerte>
        {versions.length > 0 ? (
          <ClotureVersions missionId={id} versions={versions} courante={choisie?.version ?? 0} />
        ) : null}
        {etablir}
      </section>

      {versions.length === 0 ? (
        <EtatVide titre={t("Aucun bilan de clôture.", "No close-out review.")} icone="info">
          <p>{tx.aucun}</p>
        </EtatVide>
      ) : detail && !detail.ok ? (
        <EtatErreur
          titre={t("Le bilan n'a pas pu être chargé.", "The review could not be loaded.")}
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
              {t("Validation", "Approval")}
            </h2>
            {bilan.statut === "valide" ? (
              <Alerte tonalite="succes" annonce="aucune">
                <p>{tx.valide}</p>
              </Alerte>
            ) : droits.valider ? (
              <Carte titre={t("Valider le bilan", "Approve the review")} niveauTitre={3}>
                {bilan.peut_valider ? null : (
                  <p className="mp-texte-doux">
                    {t(
                      "Le serveur indique que ce bilan ne peut pas être validé en l'état par vous : contrôles bloquants, rôle ou séparation des tâches. La validation reste possible à tenter, son refus sera expliqué.",
                      "The server indicates that this review cannot be approved as is by you: blocking checks, role or segregation of duties. You can still try to approve it; a refusal will be explained.",
                    )}
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
                {t(
                  "La validation est réservée au directeur de la mission.",
                  "Approval is reserved for the engagement director.",
                )}
              </p>
            )}
          </section>

          <section className="mp-red-section" aria-labelledby="titre-rapports-cloture">
            <h2 id="titre-rapports-cloture" className="mp-red-section__titre">
              {t("Rapports de clôture", "Close-out reports")}
            </h2>
            <Carte titre={t("Générer le rapport", "Generate the report")} niveauTitre={3}>
              <ClotureRapportGeneration
                clotureId={bilan.id}
                desactiveParce={
                  bilan.statut !== "valide"
                    ? tx.rapportNonValide
                    : mission.statut === "cloturee"
                      ? tx.rapportCloturee
                      : undefined
                }
              />
            </Carte>
            {rapports && !rapports.ok ? (
              <EtatErreur
                titre={t(
                  "Les rapports n'ont pas pu être chargés.",
                  "The reports could not be loaded.",
                )}
                message={rapports.message}
                hrefReessayer={retour}
              />
            ) : rapports ? (
              <ClotureRapportsListe rapports={rapports.donnees.elements} />
            ) : (
              <p className="mp-texte-doux">
                {t(
                  "Aucun rapport : le bilan n'est pas validé.",
                  "No report: the review is not approved.",
                )}
              </p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
