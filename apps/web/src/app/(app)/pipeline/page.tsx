import Link from "next/link";
import type { Metadata } from "next";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../components/ui/Bouton";
import { Carte } from "../../../components/ui/Carte";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../components/ui/EtatListe";
import { Icone } from "../../../components/ui/Icone";
import { Select } from "../../../components/ui/Select";
import { Tableau } from "../../../components/ui/Tableau";
import { chargerServeur, type Chargement } from "../../../lib/api-serveur";
import { chargerToutesLesPages, LIMITE_PAGE_MAX } from "../../../lib/pagination";
import {
  formaterDate,
  formaterMontantMineur,
  formaterNombre,
  libelleDevise,
} from "../../../lib/format";
import {
  libelleEtape,
  formaterProbabilite,
  hrefPipeline,
  lireFiltresPipeline,
  optionsEtapes,
  optionsFiltreStatut,
  requeteOpportunites,
  statutOpportunite,
  type AgregatPipeline,
  type Opportunite,
} from "../../../lib/pipeline";
import { creerTraduire, type Langue } from "@missionpilot/shared";
import { chargerClientsActifs } from "../../../lib/referentiels-serveur";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import { exigerPermission } from "../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Pipeline commercial", "Sales pipeline") };
}

export default async function PagePipeline({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("pipeline.gerer");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const filtres = lireFiltresPipeline(await searchParams);
  const [liste, agregat, clients] = await Promise.all([
    chargerToutesLesPages<Opportunite>(
      chargerServeur,
      `/api/opportunites?${requeteOpportunites(filtres)}`,
      { limiteMax: LIMITE_PAGE_MAX },
    ),
    chargerServeur<AgregatPipeline>("/api/opportunites/pipeline"),
    chargerClientsActifs(utilisateur.roles),
  ]);
  const filtre = filtres.statut !== "ouvertes" || Boolean(filtres.etape || filtres.client_id);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Pipeline commercial", "Sales pipeline")}
        soustitre={t(
          "Opportunités en cours, montant pondéré par la probabilité de gain, propositions et passage en mission.",
          "Ongoing opportunities, amounts weighted by win probability, proposals and conversion into engagements.",
        )}
        actions={
          <Link href="/pipeline/nouvelle" className={classesBouton("primaire")}>
            <Icone nom="plus" />
            <span>{t("Nouvelle opportunité", "New opportunity")}</span>
          </Link>
        }
      />

      <SyntheseAgregat agregat={agregat} langue={langue} />

      <form
        method="get"
        action="/pipeline"
        className="mp-filtres"
        aria-label={t("Filtrer les opportunités", "Filter opportunities")}
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Select
            libelle={t("Statut", "Status")}
            name="statut"
            options={optionsFiltreStatut(langue)}
            defaultValue={filtres.statut}
          />
          <Select
            libelle={t("Étape", "Stage")}
            name="etape"
            options={optionsEtapes(langue)}
            invite={t("Toutes les étapes", "All stages")}
            defaultValue={filtres.etape}
          />
          <Select
            libelle={t("Client", "Client")}
            name="client_id"
            options={clients}
            invite={t("Tous les clients", "All clients")}
            defaultValue={filtres.client_id}
          />
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("primaire")}>
            <Icone nom="entonnoir" />
            <span>{t("Filtrer", "Filter")}</span>
          </button>
          {filtre ? (
            <Link href="/pipeline" className={classesBouton("discret")}>
              {t("Effacer les filtres", "Clear filters")}
            </Link>
          ) : null}
        </div>
      </form>

      {!liste.ok ? (
        <EtatErreur
          titre={t(
            "Les opportunités n'ont pas pu être chargées.",
            "The opportunities could not be loaded.",
          )}
          message={liste.message}
          hrefReessayer={hrefPipeline(filtres)}
        />
      ) : liste.donnees.elements.length === 0 ? (
        <EtatVide
          titre={
            filtre
              ? t(
                  "Aucune opportunité ne correspond à ces filtres.",
                  "No opportunity matches these filters.",
                )
              : t("Aucune opportunité ouverte.", "No open opportunity.")
          }
          icone="entonnoir"
          action={
            filtre ? (
              <Link href="/pipeline" className={classesBouton("secondaire")}>
                {t("Effacer les filtres", "Clear filters")}
              </Link>
            ) : (
              <Link href="/pipeline/nouvelle" className={classesBouton("primaire")}>
                {t("Créer la première opportunité", "Create the first opportunity")}
              </Link>
            )
          }
        >
          {filtre ? null : (
            <p>
              {t(
                "Enregistrez une piste commerciale pour suivre sa probabilité de gain.",
                "Record a sales lead to track its win probability.",
              )}
            </p>
          )}
        </EtatVide>
      ) : (
        <Tableau
          legende={t("Opportunités", "Opportunities")}
          lignes={liste.donnees.elements}
          cleLigne={(o) => o.id}
          colonnes={[
            {
              cle: "intitule",
              entete: t("Opportunité", "Opportunity"),
              rendu: (o) => (
                <Link href={`/pipeline/${o.id}`} className="mp-lien-ligne">
                  {o.intitule}
                </Link>
              ),
            },
            { cle: "client", entete: t("Client", "Client"), rendu: (o) => o.client_raison_sociale },
            {
              cle: "etape",
              entete: t("Étape", "Stage"),
              rendu: (o) => (o.statut === "ouverte" ? libelleEtape(o.etape, langue) : "—"),
            },
            {
              cle: "probabilite",
              entete: t("Probabilité", "Probability"),
              alignement: "droite",
              rendu: (o) => formaterProbabilite(o.probabilite, langue),
            },
            {
              cle: "montant",
              entete: t("Montant estimé", "Estimated amount"),
              alignement: "droite",
              rendu: (o) => formaterMontantMineur(o.montant_estime, o.devise, langue),
            },
            {
              cle: "cloture",
              entete: t("Clôture prévue", "Expected close date"),
              rendu: (o) => formaterDate(o.date_cloture_prevue, "UTC", langue),
            },
            {
              cle: "statut",
              entete: t("Statut", "Status"),
              rendu: (o) => (
                <BadgeStatut tonalite={statutOpportunite(o.statut, langue).tonalite}>
                  {statutOpportunite(o.statut, langue).libelle}
                </BadgeStatut>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}

function SyntheseAgregat({
  agregat,
  langue,
}: {
  agregat: Chargement<AgregatPipeline>;
  langue: Langue;
}) {
  const t = creerTraduire(langue);
  if (!agregat.ok) {
    return (
      <EtatErreur
        titre={t(
          "La synthèse du pipeline n'a pas pu être chargée.",
          "The pipeline summary could not be loaded.",
        )}
        message={agregat.message}
        hrefReessayer="/pipeline"
      />
    );
  }
  const a = agregat.donnees;
  return (
    <Carte
      titre={t("Synthèse des opportunités ouvertes", "Summary of open opportunities")}
      actions={
        <p className="mp-badges">
          <BadgeStatut tonalite="succes">{`${formaterNombre(a.gagnees, 0, langue)} ${t("gagnée(s)", "won")}`}</BadgeStatut>
          <BadgeStatut tonalite="danger">{`${formaterNombre(a.perdues, 0, langue)} ${t("perdue(s)", "lost")}`}</BadgeStatut>
        </p>
      }
    >
      {a.totaux.length === 0 ? (
        <p className="mp-texte-doux">
          {t(
            "Aucune opportunité ouverte : rien à agréger.",
            "No open opportunity: nothing to aggregate.",
          )}
        </p>
      ) : (
        <div className="mp-pile">
          <ul className="mp-totaux">
            {a.totaux.map((tot) => (
              <li key={tot.devise} className="mp-totaux__element">
                <span className="mp-totaux__libelle">
                  {t(
                    `${formaterNombre(tot.nombre, 0, langue)} opportunité(s) en ${libelleDevise(tot.devise)}`,
                    `${formaterNombre(tot.nombre, 0, langue)} opportunity(ies) in ${libelleDevise(tot.devise)}`,
                  )}
                </span>
                <span className="mp-totaux__valeur">
                  {formaterMontantMineur(tot.montant_pondere, tot.devise, langue)}
                </span>
                <span className="mp-texte-doux">
                  {t(
                    `pondéré, sur ${formaterMontantMineur(tot.montant_estime, tot.devise, langue)} estimés`,
                    `weighted, out of ${formaterMontantMineur(tot.montant_estime, tot.devise, langue)} estimated`,
                  )}
                </span>
              </li>
            ))}
          </ul>
          <Tableau
            legende={t("Montants par étape et par devise", "Amounts by stage and currency")}
            lignes={a.par_etape}
            cleLigne={(l) => `${l.etape}-${l.devise}`}
            colonnes={[
              {
                cle: "etape",
                entete: t("Étape", "Stage"),
                rendu: (l) => libelleEtape(l.etape, langue),
              },
              {
                cle: "devise",
                entete: t("Devise", "Currency"),
                rendu: (l) => libelleDevise(l.devise),
              },
              {
                cle: "nombre",
                entete: t("Nombre", "Count"),
                alignement: "droite",
                rendu: (l) => formaterNombre(l.nombre, 0, langue),
              },
              {
                cle: "estime",
                entete: t("Montant estimé", "Estimated amount"),
                alignement: "droite",
                rendu: (l) => formaterMontantMineur(l.montant_estime, l.devise, langue),
              },
              {
                cle: "pondere",
                entete: t("Montant pondéré", "Weighted amount"),
                alignement: "droite",
                rendu: (l) => formaterMontantMineur(l.montant_pondere, l.devise, langue),
              },
            ]}
          />
        </div>
      )}
    </Carte>
  );
}
