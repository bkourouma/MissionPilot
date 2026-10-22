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
import { Carte } from "../../../components/ui/Carte";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../components/ui/EtatListe";
import { chargerServeur } from "../../../lib/api-serveur";
import { formaterDate } from "../../../lib/format";
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
import { exigerPermission } from "../../../lib/session";

export const metadata: Metadata = { title: "Observatoire inter-cabinets" };

/**
 * Observatoire inter-cabinets (CAP-04) : adhésion volontaire, agrégats anonymes réservés aux
 * cabinets contributeurs. Un cabinet non adhérent ne voit aucun chiffre. Les nombres viennent de
 * l'API (moteur) ; la page ne fait que les afficher.
 */
export default async function PageObservatoire() {
  const session = await exigerPermission("observatoire.lire");
  const roles = session.utilisateur.roles;
  const adhesionR = await chargerServeur<ObservatoireEtatAdhesion>(CHEMIN_ADHESION);
  const entete = (
    <EnteteDePage
      titre="Observatoire inter-cabinets"
      soustitre="Comparez vos entreprises clientes à des agrégats anonymes de cabinets contributeurs."
    />
  );
  if (!adhesionR.ok) {
    return (
      <div className="mp-page mp-observatoire">
        {entete}
        <EtatErreur
          titre="L'observatoire n'a pas pu être chargé."
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
          <Carte titre="Adhérer à l'observatoire" niveauTitre={2}>
            <FormulaireAdhesion />
          </Carte>
        ) : (
          <Alerte tonalite="info" titre="Votre cabinet n'a pas adhéré" annonce="aucune">
            <p>
              Aucun agrégat n&apos;est consultable tant que le cabinet n&apos;est pas contributeur.
              Un associé doit décider l&apos;adhésion.
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
      <Alerte tonalite="succes" titre="Votre cabinet est contributeur" annonce="aucune">
        <p>
          Adhésion active depuis le {formaterDate(adhesion.depuis)}. Les agrégats sont gelés par
          mois : un versement n&apos;apparaît qu&apos;au mois suivant.
        </p>
      </Alerte>
      {!agregatsR.ok && estEtatMetierAgregats(agregatsR) ? (
        <Alerte tonalite="info" titre="Agrégats non disponibles" annonce="aucune">
          <p>{agregatsR.message}</p>
        </Alerte>
      ) : !agregatsR.ok ? (
        <EtatErreur
          titre="Les agrégats n'ont pas pu être chargés."
          message={agregatsR.message}
          hrefReessayer="/observatoire"
        />
      ) : (
        <Carte titre="Score global par secteur et taille" niveauTitre={2}>
          <p className="mp-texte-petit mp-texte-doux">
            Situation à la fin du mois précédant{" "}
            {formaterPeriode(agregatsR.donnees.periode_courante)}. Valeurs arrondies ; une case
            n&apos;est publiée qu&apos;à partir de {agregatsR.donnees.seuils.entreprises_min}{" "}
            entreprises issues d&apos;au moins {agregatsR.donnees.seuils.cabinets_min} cabinets.
          </p>
          <GrilleAgregats agregats={agregatsR.donnees} />
          <MargesAgregats agregats={agregatsR.donnees} />
        </Carte>
      )}
      {peutAdherer ? (
        <>
          <Carte titre="Vos contributions" niveauTitre={2}>
            {resumeR && resumeR.ok ? (
              <ResumeContributions resume={resumeR.donnees} />
            ) : (
              <EtatErreur
                titre="Le résumé n'a pas pu être chargé."
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
          <Carte titre="Se retirer de l'observatoire" niveauTitre={2}>
            <FormulaireRetraitAdhesion />
          </Carte>
        </>
      ) : null}
    </div>
  );
}
