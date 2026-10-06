import Link from "next/link";
import type { Metadata } from "next";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { Champ } from "../../../../components/ui/Champ";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { Icone } from "../../../../components/ui/Icone";
import { Select } from "../../../../components/ui/Select";
import { Tableau } from "../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../lib/api-serveur";
import {
  etatEncaissement,
  filtresEncaissementsActifs,
  hrefEncaissements,
  libelleMoyen,
  lireFiltresEncaissements,
  requeteEncaissements,
  type ContrePassation,
  type Encaissement,
} from "../../../../lib/encaissements";
import { formaterDate, formaterMontantMineur } from "../../../../lib/format";
import { aujourdhui } from "../../../../lib/periode";
import { chargerClientsActifs } from "../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../lib/session";
import { ContrePassationsEnAttente } from "./ContrePassations";
import { FormulaireEncaissement } from "./FormulaireEncaissement";

export const metadata: Metadata = { title: "Encaissements" };

interface Page<T> {
  elements: T[];
  curseur_suivant: string | null;
}

export default async function PageEncaissements({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("encaissement.gerer");
  const filtres = lireFiltresEncaissements(await searchParams);
  const [r, demandes, clients] = await Promise.all([
    chargerServeur<Page<Encaissement>>(
      `/api/finance/encaissements?${requeteEncaissements(filtres)}`,
    ),
    chargerServeur<Page<ContrePassation>>(
      "/api/finance/contre-passations?statut=demandee&limite=50",
    ),
    chargerClientsActifs(utilisateur.roles),
  ]);
  const encaissements = r.ok ? r.donnees.elements : [];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Encaissements"
        soustitre="Paiements reçus des clients (virement, chèque, espèces, Mobile Money) et leur imputation sur les factures. Un encaissement ne se modifie pas : une erreur se corrige par une contre-passation validée par une autre personne."
      />

      {demandes.ok && demandes.donnees.elements.length > 0 ? (
        <ContrePassationsEnAttente
          demandes={demandes.donnees.elements}
          utilisateurId={utilisateur.id}
          roles={utilisateur.roles}
        />
      ) : null}

      <Carte titre="Saisir un encaissement">
        <FormulaireEncaissement
          clients={clients}
          dateDuJour={aujourdhui()}
          cle={`${encaissements[0]?.id ?? ""}-${encaissements.length}`}
        />
      </Carte>

      <section aria-labelledby="titre-liste-encaissements" className="mp-pile">
        <h2 id="titre-liste-encaissements" className="mp-section__titre">
          Encaissements enregistrés
        </h2>
        <form
          method="get"
          action="/facturation/encaissements"
          className="mp-filtres"
          role="search"
          aria-label="Filtrer les encaissements"
        >
          <div className="mp-grille-champs mp-grille-champs--filtres">
            {clients.length > 0 ? (
              <Select
                libelle="Client"
                name="client_id"
                options={clients}
                invite="Tous les clients"
                defaultValue={filtres.client_id}
              />
            ) : null}
            <Champ libelle="Du" type="date" name="du" defaultValue={filtres.du} />
            <Champ libelle="Au" type="date" name="au" defaultValue={filtres.au} />
          </div>
          <div className="mp-actions-formulaire">
            <button type="submit" className={classesBouton("primaire")}>
              <Icone nom="entonnoir" />
              <span>Filtrer</span>
            </button>
            {filtresEncaissementsActifs(filtres) ? (
              <Link href="/facturation/encaissements" className={classesBouton("discret")}>
                Effacer les filtres
              </Link>
            ) : null}
          </div>
        </form>

        {!r.ok ? (
          <EtatErreur
            titre="Les encaissements n'ont pas pu être chargés."
            message={r.message}
            hrefReessayer={hrefEncaissements(filtres)}
          />
        ) : encaissements.length === 0 ? (
          <EtatVide
            titre={
              filtresEncaissementsActifs(filtres)
                ? "Aucun encaissement ne correspond à ces filtres."
                : "Aucun encaissement enregistré pour l'instant."
            }
            icone="monnaie"
          >
            <p>Saisissez le premier paiement reçu avec le formulaire ci-dessus.</p>
          </EtatVide>
        ) : (
          <Tableau
            legende="Encaissements, du plus récent au plus ancien"
            lignes={encaissements}
            cleLigne={(e) => e.id}
            colonnes={[
              {
                cle: "date",
                entete: "Date",
                rendu: (e) => (
                  <Link href={`/facturation/encaissements/${e.id}`} className="mp-sans-coupure">
                    {formaterDate(e.date_encaissement)}
                  </Link>
                ),
              },
              { cle: "client", entete: "Client", rendu: (e) => e.client_raison_sociale },
              { cle: "moyen", entete: "Moyen", rendu: libelleMoyen },
              { cle: "reference", entete: "Référence", rendu: (e) => e.reference ?? "—" },
              {
                cle: "montant",
                entete: "Montant",
                alignement: "droite",
                rendu: (e) => (
                  <span className="mp-montant">{formaterMontantMineur(e.montant, e.devise)}</span>
                ),
              },
              {
                cle: "etat",
                entete: "État",
                rendu: (e) => {
                  const s = etatEncaissement(e);
                  return <BadgeStatut tonalite={s.tonalite}>{s.libelle}</BadgeStatut>;
                },
              },
            ]}
          />
        )}
        {r.ok ? (
          <PaginationCurseur
            hrefSuivante={
              r.donnees.curseur_suivant
                ? hrefEncaissements(filtres, r.donnees.curseur_suivant)
                : null
            }
            hrefDebut={filtres.curseur ? hrefEncaissements(filtres, null) : null}
            libelle="Pages des encaissements"
          />
        ) : null}
      </section>
    </div>
  );
}
