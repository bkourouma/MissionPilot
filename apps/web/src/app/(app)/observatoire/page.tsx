import type { Metadata } from "next";
import type {
  ObservatoireAgregats,
  ObservatoireEtatAdhesion,
  ObservatoireResumeContributions,
} from "@missionpilot/shared";
import {
  ActionsContributions,
  FormulaireAdhesion,
  FormulaireRetraitAdhesion,
} from "../../../components/observatoire/FormulairesObservatoire";
import {
  GrilleAgregats,
  MargesAgregats,
  PrincipesObservatoire,
  ResumeContributions,
} from "../../../components/observatoire/VuesObservatoire";
import { Alerte } from "../../../components/ui/Alerte";
import { Calcule } from "../../../components/ui/Calcule";
import { Carte } from "../../../components/ui/Carte";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../components/ui/EtatListe";
import { chargerServeur } from "../../../lib/api-serveur";
import { formaterDate } from "../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import {
  CHEMIN_ADHESION,
  CHEMIN_AGREGATS,
  CHEMIN_RESUME_CONTRIBUTIONS,
  CODES_403_AGREGATS,
  estEtatMetierAgregats,
  etatPageObservatoire,
  formaterPeriode,
  OBSERVATOIRE_PAGE_INDICATEUR,
  peutAdhererObservatoire,
} from "../../../lib/observatoire";
import { messageAgregatsIndisponibles } from "../../../lib/observatoire-versement";
import { exigerPermission } from "../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Observatoire inter-cabinets", "Cross-firm observatory") };
}

/**
 * Observatoire inter-cabinets (CAP-04) : adhésion volontaire, agrégats anonymes réservés aux
 * cabinets contributeurs. Un cabinet non adhérent ne voit aucun chiffre. Les nombres viennent de
 * l'API (moteur) ; la page ne fait que les afficher.
 */
export default async function PageObservatoire() {
  const session = await exigerPermission("observatoire.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const roles = session.utilisateur.roles;
  const adhesionR = await chargerServeur<ObservatoireEtatAdhesion>(CHEMIN_ADHESION);
  const entete = (
    <EnteteDePage
      titre={t("Observatoire inter-cabinets", "Cross-firm observatory")}
      soustitre={t(
        "Comparez vos entreprises clientes à des agrégats anonymes de cabinets contributeurs.",
        "Compare your client companies with anonymous aggregates from contributing firms.",
      )}
    />
  );
  if (!adhesionR.ok) {
    return (
      <div className="mp-page mp-observatoire">
        {entete}
        <EtatErreur
          titre={t(
            "L'observatoire n'a pas pu être chargé.",
            "The observatory could not be loaded.",
          )}
          message={adhesionR.message}
          hrefReessayer="/observatoire"
        />
      </div>
    );
  }
  const adhesion = adhesionR.donnees;
  const etat = etatPageObservatoire(adhesion, roles);
  const peutAdherer = peutAdhererObservatoire(roles);

  if (etat !== "adherent") {
    return (
      <div className="mp-page mp-observatoire">
        {entete}
        <PrincipesObservatoire />
        {etat === "adhesion_possible" ? (
          <Carte titre={t("Adhérer à l'observatoire", "Join the observatory")} niveauTitre={2}>
            <FormulaireAdhesion />
          </Carte>
        ) : (
          <Alerte
            tonalite="info"
            titre={t("Votre cabinet n'a pas adhéré", "Your firm has not joined")}
            annonce="aucune"
          >
            <p>
              {t(
                "Aucun agrégat n'est consultable tant que le cabinet n'est pas contributeur. Un associé doit décider l'adhésion.",
                "No aggregate can be viewed until the firm is a contributor. A partner must decide to join.",
              )}
            </p>
          </Alerte>
        )}
      </div>
    );
  }

  const [agregatsR, resumeR] = await Promise.all([
    chargerServeur<ObservatoireAgregats>(
      `${CHEMIN_AGREGATS}?indicateur=${OBSERVATOIRE_PAGE_INDICATEUR}`,
      CODES_403_AGREGATS,
    ),
    peutAdherer
      ? chargerServeur<ObservatoireResumeContributions>(
          `${CHEMIN_RESUME_CONTRIBUTIONS}?indicateur=${OBSERVATOIRE_PAGE_INDICATEUR}`,
        )
      : Promise.resolve(null),
  ]);

  return (
    <div className="mp-page mp-observatoire">
      {entete}
      <Alerte
        tonalite="succes"
        titre={t("Votre cabinet est contributeur", "Your firm is a contributor")}
        annonce="aucune"
      >
        <p>
          {t(
            `Adhésion active depuis le ${formaterDate(adhesion.depuis, "UTC", langue)}. Les agrégats sont gelés par mois : un versement n'apparaît qu'au mois suivant.`,
            `Membership active since ${formaterDate(adhesion.depuis, "UTC", langue)}. Aggregates are frozen monthly: a contribution only appears the following month.`,
          )}
        </p>
      </Alerte>
      {!agregatsR.ok && estEtatMetierAgregats(agregatsR) ? (
        <Alerte
          tonalite="info"
          titre={t("Agrégats non disponibles", "Aggregates unavailable")}
          annonce="aucune"
        >
          <p>
            {messageAgregatsIndisponibles(agregatsR.code, agregatsR.message, peutAdherer, langue)}
          </p>
        </Alerte>
      ) : !agregatsR.ok ? (
        <EtatErreur
          titre={t(
            "Les agrégats n'ont pas pu être chargés.",
            "The aggregates could not be loaded.",
          )}
          message={agregatsR.message}
          hrefReessayer="/observatoire"
        />
      ) : (
        <Carte
          titre={t("Score global par secteur et taille", "Overall score by sector and size")}
          niveauTitre={2}
          actions={<Calcule />}
        >
          <p className="mp-texte-petit mp-texte-doux">
            {t(
              `Situation à la fin du mois précédant ${formaterPeriode(agregatsR.donnees.periode_courante, langue)}. Valeurs arrondies ; une case n'est publiée qu'à partir de ${agregatsR.donnees.seuils.entreprises_min} entreprises issues d'au moins ${agregatsR.donnees.seuils.cabinets_min} cabinets.`,
              `Situation at the end of the month preceding ${formaterPeriode(agregatsR.donnees.periode_courante, langue)}. Rounded values; a cell is only published from ${agregatsR.donnees.seuils.entreprises_min} companies coming from at least ${agregatsR.donnees.seuils.cabinets_min} firms.`,
            )}
          </p>
          <GrilleAgregats agregats={agregatsR.donnees} />
          <MargesAgregats agregats={agregatsR.donnees} />
        </Carte>
      )}
      {peutAdherer ? (
        <>
          <Carte titre={t("Vos contributions", "Your contributions")} niveauTitre={2}>
            {resumeR && resumeR.ok ? (
              <ResumeContributions resume={resumeR.donnees} />
            ) : (
              <EtatErreur
                titre={t("Le résumé n'a pas pu être chargé.", "The summary could not be loaded.")}
                message={resumeR && !resumeR.ok ? resumeR.message : ""}
                hrefReessayer="/observatoire"
              />
            )}
            <ActionsContributions
              aDesContributions={
                resumeR?.ok === true &&
                (resumeR.donnees.en_attente !== null || resumeR.donnees.retenu !== null)
              }
            />
          </Carte>
          <Carte
            titre={t("Se retirer de l'observatoire", "Withdraw from the observatory")}
            niveauTitre={2}
          >
            <FormulaireRetraitAdhesion />
          </Carte>
        </>
      ) : null}
    </div>
  );
}
