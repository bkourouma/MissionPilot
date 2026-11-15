import type { Metadata } from "next";
import type { RedRatiosVue, RedTresorerieVue } from "@missionpilot/shared";
import { EtatContexteRed } from "../../../../../../components/redressement/EtatsContexte";
import { FormulaireVersionTresorerie } from "../../../../../../components/redressement/FormulaireVersionTresorerie";
import { GraphiqueSoldes } from "../../../../../../components/redressement/GraphiqueSoldes";
import { GrilleTresorerie } from "../../../../../../components/redressement/GrilleTresorerie";
import { PointMort } from "../../../../../../components/redressement/PointMort";
import { SaisieRealise } from "../../../../../../components/redressement/SaisieRealise";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import {
  formaterDate,
  formaterDateHeure,
  formaterMontantMineur,
} from "../../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import { aujourdhui as aujourdhuiIso } from "../../../../../../lib/periode";
import {
  cheminRatios,
  cheminTresorerie,
  hrefRedressement,
  LIBELLE_BESOIN_FINANCEMENT,
  LIBELLE_BESOIN_FINANCEMENT_EN,
  raisonSansEcriture,
  TEXTE_BESOIN_FINANCEMENT,
  TEXTE_BESOIN_FINANCEMENT_EN,
  TEXTE_TENSION,
  TEXTE_TENSION_EN,
} from "../../../../../../lib/redressement";
import { chargerContexteRed } from "../../../../../../lib/redressement-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Trésorerie à 13 semaines", "13-week cash forecast") };
}

/**
 * Trésorerie à 13 semaines (RED-11) : synthèse, grille prévu / réalisé / écart / solde retenu,
 * graphique et tableau équivalent, nouvelle version de la prévision, saisie du réalisé et point
 * mort. Tous les soldes et écarts sont ceux de l'API (moteur de trésorerie).
 */
export default async function PageTresorerie({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const ctx = await chargerContexteRed(id);
  if (ctx.etat !== "ok") {
    return (
      <EtatContexteRed
        contexte={ctx}
        missionId={id}
        hrefReessayer={hrefRedressement(id, "tresorerie")}
      />
    );
  }
  const { mission, dossier, droits } = ctx;
  const devise = dossier.devise;
  const jour = aujourdhuiIso();
  const [tres, ratios] = await Promise.all([
    chargerServeur<RedTresorerieVue>(cheminTresorerie(dossier.id)),
    chargerServeur<RedRatiosVue>(cheminRatios(dossier.id)),
  ]);
  const dernierExercice = ratios.ok ? ratios.donnees.exercices[0] : undefined;

  if (!tres.ok) {
    return (
      <EtatErreur
        titre={t(
          "La trésorerie n'a pas pu être chargée.",
          "The cash forecast could not be loaded.",
        )}
        message={tres.message}
        hrefReessayer={hrefRedressement(id, "tresorerie")}
      />
    );
  }
  const { version, projection, realises } = tres.donnees;
  const m = (v: number) => formaterMontantMineur(v, devise, langue);
  const correctionsParSemaine = new Map(realises.map((r) => [r.semaine_debut, r.corrections]));
  const semaineParDefaut =
    projection?.semaines.find((s) => s.realise === null)?.debut ??
    projection?.semaines[0]?.debut ??
    "";

  return (
    <div className="mp-red">
      <p className="mp-texte-doux">{t(TEXTE_TENSION, TEXTE_TENSION_EN)}</p>

      {version === null || projection === null ? (
        <EtatVide titre={t("Aucune prévision de trésorerie.", "No cash forecast.")} icone="courbe">
          <p>
            {t(
              "Aucune prévision de trésorerie. Créez la première version : date de début (un lundi), solde bancaire initial, puis encaissements et décaissements attendus semaine par semaine.",
              "No cash forecast. Create the first version: start date (a Monday), opening bank balance, then expected receipts and disbursements week by week.",
            )}
          </p>
        </EtatVide>
      ) : (
        <>
          <div className="mp-red-cartes">
            <Carte titre={t("Solde minimum prévu", "Lowest projected balance")} niveauTitre={3}>
              <p className="mp-red-chiffre">
                {t("Semaine", "Week")} {projection.solde_minimum.semaine}
              </p>
              <p className="mp-red-valeur">{m(projection.solde_minimum.montant)}</p>
            </Carte>
            <Carte titre={t("Première semaine de tension", "First tight week")} niveauTitre={3}>
              <p className="mp-red-chiffre">
                {projection.premiere_semaine_tension !== null
                  ? `${t("Semaine", "Week")} ${projection.premiere_semaine_tension}`
                  : t("Aucune", "None")}
              </p>
              <p className="mp-texte-doux mp-texte-petit">
                {t(
                  `${projection.semaines_tension.length} semaine(s) en tension sur 13.`,
                  `${projection.semaines_tension.length} tight week(s) out of 13.`,
                )}
              </p>
            </Carte>
            <Carte
              titre={t(LIBELLE_BESOIN_FINANCEMENT, LIBELLE_BESOIN_FINANCEMENT_EN)}
              niveauTitre={3}
            >
              <p className="mp-red-chiffre mp-red-valeur">{m(projection.besoin_financement)}</p>
              <p className="mp-texte-doux mp-texte-petit">
                {t(TEXTE_BESOIN_FINANCEMENT, TEXTE_BESOIN_FINANCEMENT_EN)}
              </p>
            </Carte>
          </div>

          <Carte titre={t("Fenêtre de la prévision", "Forecast window")}>
            <dl className="mp-liste-def">
              <div>
                <dt>{t("Version courante", "Current version")}</dt>
                <dd>
                  {version.version}, {t("par", "by")} {version.cree_par.nom} {t("le", "on")}{" "}
                  {formaterDateHeure(version.cree_le, undefined, langue)}
                </dd>
              </div>
              <div>
                <dt>{t("Date de début", "Start date")}</dt>
                <dd>{formaterDate(version.date_debut, "UTC", langue)}</dd>
              </div>
              <div>
                <dt>{t("Solde bancaire initial", "Opening bank balance")}</dt>
                <dd className="mp-red-valeur">{m(version.solde_initial)}</dd>
              </div>
              <div>
                <dt>{t("Seuil de tension", "Tension threshold")}</dt>
                <dd className="mp-red-valeur">{m(version.seuil_tension)}</dd>
              </div>
            </dl>
            {tres.donnees.realises_hors_fenetre > 0 ? (
              <p className="mp-texte-doux mp-texte-petit">
                {t(
                  `${tres.donnees.realises_hors_fenetre} réalisé(s) hors de la fenêtre actuelle sont conservés dans l'historique.`,
                  `${tres.donnees.realises_hors_fenetre} actual(s) outside the current window are kept in the history.`,
                )}
              </p>
            ) : null}
          </Carte>

          <section className="mp-red-section" aria-labelledby="titre-grille">
            <h2 id="titre-grille" className="mp-red-section__titre">
              {t("Grille de 13 semaines", "13-week grid")}
            </h2>
            <GrilleTresorerie projection={projection} devise={devise} />
          </section>

          <section className="mp-red-section" aria-labelledby="titre-graphique">
            <h2 id="titre-graphique" className="mp-red-section__titre">
              {t("Soldes de clôture", "Closing balances")}
            </h2>
            <GraphiqueSoldes
              semaines={projection.semaines}
              seuil={version.seuil_tension}
              devise={devise}
            />
          </section>
        </>
      )}

      {droits.ecrire ? (
        <>
          <Carte titre={t("Nouvelle version de la prévision", "New forecast version")}>
            <FormulaireVersionTresorerie
              key={version?.id ?? "premiere"}
              dossierId={dossier.id}
              devise={devise}
              version={version}
              aujourdhui={jour}
            />
          </Carte>
          {projection ? (
            <Carte titre={t("Saisir le réalisé d'une semaine", "Enter a week's actuals")}>
              <SaisieRealise
                key={realises.map((r) => r.id).join("-") || "aucun"}
                dossierId={dossier.id}
                devise={devise}
                semaines={projection.semaines.map((s) => ({
                  semaine: s.semaine,
                  debut: s.debut,
                  fin: s.fin,
                  corrections: correctionsParSemaine.get(s.debut) ?? null,
                }))}
                semaineParDefaut={semaineParDefaut}
              />
            </Carte>
          ) : null}
        </>
      ) : (
        <Alerte tonalite="info" annonce="aucune">
          <p>{raisonSansEcriture(mission, dossier, ctx.session.utilisateur.roles, langue)}</p>
        </Alerte>
      )}

      <Carte titre={t("Point mort", "Break-even point")}>
        <PointMort
          dossierId={dossier.id}
          devise={devise}
          chiffreAffaires={dernierExercice?.postes.chiffre_affaires ?? null}
          chargesVariables={dernierExercice?.postes.cout_ventes ?? null}
        />
      </Carte>

      {tres.donnees.historique.length > 0 ? (
        <Carte titre={t("Historique des versions de la prévision", "Forecast version history")}>
          <Tableau
            legende={t("Versions de la prévision de trésorerie", "Cash forecast versions")}
            colonnes={[
              {
                cle: "version",
                entete: t("Version", "Version"),
                rendu: (h: RedTresorerieVue["historique"][number]) => h.version,
              },
              {
                cle: "debut",
                entete: t("Date de début", "Start date"),
                rendu: (h) => formaterDate(h.date_debut, "UTC", langue),
              },
              { cle: "auteur", entete: t("Auteur", "Author"), rendu: (h) => h.cree_par.nom },
              {
                cle: "date",
                entete: t("Créée le", "Created on"),
                rendu: (h) => formaterDateHeure(h.cree_le, undefined, langue),
              },
              { cle: "motif", entete: t("Motif", "Reason"), rendu: (h) => h.motif ?? "—" },
            ]}
            lignes={tres.donnees.historique}
            cleLigne={(h) => h.id}
          />
        </Carte>
      ) : null}
    </div>
  );
}
