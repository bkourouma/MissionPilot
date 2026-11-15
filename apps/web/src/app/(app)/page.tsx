import Link from "next/link";
import type { Metadata } from "next";
import { CarteBriefAccueil, CarteBriefIndisponible } from "../../components/brief/BriefDuJour";
import { libellesRoles } from "../../components/shell/CadreApplication";
import { BadgeStatut } from "../../components/ui/BadgeStatut";
import { Carte } from "../../components/ui/Carte";
import { Icone } from "../../components/ui/Icone";
import { aPermission } from "@missionpilot/shared";
import {
  GrilleIndicateurs,
  ListeAlertesDerive,
} from "../../components/indicateurs/GrilleIndicateurs";
import { MissionsEnVol } from "../../components/indicateurs/MissionsEnVol";
import { chargerServeur } from "../../lib/api-serveur";
import { messageBriefIndisponible, requeteBrief, type BriefApi } from "../../lib/brief";
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
import {
  descriptionEntree,
  entreesAutorisees,
  grouperEntrees,
  libelleEntree,
} from "../../lib/navigation";
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
  const modules = entreesAutorisees(utilisateur.roles).filter((e) => e.id !== "tableau-de-bord");
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

  return (
    <div className="mp-page">
      <header className="mp-page__entete">
        <h1 className="mp-page__titre">{t("Tableau de bord", "Dashboard")}</h1>
        <p className="mp-page__soustitre">
          {t(
            `Bonjour ${utilisateur.nom}. Vous êtes connecté en tant que `,
            `Hello ${utilisateur.nom}. You are signed in as `,
          )}
          {libellesRoles(utilisateur.roles, langue)}.
        </p>
      </header>

      {brief ? (
        brief.ok ? (
          <CarteBriefAccueil brief={brief.donnees} />
        ) : (
          <CarteBriefIndisponible
            message={messageBriefIndisponible(brief.statut, brief.message, langue)}
          />
        )
      ) : null}

      {pilotage ? (
        <section aria-labelledby="titre-pilotage" className="mp-pile">
          <h2 id="titre-pilotage" className="mp-section__titre">
            {t("Pilotage de la semaine", "This week's overview")}
          </h2>
          {pilotage.ok ? (
            <>
              <MissionsEnVol elements={pilotage.donnees.elements as ElementMission[]} />
              <Carte titre={t("Alertes de dérive", "Variance alerts")} niveauTitre={3}>
                <ListeAlertesDerive
                  alertes={alertesDerive(pilotage.donnees.elements as ElementMission[], langue)}
                  limite={5}
                  langue={langue}
                />
              </Carte>
              <p className="mp-texte-doux">
                {t(
                  `Du ${formaterDate(pilotage.donnees.du)} au ${formaterDate(pilotage.donnees.au)}, montants en ${libelleDevise(pilotage.donnees.devise)}. `,
                  `From ${formaterDate(pilotage.donnees.du, "UTC", langue)} to ${formaterDate(pilotage.donnees.au, "UTC", langue)}, amounts in ${libelleDevise(pilotage.donnees.devise)}. `,
                )}
                <Link href={lienIndicateurs(periode)}>
                  {t(
                    "Changer de période ou de niveau de lecture",
                    "Change the period or reading level",
                  )}
                </Link>
              </p>
              <GrilleIndicateurs
                indicateurs={indicateursAffiches(pilotage.donnees, langue)}
                langue={langue}
              />
            </>
          ) : (
            <p className="mp-texte-doux">
              {t(
                `Indicateurs indisponibles : ${pilotage.message}`,
                `KPIs unavailable: ${pilotage.message}`,
              )}{" "}
              <Link href={lienIndicateurs(periode)}>
                {t("Ouvrir les indicateurs", "Open the KPIs")}
              </Link>
            </p>
          )}
        </section>
      ) : null}

      <section aria-labelledby="titre-modules">
        <h2 id="titre-modules" className="mp-section__titre">
          {t("Vos modules", "Your modules")}
        </h2>
        <p className="mp-texte-doux">
          {t(
            "Les modules accessibles avec votre rôle, regroupés par métier. Ceux marqués « Pas encore disponible » seront ouverts au fil des livraisons.",
            'The modules available with your role, grouped by function. Those marked "Not yet available" will open as releases are delivered.',
          )}
        </p>
        {modules.length === 0 ? (
          <p>
            {t(
              "Votre rôle ne donne accès à aucun module pour l'instant.",
              "Your role does not give access to any module yet.",
            )}
          </p>
        ) : (
          grouperEntrees(modules, langue).map((g) => (
            <div key={g.id} className="mp-modules-groupe">
              <h3 className="mp-modules-groupe__titre">{g.libelle}</h3>
              <ul className="mp-grille-modules">
                {g.entrees.map((m) => (
                  <li key={m.id}>
                    <Carte
                      niveauTitre={4}
                      className={m.disponible ? "mp-module" : "mp-module mp-module--indisponible"}
                      titre={
                        <span className="mp-module__titre">
                          <Icone nom={m.icone} />
                          {m.disponible ? (
                            <Link href={m.href} className="mp-lien-etendu">
                              {libelleEntree(m, langue)}
                            </Link>
                          ) : (
                            libelleEntree(m, langue)
                          )}
                        </span>
                      }
                      actions={
                        m.disponible ? null : (
                          <BadgeStatut tonalite="neutre">
                            {t("Pas encore disponible", "Not yet available")}
                          </BadgeStatut>
                        )
                      }
                    >
                      <p>{descriptionEntree(m, langue)}</p>
                    </Carte>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <Carte titre={t("Votre compte", "Your account")} className="mp-compte">
        <dl className="mp-liste-def">
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
      </Carte>
    </div>
  );
}
