import Link from "next/link";
import type { Metadata } from "next";
import { creerTraduire } from "@missionpilot/shared";
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
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { aujourdhui } from "../../../../lib/periode";
import { chargerClientsActifs } from "../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../lib/session";
import { ContrePassationsEnAttente } from "./ContrePassations";
import { FormulaireEncaissement } from "./FormulaireEncaissement";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Encaissements", "Payments received") };
}

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
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
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
        titre={t("Encaissements", "Payments received")}
        soustitre={t(
          "Paiements reçus des clients (virement, chèque, espèces, Mobile Money) et leur imputation sur les factures. Un encaissement ne se modifie pas : une erreur se corrige par une contre-passation validée par une autre personne.",
          "Payments received from clients (bank transfer, check, cash, Mobile Money) and their allocation to invoices. A payment cannot be edited: an error is corrected by a reversal approved by another person.",
        )}
      />

      {demandes.ok && demandes.donnees.elements.length > 0 ? (
        <ContrePassationsEnAttente
          demandes={demandes.donnees.elements}
          utilisateurId={utilisateur.id}
          roles={utilisateur.roles}
        />
      ) : null}

      <Carte titre={t("Saisir un encaissement", "Record a payment")}>
        <FormulaireEncaissement
          clients={clients}
          dateDuJour={aujourdhui()}
          cle={`${encaissements[0]?.id ?? ""}-${encaissements.length}`}
        />
      </Carte>

      <section aria-labelledby="titre-liste-encaissements" className="mp-pile">
        <h2 id="titre-liste-encaissements" className="mp-section__titre">
          {t("Encaissements enregistrés", "Recorded payments")}
        </h2>
        <form
          method="get"
          action="/facturation/encaissements"
          className="mp-filtres"
          role="search"
          aria-label={t("Filtrer les encaissements", "Filter payments")}
        >
          <div className="mp-grille-champs mp-grille-champs--filtres">
            {clients.length > 0 ? (
              <Select
                libelle={t("Client", "Client")}
                name="client_id"
                options={clients}
                invite={t("Tous les clients", "All clients")}
                defaultValue={filtres.client_id}
              />
            ) : null}
            <Champ libelle={t("Du", "From")} type="date" name="du" defaultValue={filtres.du} />
            <Champ libelle={t("Au", "To")} type="date" name="au" defaultValue={filtres.au} />
          </div>
          <div className="mp-actions-formulaire">
            <button type="submit" className={classesBouton("primaire")}>
              <Icone nom="entonnoir" />
              <span>{t("Filtrer", "Filter")}</span>
            </button>
            {filtresEncaissementsActifs(filtres) ? (
              <Link href="/facturation/encaissements" className={classesBouton("discret")}>
                {t("Effacer les filtres", "Clear filters")}
              </Link>
            ) : null}
          </div>
        </form>

        {!r.ok ? (
          <EtatErreur
            titre={t(
              "Les encaissements n'ont pas pu être chargés.",
              "The payments could not be loaded.",
            )}
            message={r.message}
            hrefReessayer={hrefEncaissements(filtres)}
          />
        ) : encaissements.length === 0 ? (
          <EtatVide
            titre={
              filtresEncaissementsActifs(filtres)
                ? t(
                    "Aucun encaissement ne correspond à ces filtres.",
                    "No payment matches these filters.",
                  )
                : t("Aucun encaissement enregistré pour l'instant.", "No payment recorded yet.")
            }
            icone="monnaie"
          >
            <p>
              {t(
                "Saisissez le premier paiement reçu avec le formulaire ci-dessus.",
                "Record the first payment received using the form above.",
              )}
            </p>
          </EtatVide>
        ) : (
          <div className="mp-chiffres mp-tableau-cliquable">
            <Tableau
              legende={t(
                "Encaissements, du plus récent au plus ancien",
                "Payments, from most recent to oldest",
              )}
              lignes={encaissements}
              cleLigne={(e) => e.id}
              colonnes={[
                {
                  cle: "date",
                  entete: t("Date", "Date"),
                  rendu: (e) => (
                    <Link
                      href={`/facturation/encaissements/${e.id}`}
                      className="mp-sans-coupure mp-lien-ligne"
                    >
                      {formaterDate(e.date_encaissement, "UTC", langue)}
                    </Link>
                  ),
                },
                {
                  cle: "client",
                  entete: t("Client", "Client"),
                  rendu: (e) => e.client_raison_sociale,
                },
                {
                  cle: "moyen",
                  entete: t("Moyen", "Method"),
                  rendu: (e) => libelleMoyen(e, langue),
                },
                {
                  cle: "reference",
                  entete: t("Référence", "Reference"),
                  rendu: (e) => e.reference ?? "—",
                },
                {
                  cle: "montant",
                  entete: t("Montant", "Amount"),
                  alignement: "droite",
                  rendu: (e) => (
                    <span className="mp-montant">
                      {formaterMontantMineur(e.montant, e.devise, langue)}
                    </span>
                  ),
                },
                {
                  cle: "etat",
                  entete: t("État", "Status"),
                  rendu: (e) => {
                    const s = etatEncaissement(e, langue);
                    return <BadgeStatut tonalite={s.tonalite}>{s.libelle}</BadgeStatut>;
                  },
                },
              ]}
            />
          </div>
        )}
        {r.ok ? (
          <PaginationCurseur
            hrefSuivante={
              r.donnees.curseur_suivant
                ? hrefEncaissements(filtres, r.donnees.curseur_suivant)
                : null
            }
            hrefDebut={filtres.curseur ? hrefEncaissements(filtres, null) : null}
            libelle={t("Pages des encaissements", "Payment pages")}
          />
        ) : null}
      </section>
    </div>
  );
}
