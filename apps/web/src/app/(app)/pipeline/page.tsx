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
import { formaterDate, formaterMontantMineur, formaterNombre } from "../../../lib/format";
import {
  ETAPE_LIBELLES,
  formaterProbabilite,
  hrefPipeline,
  lireFiltresPipeline,
  OPTIONS_ETAPES,
  OPTIONS_FILTRE_STATUT,
  requeteOpportunites,
  STATUT_OPPORTUNITE,
  type AgregatPipeline,
  type Opportunite,
} from "../../../lib/pipeline";
import { chargerClientsActifs } from "../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../lib/session";

export const metadata: Metadata = { title: "Pipeline commercial" };

export default async function PagePipeline({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("pipeline.gerer");
  const filtres = lireFiltresPipeline(await searchParams);
  const [liste, agregat, clients] = await Promise.all([
    chargerServeur<{ elements: Opportunite[] }>(
      `/api/opportunites?${requeteOpportunites(filtres)}`,
    ),
    chargerServeur<AgregatPipeline>("/api/opportunites/pipeline"),
    chargerClientsActifs(utilisateur.roles),
  ]);
  const filtre = filtres.statut !== "ouvertes" || Boolean(filtres.etape || filtres.client_id);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Pipeline commercial"
        soustitre="Opportunités en cours, montant pondéré par la probabilité de gain, propositions et passage en mission."
        actions={
          <Link href="/pipeline/nouvelle" className={classesBouton("primaire")}>
            <Icone nom="plus" />
            <span>Nouvelle opportunité</span>
          </Link>
        }
      />

      <SyntheseAgregat agregat={agregat} />

      <form
        method="get"
        action="/pipeline"
        className="mp-filtres"
        aria-label="Filtrer les opportunités"
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Select
            libelle="Statut"
            name="statut"
            options={OPTIONS_FILTRE_STATUT}
            defaultValue={filtres.statut}
          />
          <Select
            libelle="Étape"
            name="etape"
            options={OPTIONS_ETAPES}
            invite="Toutes les étapes"
            defaultValue={filtres.etape}
          />
          <Select
            libelle="Client"
            name="client_id"
            options={clients}
            invite="Tous les clients"
            defaultValue={filtres.client_id}
          />
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("primaire")}>
            <Icone nom="entonnoir" />
            <span>Filtrer</span>
          </button>
          {filtre ? (
            <Link href="/pipeline" className={classesBouton("discret")}>
              Effacer les filtres
            </Link>
          ) : null}
        </div>
      </form>

      {!liste.ok ? (
        <EtatErreur
          titre="Les opportunités n'ont pas pu être chargées."
          message={liste.message}
          hrefReessayer={hrefPipeline(filtres)}
        />
      ) : liste.donnees.elements.length === 0 ? (
        <EtatVide
          titre={
            filtre
              ? "Aucune opportunité ne correspond à ces filtres."
              : "Aucune opportunité ouverte."
          }
          icone="entonnoir"
          action={
            filtre ? (
              <Link href="/pipeline" className={classesBouton("secondaire")}>
                Effacer les filtres
              </Link>
            ) : (
              <Link href="/pipeline/nouvelle" className={classesBouton("primaire")}>
                Créer la première opportunité
              </Link>
            )
          }
        >
          {filtre ? null : (
            <p>Enregistrez une piste commerciale pour suivre sa probabilité de gain.</p>
          )}
        </EtatVide>
      ) : (
        <Tableau
          legende="Opportunités"
          lignes={liste.donnees.elements}
          cleLigne={(o) => o.id}
          colonnes={[
            {
              cle: "intitule",
              entete: "Opportunité",
              rendu: (o) => (
                <Link href={`/pipeline/${o.id}`} className="mp-lien-ligne">
                  {o.intitule}
                </Link>
              ),
            },
            { cle: "client", entete: "Client", rendu: (o) => o.client_raison_sociale },
            {
              cle: "etape",
              entete: "Étape",
              rendu: (o) => (o.statut === "ouverte" ? ETAPE_LIBELLES[o.etape] : "—"),
            },
            {
              cle: "probabilite",
              entete: "Probabilité",
              alignement: "droite",
              rendu: (o) => formaterProbabilite(o.probabilite),
            },
            {
              cle: "montant",
              entete: "Montant estimé",
              alignement: "droite",
              rendu: (o) => formaterMontantMineur(o.montant_estime, o.devise),
            },
            {
              cle: "cloture",
              entete: "Clôture prévue",
              rendu: (o) => formaterDate(o.date_cloture_prevue),
            },
            {
              cle: "statut",
              entete: "Statut",
              rendu: (o) => (
                <BadgeStatut tonalite={STATUT_OPPORTUNITE[o.statut].tonalite}>
                  {STATUT_OPPORTUNITE[o.statut].libelle}
                </BadgeStatut>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}

function SyntheseAgregat({ agregat }: { agregat: Chargement<AgregatPipeline> }) {
  if (!agregat.ok) {
    return (
      <EtatErreur
        titre="La synthèse du pipeline n'a pas pu être chargée."
        message={agregat.message}
        hrefReessayer="/pipeline"
      />
    );
  }
  const a = agregat.donnees;
  return (
    <Carte
      titre="Synthèse des opportunités ouvertes"
      actions={
        <p className="mp-badges">
          <BadgeStatut tonalite="succes">{`${formaterNombre(a.gagnees, 0)} gagnée(s)`}</BadgeStatut>
          <BadgeStatut tonalite="danger">{`${formaterNombre(a.perdues, 0)} perdue(s)`}</BadgeStatut>
        </p>
      }
    >
      {a.totaux.length === 0 ? (
        <p className="mp-texte-doux">Aucune opportunité ouverte : rien à agréger.</p>
      ) : (
        <div className="mp-pile">
          <ul className="mp-totaux">
            {a.totaux.map((t) => (
              <li key={t.devise} className="mp-totaux__element">
                <span className="mp-totaux__libelle">
                  {`${formaterNombre(t.nombre, 0)} opportunité(s) en ${t.devise}`}
                </span>
                <span className="mp-totaux__valeur">
                  {formaterMontantMineur(t.montant_pondere, t.devise)}
                </span>
                <span className="mp-texte-doux">
                  pondéré, sur {formaterMontantMineur(t.montant_estime, t.devise)} estimés
                </span>
              </li>
            ))}
          </ul>
          <Tableau
            legende="Montants par étape et par devise"
            lignes={a.par_etape}
            cleLigne={(l) => `${l.etape}-${l.devise}`}
            colonnes={[
              { cle: "etape", entete: "Étape", rendu: (l) => ETAPE_LIBELLES[l.etape] },
              { cle: "devise", entete: "Devise" },
              {
                cle: "nombre",
                entete: "Nombre",
                alignement: "droite",
                rendu: (l) => formaterNombre(l.nombre, 0),
              },
              {
                cle: "estime",
                entete: "Montant estimé",
                alignement: "droite",
                rendu: (l) => formaterMontantMineur(l.montant_estime, l.devise),
              },
              {
                cle: "pondere",
                entete: "Montant pondéré",
                alignement: "droite",
                rendu: (l) => formaterMontantMineur(l.montant_pondere, l.devise),
              },
            ]}
          />
        </div>
      )}
    </Carte>
  );
}
