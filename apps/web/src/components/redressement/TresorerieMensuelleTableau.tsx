import type { RedMoisTresorerieVue, RedTresorerieMensuelleVue } from "@missionpilot/shared";
import { formaterMontantMineur, type Devise } from "../../lib/format";
import {
  libelleMois,
  libelleNombreSemaines,
  libelleSemainesTension,
  TEXTE_CONVENTION_MOIS,
  TEXTE_MENSUEL_ABSENT,
  TEXTE_MOIS_PARTIEL,
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
export function TresorerieMensuelleTableau({
  vue,
  devise,
}: {
  vue: RedTresorerieMensuelleVue;
  devise: Devise;
}) {
  const { mensuel, version } = vue;
  if (version === null || mensuel === null) {
    return (
      <EtatVide titre="Aucune vue mensuelle." icone="courbe">
        <p>{TEXTE_MENSUEL_ABSENT}</p>
      </EtatVide>
    );
  }
  const m = (v: number) => formaterMontantMineur(v, devise);
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
      entete: "Mois",
      rendu: (x) => (
        <>
          <strong>{libelleMois(x.mois)}</strong>
          {x.partiel ? (
            <>
              {" "}
              <BadgeStatut tonalite="neutre" sansIcone>
                Mois partiel
              </BadgeStatut>
            </>
          ) : null}
        </>
      ),
    },
    {
      cle: "semaines",
      entete: "Semaines réalisées",
      alignement: "droite",
      rendu: (x) => libelleNombreSemaines(x.semaines_realisees),
    },
    montant("enc", "Encaissements", (x) => x.encaissements),
    montant("dec", "Décaissements", (x) => x.decaissements),
    montant("flux", "Flux net", (x) => x.flux_net),
    montant("ouverture", "Solde d'ouverture", (x) => x.solde_ouverture),
    montant("fin", "Solde de fin", (x) => x.solde_fin),
    {
      cle: "tension",
      entete: "Tension",
      rendu: (x) =>
        x.tension ? (
          <BadgeStatut tonalite="attention">
            Tension, {libelleSemainesTension(x.semaines_tension)}
          </BadgeStatut>
        ) : (
          <span className="mp-texte-doux">Aucune</span>
        ),
    },
  ];
  return (
    <div className="mp-fin-bloc">
      <div className="mp-red-cartes">
        <Carte titre="Solde minimum prévu" niveauTitre={3}>
          <p className="mp-red-chiffre">
            {libelleMois(mensuel.solde_minimum.mois)}, semaine {mensuel.solde_minimum.semaine}
          </p>
          <p className="mp-red-valeur">{m(mensuel.solde_minimum.montant)}</p>
        </Carte>
        <Carte titre="Premier mois de tension" niveauTitre={3}>
          <p className="mp-red-chiffre">
            {mensuel.premier_mois_tension !== null
              ? libelleMois(mensuel.premier_mois_tension)
              : "Aucun"}
          </p>
          <p className="mp-texte-doux mp-texte-petit">
            {mensuel.mois_tension.length} mois en tension sur {mensuel.mois.length}.
          </p>
        </Carte>
        <Carte titre="Totaux de la fenêtre" niveauTitre={3}>
          <dl className="mp-liste-def">
            <div>
              <dt>Encaissements</dt>
              <dd className="mp-red-valeur">{m(mensuel.totaux.encaissements)}</dd>
            </div>
            <div>
              <dt>Décaissements</dt>
              <dd className="mp-red-valeur">{m(mensuel.totaux.decaissements)}</dd>
            </div>
            <div>
              <dt>Flux net</dt>
              <dd className="mp-red-valeur">{m(mensuel.totaux.flux_net)}</dd>
            </div>
          </dl>
        </Carte>
      </div>
      <Tableau
        legende="Trésorerie par mois"
        colonnes={colonnes}
        lignes={mensuel.mois}
        cleLigne={(x) => x.mois}
      />
      <p className="mp-texte-doux mp-texte-petit">{TEXTE_CONVENTION_MOIS}</p>
      {aUnMoisPartiel ? <p className="mp-texte-doux mp-texte-petit">{TEXTE_MOIS_PARTIEL}</p> : null}
    </div>
  );
}
