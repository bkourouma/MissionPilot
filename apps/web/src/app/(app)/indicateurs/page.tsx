import type { Metadata } from "next";
import {
  GrilleIndicateurs,
  ListeAlertesDerive,
} from "../../../components/indicateurs/GrilleIndicateurs";
import { TableauNiveau } from "../../../components/indicateurs/TableauNiveau";
import { Alerte } from "../../../components/ui/Alerte";
import { classesBouton } from "../../../components/ui/Bouton";
import { Carte } from "../../../components/ui/Carte";
import { Champ } from "../../../components/ui/Champ";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../components/ui/EtatListe";
import { Icone } from "../../../components/ui/Icone";
import { Select } from "../../../components/ui/Select";
import { chargerServeur } from "../../../lib/api-serveur";
import { formaterDate, libelleDevise } from "../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import {
  alertesDerive,
  dateReferenceIndicateurs,
  indicateursAffiches,
  lireFiltresIndicateurs,
  NIVEAU_LIBELLES,
  NIVEAU_LIBELLES_EN,
  optionsNiveaux,
  requeteIndicateurs,
  type ElementMission,
  type ReponseIndicateurs,
} from "../../../lib/indicateurs";
import { aujourdhui } from "../../../lib/periode";
import { exigerPermission } from "../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Indicateurs du cabinet", "Firm indicators") };
}

export default async function PageIndicateurs({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("indicateurs.cabinet");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const jour = aujourdhui();
  const f = lireFiltresIndicateurs(await searchParams, jour);
  // Jalons et feuilles évalués à la fin de la période, jamais après aujourd'hui.
  const dateReference = dateReferenceIndicateurs(f, jour);
  // Lien « Réessayer » : la période et le niveau suffisent, la date de référence se recalcule.
  const requete = requeteIndicateurs(f);
  const requeteApi = requeteIndicateurs({ ...f, date_reference: dateReference });
  const requeteMissions = requeteIndicateurs({
    ...f,
    niveau: "mission",
    date_reference: dateReference,
  });
  const [r, missions] = await Promise.all([
    chargerServeur<ReponseIndicateurs>(`/api/indicateurs/cabinet?${requeteApi}`),
    f.niveau === "mission"
      ? Promise.resolve(null)
      : chargerServeur<ReponseIndicateurs>(`/api/indicateurs/cabinet?${requeteMissions}`),
  ]);
  const parMission = f.niveau === "mission" ? r : missions;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Indicateurs du cabinet", "Firm indicators")}
        soustitre={t(
          "Les onze indicateurs de pilotage, calculés par le moteur à partir des temps validés, des budgets, des factures et des encaissements.",
          "The eleven management indicators, computed by the engine from approved time entries, budgets, invoices and payments received.",
        )}
      />
      <form
        method="get"
        action="/indicateurs"
        className="mp-filtres"
        role="search"
        aria-label={t("Période et niveau de lecture", "Period and reading level")}
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Champ libelle={t("Du", "From")} type="date" name="du" defaultValue={f.du} required />
          <Champ
            libelle={t("Au", "To")}
            type="date"
            name="au"
            defaultValue={f.au}
            required
            aide={t("Période de 366 jours au plus.", "Period of 366 days at most.")}
          />
          <Select
            libelle={t("Niveau de lecture", "Reading level")}
            name="niveau"
            options={optionsNiveaux(langue)}
            defaultValue={f.niveau}
          />
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("primaire")}>
            <Icone nom="courbe" />
            <span>{t("Afficher", "Show")}</span>
          </button>
        </div>
      </form>
      {f.corrigee ? (
        <Alerte tonalite="attention" annonce="status">
          <p>
            {t(
              "Période invalide ou de plus de 366 jours : la période par défaut (semaine en cours) est affichée.",
              "Invalid period or longer than 366 days: the default period (current week) is shown.",
            )}
          </p>
        </Alerte>
      ) : null}

      {!r.ok ? (
        <EtatErreur
          titre={t(
            "Les indicateurs n'ont pas pu être calculés.",
            "The indicators could not be computed.",
          )}
          message={r.message}
          hrefReessayer={`/indicateurs?${requete}`}
        />
      ) : (
        <>
          <section aria-labelledby="titre-cabinet" className="mp-pile">
            <h2 id="titre-cabinet" className="mp-section__titre">
              {t(
                `Cabinet du ${formaterDate(r.donnees.du, "UTC", langue)} au ${formaterDate(r.donnees.au, "UTC", langue)}`,
                `Firm from ${formaterDate(r.donnees.du, "UTC", langue)} to ${formaterDate(r.donnees.au, "UTC", langue)}`,
              )}
            </h2>
            <p className="mp-texte-doux">
              {t(
                `Montants en ${libelleDevise(r.donnees.devise)}. Jalons et feuilles évalués au ${formaterDate(r.donnees.date_reference, "UTC", langue)}. Les statuts de couleur appliquent des seuils de lecture de départ, à valider par le cabinet.`,
                `Amounts in ${libelleDevise(r.donnees.devise)}. Milestones and timesheets assessed as of ${formaterDate(r.donnees.date_reference, "UTC", langue)}. Color statuses apply starting reading thresholds, to be approved by the firm.`,
              )}
            </p>
            {r.donnees.missions_exclues && r.donnees.missions_exclues.length > 0 ? (
              <Alerte tonalite="attention" annonce="aucune">
                <p>
                  {t(
                    `${r.donnees.missions_exclues.length} mission(s) exclue(s) des montants : taux de change non figé.`,
                    `${r.donnees.missions_exclues.length} engagement(s) excluded from the amounts: exchange rate not frozen.`,
                  )}
                </p>
              </Alerte>
            ) : null}
            <GrilleIndicateurs
              indicateurs={indicateursAffiches(r.donnees, langue)}
              langue={langue}
            />
          </section>

          <Carte titre={t("Alertes de dérive", "Drift alerts")} id="alertes">
            <div className="mp-pile">
              <p className="mp-texte-doux">
                {t(
                  "Missions dont l'atterrissage dépasse le budget en jours. Ouvrez le suivi pour voir l'écart par phase, puis réallouez des jours ou demandez une révision de budget.",
                  "Engagements whose landing exceeds the budget in days. Open the tracking to see the variance by phase, then reallocate days or request a budget revision.",
                )}
              </p>
              {parMission?.ok ? (
                <ListeAlertesDerive
                  alertes={alertesDerive(parMission.donnees.elements as ElementMission[], langue)}
                  langue={langue}
                />
              ) : (
                <p className="mp-texte-doux">
                  {t(
                    "Les alertes n'ont pas pu être calculées.",
                    "The alerts could not be computed.",
                  )}
                </p>
              )}
            </div>
          </Carte>

          {r.donnees.niveau !== "cabinet" ? (
            <Carte
              titre={t(
                `Détail par ${NIVEAU_LIBELLES[r.donnees.niveau].toLowerCase()}`,
                `Detail by ${NIVEAU_LIBELLES_EN[r.donnees.niveau].toLowerCase()}`,
              )}
            >
              <TableauNiveau reponse={r.donnees} />
            </Carte>
          ) : null}
        </>
      )}
    </div>
  );
}
