import Link from "next/link";
import type { Metadata } from "next";
import "../../components/indicateurs/tableau-de-bord.css";
import { CarteBriefAccueil } from "../../components/brief/BriefDuJour";
import { ListeAlertesDerive } from "../../components/indicateurs/GrilleIndicateurs";
import { ListeIndicateurs } from "../../components/indicateurs/ListeIndicateurs";
import { MissionsEnVol } from "../../components/indicateurs/MissionsEnVol";
import { ModulesAccueil } from "../../components/indicateurs/ModulesAccueil";
import { repartirModules } from "../../components/indicateurs/modules-accueil";
import { libellesRoles } from "../../components/shell/CadreApplication";
import { Alerte } from "../../components/ui/Alerte";
import { classesBouton } from "../../components/ui/Bouton";
import { Calcule } from "../../components/ui/Calcule";
import { Carte } from "../../components/ui/Carte";
import { aPermission } from "@missionpilot/shared";
import { chargerServeur } from "../../lib/api-serveur";
import {
  CHEMIN_BRIEF,
  messageBriefIndisponible,
  requeteBrief,
  titreErreurBrief,
  type BriefApi,
} from "../../lib/brief";
import { formaterDate, libelleDevise } from "../../lib/format";
import {
  alertesDerive,
  dateReferenceIndicateurs,
  indicateursAffiches,
  lienIndicateurs,
  periodeParDefaut,
  requeteIndicateurs,
  type ElementMission,
  type ReponseIndicateurs,
} from "../../lib/indicateurs";
import { obtenirLangue } from "../../lib/i18n/serveur";
import { CHEMIN_SECURITE_COMPTE, entreesAutorisees } from "../../lib/navigation";
import { aujourdhui } from "../../lib/periode";
import { obtenirSession } from "../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const langue = await obtenirLangue();
  return { title: langue === "en" ? "Dashboard" : "Tableau de bord" };
}

export default async function TableauDeBord() {
  const langue = await obtenirLangue();
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  const { utilisateur } = await obtenirSession();
  const repartition = repartirModules(entreesAutorisees(utilisateur.roles), langue);
  // Semaine en cours (lundi au dimanche) ; jalons et feuilles évalués au plus tard aujourd'hui.
  const jour = aujourdhui();
  const periode = periodeParDefaut(jour);
  const requetePilotage = requeteIndicateurs({
    ...periode,
    niveau: "mission",
    date_reference: dateReferenceIndicateurs(periode, jour),
  });
  // Pilotage du cabinet (parcours C) : une seule requête de niveau « mission » sert à la fois
  // les indicateurs du cabinet et les alertes de dérive.
  const [pilotage, brief] = await Promise.all([
    aPermission(utilisateur.roles, "indicateurs.cabinet")
      ? chargerServeur<ReponseIndicateurs>(`/api/indicateurs/cabinet?${requetePilotage}`)
      : null,
    // Brief du jour (AUT-07) : résumé seulement, l'écran /brief porte le détail.
    aPermission(utilisateur.roles, "brief.lire") ? chargerServeur<BriefApi>(requeteBrief()) : null,
  ]);

  const lienPeriode = lienIndicateurs(periode);
  const actionsReessai = (hrefDetail: string, libelleDetail: string) => (
    <>
      <Link href="/" prefetch={false} className={classesBouton("secondaire")}>
        {t("Réessayer", "Try again")}
      </Link>
      <Link href={hrefDetail} className={classesBouton("discret")}>
        {libelleDetail}
      </Link>
    </>
  );

  // Ce qui demande l'attention en premier : le brief du jour et les alertes de dérive.
  const noeudBrief = brief ? (
    brief.ok ? (
      <CarteBriefAccueil brief={brief.donnees} />
    ) : (
      <Alerte
        tonalite="attention"
        titre={titreErreurBrief(brief.statut, langue)}
        actions={actionsReessai(CHEMIN_BRIEF, t("Ouvrir mon brief", "Open my brief"))}
      >
        {messageBriefIndisponible(brief.statut, brief.message, langue)}
      </Alerte>
    )
  ) : null;
  const noeudAlertes =
    pilotage && pilotage.ok ? (
      <Carte
        titre={t("Alertes de dérive", "Variance alerts")}
        niveauTitre={3}
        actions={<Calcule />}
      >
        <ListeAlertesDerive
          alertes={alertesDerive(pilotage.donnees.elements as ElementMission[], langue)}
          limite={5}
          langue={langue}
        />
      </Carte>
    ) : null;

  return (
    <div className="mp-page mp-tdb">
      <header className="mp-page__entete">
        <h1 className="mp-page__titre">{t("Tableau de bord", "Dashboard")}</h1>
        <p className="mp-page__soustitre">
          {t(`Bonjour ${utilisateur.nom}.`, `Hello ${utilisateur.nom}.`)}
        </p>
      </header>

      {noeudBrief || noeudAlertes ? (
        <section aria-labelledby="titre-attention" className="mp-tdb-section">
          <h2 id="titre-attention" className="mp-section__titre">
            {t("À traiter en premier", "To handle first")}
          </h2>
          <div
            className={
              noeudBrief && noeudAlertes
                ? "mp-tdb-attention mp-tdb-attention--double"
                : "mp-tdb-attention"
            }
          >
            {noeudBrief}
            {noeudAlertes}
          </div>
        </section>
      ) : null}

      {pilotage ? (
        <section aria-labelledby="titre-pilotage" className="mp-tdb-section">
          <div className="mp-tdb-section__entete">
            <h2 id="titre-pilotage" className="mp-section__titre">
              {t("Pilotage de la semaine", "This week's overview")}
            </h2>
            {pilotage.ok ? (
              <Link href={lienPeriode} className={classesBouton("discret")}>
                {t("Changer de période ou de niveau", "Change the period or level")}
              </Link>
            ) : null}
          </div>
          {pilotage.ok ? (
            <>
              <p className="mp-texte-doux">
                {t(
                  `Du ${formaterDate(pilotage.donnees.du)} au ${formaterDate(pilotage.donnees.au)}, montants en ${libelleDevise(pilotage.donnees.devise)}.`,
                  `From ${formaterDate(pilotage.donnees.du, "UTC", langue)} to ${formaterDate(pilotage.donnees.au, "UTC", langue)}, amounts in ${libelleDevise(pilotage.donnees.devise)}.`,
                )}
              </p>
              <MissionsEnVol
                elements={pilotage.donnees.elements as ElementMission[]}
                hrefPeriode={lienPeriode}
              />
              <div className="mp-tdb-bloc">
                <div className="mp-tdb-bloc__entete">
                  <h3 id="titre-indicateurs-cabinet" className="mp-tdb-bloc__titre">
                    {t("Indicateurs du cabinet", "Firm indicators")}
                  </h3>
                  <Calcule />
                </div>
                <ListeIndicateurs
                  indicateurs={indicateursAffiches(pilotage.donnees, langue)}
                  langue={langue}
                  idTitre="titre-indicateurs-cabinet"
                />
              </div>
            </>
          ) : (
            <Alerte
              tonalite="danger"
              titre={t(
                "Le pilotage de la semaine n'a pas pu être chargé.",
                "This week's overview could not be loaded.",
              )}
              actions={actionsReessai(lienPeriode, t("Ouvrir les indicateurs", "Open the KPIs"))}
            >
              {pilotage.message}
            </Alerte>
          )}
        </section>
      ) : null}

      <ModulesAccueil repartition={repartition} langue={langue} />

      <section aria-labelledby="titre-compte" className="mp-tdb-compte">
        <h2 id="titre-compte" className="mp-tdb-compte__titre">
          {t("Votre compte", "Your account")}
        </h2>
        <dl className="mp-tdb-compte__liste">
          <div>
            <dt>{t("Nom", "Name")}</dt>
            <dd>{utilisateur.nom}</dd>
          </div>
          <div>
            <dt>{t("Adresse e-mail", "Email address")}</dt>
            <dd>{utilisateur.email}</dd>
          </div>
          <div>
            <dt>{t("Rôle", "Role")}</dt>
            <dd>{libellesRoles(utilisateur.roles, langue)}</dd>
          </div>
        </dl>
        <Link href={CHEMIN_SECURITE_COMPTE} className={classesBouton("discret")}>
          {t("Sécurité du compte", "Account security")}
        </Link>
      </section>
    </div>
  );
}
