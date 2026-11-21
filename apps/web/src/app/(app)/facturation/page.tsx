import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { aPermission, creerTraduire, type Langue } from "@missionpilot/shared";
import { BadgePaiement } from "../../../components/finance/BadgePaiement";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../components/ui/Bouton";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../components/ui/EtatListe";
import { Icone } from "../../../components/ui/Icone";
import { Select } from "../../../components/ui/Select";
import { Tableau } from "../../../components/ui/Tableau";
import { SegmentsStatut } from "../../../components/facturation/SegmentsStatut";
import { chargerServeur } from "../../../lib/api-serveur";
import { chargerToutesLesPages, LIMITE_PAGE_MAX } from "../../../lib/pagination";
import {
  designationFacture,
  factureVisible,
  filtresActifs,
  hrefFactures,
  lireFiltresFactures,
  libelleStatutFacture,
  optionsNatures,
  optionsStatutsFacture,
  requeteFactures,
  STATUT_FACTURE,
  type Facture,
  type FiltresFactures,
} from "../../../lib/factures";
import { chargerPaiements } from "../../../lib/finance-serveur";
import { formaterDate, formaterMontantMineur } from "../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import type { Mission } from "../../../lib/missions";
import { chargerClientsActifs } from "../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Facturation", "Billing") };
}

interface PageFactures {
  elements: Facture[];
  curseur_suivant: string | null;
}

function periode(f: Facture, langue: Langue): ReactNode {
  const t = creerTraduire(langue);
  const date = (iso: string, fuseau = "UTC") => (
    <span className="mp-sans-coupure">{formaterDate(iso, fuseau, langue)}</span>
  );
  if (f.date_emission) {
    return (
      <span className="mp-periode">
        {t("Émise le", "Issued on")} {date(f.date_emission)}
        {f.date_echeance && f.nature === "facture" ? (
          <>
            <br />
            <span className="mp-texte-doux">
              {t("échéance", "due")} {date(f.date_echeance)}
            </span>
          </>
        ) : null}
      </span>
    );
  }
  return (
    <span className="mp-periode">
      {t("Créée le", "Created on")} {date(f.cree_le, "Africa/Abidjan")}
    </span>
  );
}

export default async function PageFacturation({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("facture.lire");
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  const roles = utilisateur.roles;
  const filtres = lireFiltresFactures(await searchParams);
  const [r, clients, missions] = await Promise.all([
    chargerServeur<PageFactures>(`/api/factures?${requeteFactures(filtres)}`),
    chargerClientsActifs(roles),
    aPermission(roles, "mission.lire")
      ? chargerToutesLesPages<Mission>(chargerServeur, "/api/missions", {
          limiteMax: LIMITE_PAGE_MAX,
        })
      : Promise.resolve(null),
  ]);
  const optionsMissions = missions?.ok
    ? missions.donnees.elements.map((m) => ({ valeur: m.id, libelle: m.intitule }))
    : [];
  const factures = r.ok ? r.donnees.elements.map(factureVisible) : [];
  const paiements = await chargerPaiements(factures);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Facturation", "Billing")}
        soustitre={t(
          "Factures et avoirs du cabinet : brouillons, approbation, émission et envoi. Une facture se prépare depuis l'onglet Facturation de sa mission.",
          "The firm's invoices and credit notes: drafts, approval, issuance and sending. An invoice is prepared from the Billing tab of its engagement.",
        )}
      />
      <SegmentsStatut
        statut={filtres.statut}
        options={optionsStatutsFacture(langue)}
        href={(statut) =>
          hrefFactures({ ...filtres, statut: statut as FiltresFactures["statut"] }, null)
        }
        libelle={t("Filtrer par statut", "Filter by status")}
      />
      <form
        method="get"
        action="/facturation"
        className="mp-filtres"
        role="search"
        aria-label={t("Filtrer les factures", "Filter invoices")}
      >
        {filtres.statut ? <input type="hidden" name="statut" value={filtres.statut} /> : null}
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Select
            libelle={t("Nature", "Type")}
            name="nature"
            options={optionsNatures(langue)}
            invite={t("Factures et avoirs", "Invoices and credit notes")}
            defaultValue={filtres.nature}
          />
          {clients.length > 0 ? (
            <Select
              libelle={t("Client", "Client")}
              name="client_id"
              options={clients}
              invite={t("Tous les clients", "All clients")}
              defaultValue={filtres.client_id}
            />
          ) : null}
          {optionsMissions.length > 0 ? (
            <Select
              libelle={t("Mission", "Engagement")}
              name="mission_id"
              options={optionsMissions}
              invite={t("Toutes les missions", "All engagements")}
              defaultValue={filtres.mission_id}
            />
          ) : null}
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("primaire")}>
            <Icone nom="entonnoir" />
            <span>{t("Filtrer", "Filter")}</span>
          </button>
          {filtresActifs(filtres) ? (
            <Link href="/facturation" className={classesBouton("discret")}>
              {t("Effacer les filtres", "Clear filters")}
            </Link>
          ) : null}
        </div>
      </form>

      {!r.ok ? (
        <EtatErreur
          titre={t("Les factures n'ont pas pu être chargées.", "The invoices could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefFactures(filtres)}
        />
      ) : factures.length === 0 ? (
        <EtatVide
          titre={
            filtresActifs(filtres)
              ? t(
                  "Aucune facture ne correspond à ces filtres.",
                  "No invoice matches these filters.",
                )
              : t("Aucune facture pour l'instant.", "No invoices yet.")
          }
          icone="facture"
          action={
            filtresActifs(filtres) ? (
              <Link href="/facturation" className={classesBouton("secondaire")}>
                {t("Effacer les filtres", "Clear filters")}
              </Link>
            ) : aPermission(roles, "mission.lire") ? (
              <Link href="/missions" className={classesBouton("secondaire")}>
                {t("Ouvrir les missions", "Open engagements")}
              </Link>
            ) : undefined
          }
        >
          <p>
            {t(
              "Préparez une facture depuis l'onglet Facturation d'une mission signée.",
              "Prepare an invoice from the Billing tab of a signed engagement.",
            )}
          </p>
        </EtatVide>
      ) : (
        <div className="mp-chiffres mp-tableau-cliquable">
          <Tableau
            legende={t("Factures et avoirs", "Invoices and credit notes")}
            lignes={factures}
            cleLigne={(f) => f.id}
            colonnes={[
              {
                cle: "numero",
                entete: t("Facture", "Invoice"),
                rendu: (f) => (
                  <Link href={`/facturation/${f.id}`} className="mp-sans-coupure mp-lien-ligne">
                    {designationFacture(f, langue)}
                  </Link>
                ),
              },
              {
                cle: "client",
                entete: t("Client", "Client"),
                rendu: (f) => f.client_raison_sociale,
              },
              {
                cle: "mission",
                entete: t("Mission", "Engagement"),
                rendu: (f) => f.mission_intitule,
              },
              {
                cle: "periode",
                entete: t("Période", "Period"),
                rendu: (f) => periode(f, langue),
              },
              {
                cle: "net",
                entete: t("Net à payer", "Net payable"),
                alignement: "droite",
                rendu: (f) => (
                  <span className="mp-montant">
                    {formaterMontantMineur(f.net_a_payer, f.devise, langue)}
                  </span>
                ),
              },
              {
                cle: "statut",
                entete: t("Statut", "Status"),
                rendu: (f) => (
                  <BadgeStatut tonalite={STATUT_FACTURE[f.statut].tonalite}>
                    {f.statut === "emise" && f.envoyee_le
                      ? t("Émise et envoyée", "Issued and sent")
                      : libelleStatutFacture(f.statut, langue)}
                  </BadgeStatut>
                ),
              },
              {
                cle: "paiement",
                entete: t("Paiement", "Payment"),
                rendu: (f) => {
                  const p = paiements.get(f.id);
                  return p?.statut_paiement ? (
                    <BadgePaiement statut={p.statut_paiement} joursRetard={p.jours_retard} />
                  ) : (
                    <span className="mp-texte-doux">
                      {f.nature === "avoir" ? t("Sans objet", "Not applicable") : "—"}
                    </span>
                  );
                },
              },
            ]}
          />
        </div>
      )}
      {r.ok ? (
        <PaginationCurseur
          hrefSuivante={
            r.donnees.curseur_suivant ? hrefFactures(filtres, r.donnees.curseur_suivant) : null
          }
          hrefDebut={filtres.curseur ? hrefFactures(filtres, null) : null}
          libelle={t("Pages des factures", "Invoice pages")}
        />
      ) : null}
    </div>
  );
}
