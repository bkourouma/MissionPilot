import Link from "next/link";
import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { BadgePaiement } from "../../../components/finance/BadgePaiement";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../components/ui/Bouton";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../components/ui/EtatListe";
import { Icone } from "../../../components/ui/Icone";
import { Select } from "../../../components/ui/Select";
import { Tableau } from "../../../components/ui/Tableau";
import { chargerServeur } from "../../../lib/api-serveur";
import {
  designationFacture,
  factureVisible,
  filtresActifs,
  hrefFactures,
  lireFiltresFactures,
  OPTIONS_NATURES,
  OPTIONS_STATUTS_FACTURE,
  requeteFactures,
  STATUT_FACTURE,
  type Facture,
} from "../../../lib/factures";
import { chargerPaiements } from "../../../lib/finance-serveur";
import { formaterDate, formaterMontantMineur } from "../../../lib/format";
import type { Mission } from "../../../lib/missions";
import { chargerClientsActifs } from "../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../lib/session";

export const metadata: Metadata = { title: "Facturation" };

interface PageFactures {
  elements: Facture[];
  curseur_suivant: string | null;
}

function periode(f: Facture): string {
  if (f.date_emission) {
    return f.date_echeance && f.nature === "facture"
      ? `Émise le ${formaterDate(f.date_emission)}, échéance ${formaterDate(f.date_echeance)}`
      : `Émise le ${formaterDate(f.date_emission)}`;
  }
  return `Créée le ${formaterDate(f.cree_le, "Africa/Abidjan")}`;
}

export default async function PageFacturation({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("facture.lire");
  const roles = utilisateur.roles;
  const filtres = lireFiltresFactures(await searchParams);
  const [r, clients, missions] = await Promise.all([
    chargerServeur<PageFactures>(`/api/factures?${requeteFactures(filtres)}`),
    chargerClientsActifs(roles),
    aPermission(roles, "mission.lire")
      ? chargerServeur<{ elements: Mission[] }>("/api/missions")
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
        titre="Facturation"
        soustitre="Factures et avoirs du cabinet : brouillons, approbation, émission et envoi. Une facture se prépare depuis l'onglet Facturation de sa mission."
      />
      <form
        method="get"
        action="/facturation"
        className="mp-filtres"
        role="search"
        aria-label="Filtrer les factures"
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Select
            libelle="Statut"
            name="statut"
            options={OPTIONS_STATUTS_FACTURE}
            invite="Tous les statuts"
            defaultValue={filtres.statut}
          />
          <Select
            libelle="Nature"
            name="nature"
            options={OPTIONS_NATURES}
            invite="Factures et avoirs"
            defaultValue={filtres.nature}
          />
          {clients.length > 0 ? (
            <Select
              libelle="Client"
              name="client_id"
              options={clients}
              invite="Tous les clients"
              defaultValue={filtres.client_id}
            />
          ) : null}
          {optionsMissions.length > 0 ? (
            <Select
              libelle="Mission"
              name="mission_id"
              options={optionsMissions}
              invite="Toutes les missions"
              defaultValue={filtres.mission_id}
            />
          ) : null}
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("primaire")}>
            <Icone nom="entonnoir" />
            <span>Filtrer</span>
          </button>
          {filtresActifs(filtres) ? (
            <Link href="/facturation" className={classesBouton("discret")}>
              Effacer les filtres
            </Link>
          ) : null}
        </div>
      </form>

      {!r.ok ? (
        <EtatErreur
          titre="Les factures n'ont pas pu être chargées."
          message={r.message}
          hrefReessayer={hrefFactures(filtres)}
        />
      ) : factures.length === 0 ? (
        <EtatVide
          titre={
            filtresActifs(filtres)
              ? "Aucune facture ne correspond à ces filtres."
              : "Aucune facture pour l'instant."
          }
          icone="facture"
        >
          <p>Préparez une facture depuis l&apos;onglet Facturation d&apos;une mission signée.</p>
        </EtatVide>
      ) : (
        <Tableau
          legende="Factures et avoirs"
          lignes={factures}
          cleLigne={(f) => f.id}
          colonnes={[
            {
              cle: "numero",
              entete: "Facture",
              rendu: (f) => (
                <Link href={`/facturation/${f.id}`} className="mp-sans-coupure">
                  {designationFacture(f)}
                </Link>
              ),
            },
            { cle: "client", entete: "Client", rendu: (f) => f.client_raison_sociale },
            { cle: "mission", entete: "Mission", rendu: (f) => f.mission_intitule },
            { cle: "periode", entete: "Période", rendu: periode },
            {
              cle: "net",
              entete: "Net à payer",
              alignement: "droite",
              rendu: (f) => (
                <span className="mp-montant">{formaterMontantMineur(f.net_a_payer, f.devise)}</span>
              ),
            },
            {
              cle: "statut",
              entete: "Statut",
              rendu: (f) => (
                <BadgeStatut tonalite={STATUT_FACTURE[f.statut].tonalite}>
                  {f.statut === "emise" && f.envoyee_le
                    ? "Émise et envoyée"
                    : STATUT_FACTURE[f.statut].libelle}
                </BadgeStatut>
              ),
            },
            {
              cle: "paiement",
              entete: "Paiement",
              rendu: (f) => {
                const p = paiements.get(f.id);
                return p?.statut_paiement ? (
                  <BadgePaiement statut={p.statut_paiement} joursRetard={p.jours_retard} />
                ) : (
                  <span className="mp-texte-doux">{f.nature === "avoir" ? "Sans objet" : "—"}</span>
                );
              },
            },
          ]}
        />
      )}
      {r.ok ? (
        <PaginationCurseur
          hrefSuivante={
            r.donnees.curseur_suivant ? hrefFactures(filtres, r.donnees.curseur_suivant) : null
          }
          hrefDebut={filtres.curseur ? hrefFactures(filtres, null) : null}
          libelle="Pages des factures"
        />
      ) : null}
    </div>
  );
}
