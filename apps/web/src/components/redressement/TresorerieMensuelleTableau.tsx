import type { RedMoisTresorerieVue, RedTresorerieMensuelleVue } from "@missionpilot/shared";
import { formaterMontantMineur, type Devise } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import {
  libelleMois,
  libelleNombreSemaines,
  libelleSemainesTension,
  textesFinancement,
} from "../../lib/redressement-financement";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { EtatVide } from "../ui/EtatListe";
import { Tableau, type ColonneTableau } from "../ui/Tableau";

/**
 * Vue mensuelle de la trésorerie (RED-06) : une ligne par mois, du prévu et du réalisé retenus
 * par le moteur. Les mois de tension et le mois partiel sont dits en texte, jamais par la seule
 * couleur. Tous les chiffres sont ceux de l'API ; rien n'est recalculé ici.
 */
export async function TresorerieMensuelleTableau({
  vue,
  devise,
}: {
  vue: RedTresorerieMensuelleVue;
  devise: Devise;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const tx = textesFinancement(langue);
  const { mensuel, version } = vue;
  if (version === null || mensuel === null) {
    return (
      <EtatVide titre={t("Aucune vue mensuelle.", "No monthly view.")} icone="courbe">
        <p>{tx.mensuelAbsent}</p>
      </EtatVide>
    );
  }
  const m = (v: number) => formaterMontantMineur(v, devise, langue);
  const aUnMoisPartiel = mensuel.mois.some((x) => x.partiel);
  const montant = (cle: string, entete: string, valeur: (x: RedMoisTresorerieVue) => number) => ({
    cle,
    entete,
    alignement: "droite" as const,
    rendu: (x: RedMoisTresorerieVue) => <span className="mp-red-valeur">{m(valeur(x))}</span>,
  });
  const colonnes: ColonneTableau<RedMoisTresorerieVue>[] = [
    {
      cle: "mois",
      entete: t("Mois", "Month"),
      rendu: (x) => (
        <>
          <strong>{libelleMois(x.mois, langue)}</strong>
          {x.partiel ? (
            <>
              {" "}
              <BadgeStatut tonalite="neutre" sansIcone>
                {t("Mois partiel", "Partial month")}
              </BadgeStatut>
            </>
          ) : null}
        </>
      ),
    },
    {
      cle: "semaines",
      entete: t("Semaines réalisées", "Weeks realized"),
      alignement: "droite",
      rendu: (x) => libelleNombreSemaines(x.semaines_realisees, langue),
    },
    montant("enc", t("Encaissements", "Receipts"), (x) => x.encaissements),
    montant("dec", t("Décaissements", "Disbursements"), (x) => x.decaissements),
    montant("flux", t("Flux net", "Net flow"), (x) => x.flux_net),
    montant("ouverture", t("Solde d'ouverture", "Opening balance"), (x) => x.solde_ouverture),
    montant("fin", t("Solde de fin", "Closing balance"), (x) => x.solde_fin),
    {
      cle: "tension",
      entete: t("Tension", "Strain"),
      rendu: (x) =>
        x.tension ? (
          <BadgeStatut tonalite="attention">
            {t("Tension", "Strain")}, {libelleSemainesTension(x.semaines_tension, langue)}
          </BadgeStatut>
        ) : (
          <span className="mp-texte-doux">{t("Aucune", "None")}</span>
        ),
    },
  ];
  return (
    <div className="mp-fin-bloc">
      <div className="mp-red-cartes">
        <Carte titre={t("Solde minimum prévu", "Forecast minimum balance")} niveauTitre={3}>
          <p className="mp-red-chiffre">
            {libelleMois(mensuel.solde_minimum.mois, langue)}, {t("semaine", "week")}{" "}
            {mensuel.solde_minimum.semaine}
          </p>
          <p className="mp-red-valeur">{m(mensuel.solde_minimum.montant)}</p>
        </Carte>
        <Carte titre={t("Premier mois de tension", "First strain month")} niveauTitre={3}>
          <p className="mp-red-chiffre">
            {mensuel.premier_mois_tension !== null
              ? libelleMois(mensuel.premier_mois_tension, langue)
              : t("Aucun", "None")}
          </p>
          <p className="mp-texte-doux mp-texte-petit">
            {t(
              `${mensuel.mois_tension.length} mois en tension sur ${mensuel.mois.length}.`,
              `${mensuel.mois_tension.length} month(s) under strain out of ${mensuel.mois.length}.`,
            )}
          </p>
        </Carte>
        <Carte titre={t("Totaux de la fenêtre", "Window totals")} niveauTitre={3}>
          <dl className="mp-liste-def">
            <div>
              <dt>{t("Encaissements", "Receipts")}</dt>
              <dd className="mp-red-valeur">{m(mensuel.totaux.encaissements)}</dd>
            </div>
            <div>
              <dt>{t("Décaissements", "Disbursements")}</dt>
              <dd className="mp-red-valeur">{m(mensuel.totaux.decaissements)}</dd>
            </div>
            <div>
              <dt>{t("Flux net", "Net flow")}</dt>
              <dd className="mp-red-valeur">{m(mensuel.totaux.flux_net)}</dd>
            </div>
          </dl>
        </Carte>
      </div>
      <Tableau
        legende={t("Trésorerie par mois", "Cash by month")}
        colonnes={colonnes}
        lignes={mensuel.mois}
        cleLigne={(x) => x.mois}
      />
      <p className="mp-texte-doux mp-texte-petit">{tx.conventionMois}</p>
      {aUnMoisPartiel ? <p className="mp-texte-doux mp-texte-petit">{tx.moisPartiel}</p> : null}
    </div>
  );
}
